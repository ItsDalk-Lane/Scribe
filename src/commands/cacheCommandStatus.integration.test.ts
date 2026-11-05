import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { FileSystemAdapter, Notice, type App, type Command } from "obsidian";
import type ScribePlugin from "@/main";
import { registerCommands } from "@/commands";
import { FileCache } from "@/cache/fileCache";
import { COMMAND_IDS } from "@/constants";
import { setInterfaceLocale } from "@/lib/i18n";
import { logError } from "@/logger";
import { getVaultId } from "@/utils/appPaths";

let mockHome = "";
jest.mock("os", () => ({
  ...jest.requireActual<typeof import("os")>("os"),
  homedir: () => mockHome,
}));
jest.mock("@/commands/CustomCommandChatModal", () => ({ CustomCommandChatModal: jest.fn() }));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const SUCCESS = "Scribe file caches cleared.";
const EMPTY = "No Scribe file caches needed clearing.";
const FAILURE = "Scribe file cache cleanup failed:";
const RECOVERY = "Some items may already have been removed. Check the remaining files and retry.";

function fixture(
  root: string,
  afterList?: () => Promise<void>,
  beforeRmdir?: (dir: string) => Promise<void>
) {
  const adapter = new (FileSystemAdapter as unknown as new (base: string) => FileSystemAdapter)(
    root
  );
  Object.assign(adapter, {
    exists: async (path: string) => {
      try {
        await fs.lstat(join(root, path));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    mkdir: (path: string) => fs.mkdir(join(root, path), { recursive: true }),
    write: (path: string, text: string) => fs.writeFile(join(root, path), text),
    read: (path: string) => fs.readFile(join(root, path), "utf8"),
    list: async (path: string) => {
      const entries = await fs.readdir(join(root, path), { withFileTypes: true });
      await afterList?.();
      return {
        files: entries
          .filter((entry) => entry.isFile())
          .map((entry) => posix.join(path, entry.name)),
        folders: entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => posix.join(path, entry.name)),
      };
    },
    remove: (path: string) => fs.unlink(join(root, path)),
    rmdir: async (path: string) => {
      const dir = join(root, path);
      await beforeRmdir?.(dir);
      await fs.rm(dir, { recursive: true });
    },
  });
  const app = { vault: { adapter }, workspace: { getActiveFile: () => null } } as unknown as App;
  const commands: Command[] = [];
  registerCommands({
    app,
    addCommand: (command: Command) => commands.push(command),
  } as unknown as ScribePlugin);
  const callback = commands.find(({ id }) => id === COMMAND_IDS.CLEAR_SCRIBE_CACHE)?.callback;
  if (!callback) throw new Error("Cache command not registered");
  return {
    app,
    cache: FileCache.getInstance<string>(),
    contextDir: join(mockHome, ".obsidian-scribe", "vaults", getVaultId(app), "context-cache"),
    run: () =>
      new Promise<string>((resolve) => {
        jest.mocked(Notice).mockImplementation((message) => {
          resolve(typeof message === "string" ? message : (message.textContent ?? ""));
          return {} as Notice;
        });
        callback();
      }),
  };
}

describe("cacheCommandStatus", () => {
  describe("registerCommands()", () => {
    let root: string;
    beforeEach(async () => {
      jest.clearAllMocks();
      setInterfaceLocale("en");
      root = await fs.mkdtemp(join(tmpdir(), "scribe-cache-command-status-"));
      mockHome = await fs.mkdtemp(join(tmpdir(), "scribe-cache-command-home-"));
      (FileCache as unknown as { instance: unknown }).instance = undefined;
    });
    afterEach(async () => {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(mockHome, { recursive: true, force: true });
      (FileCache as unknown as { instance: unknown }).instance = undefined;
    });

    it("reports completion after the registered command really removes file, PDF and desktop context caches", async () => {
      const f = fixture(root);
      await f.cache.set(f.app.vault, "synthetic", "Generated cache fixture");
      const pdf = join(root, ".scribe/pdf-cache");
      await fs.mkdir(pdf, { recursive: true });
      await fs.writeFile(join(pdf, "fixture.md"), "Generated PDF fixture");
      await fs.mkdir(f.contextDir, { recursive: true });
      await fs.writeFile(join(f.contextDir, "fixture.md"), "Generated context fixture");
      expect(await f.run()).toBe(SUCCESS);
      await expect(
        fs.access(join(root, ".scribe/file-content-cache/synthetic.md"))
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.access(pdf)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.access(f.contextDir)).rejects.toMatchObject({ code: "ENOENT" });
      expect(logError).not.toHaveBeenCalled();
      expect(await f.run()).toBe(EMPTY);
    });

    it("reports no work when neither memory nor file-cache contents exist", async () => {
      const f = fixture(root);
      expect(await f.run()).toBe(EMPTY);
      expect(Notice).not.toHaveBeenCalledWith(SUCCESS);
    });

    it("reports real memory-cache cleanup once even when its backing file was already removed", async () => {
      const f = fixture(root);
      await f.cache.set(f.app.vault, "synthetic", "Generated cache fixture");
      await fs.unlink(join(root, ".scribe/file-content-cache/synthetic.md"));
      expect(await f.cache.get(f.app.vault, "synthetic")).toBe("Generated cache fixture");
      expect(await f.run()).toBe(SUCCESS);
      expect(await f.cache.get(f.app.vault, "synthetic")).toBeNull();
      expect(await f.run()).toBe(EMPTY);
      expect(await f.cache.clear(f.app.vault)).toBe(false);
    });

    it("keeps a real file removal failure and its cause visible instead of claiming success or starting later cleanup", async () => {
      const cached = join(root, ".scribe/file-content-cache/synthetic.md");
      const f = fixture(root, () => fs.rename(cached, `${cached}.moved`));
      await f.cache.set(f.app.vault, "synthetic", "Generated cache fixture");
      const pdf = join(root, ".scribe/pdf-cache");
      await fs.mkdir(pdf, { recursive: true });
      await fs.writeFile(join(pdf, "fixture.md"), "Generated PDF fixture");
      const notice = await f.run();
      expect(notice).toContain(FAILURE);
      expect(notice).toContain("ENOENT");
      expect(notice).toContain(RECOVERY);
      expect(Notice).not.toHaveBeenCalledWith(SUCCESS);
      const error = jest
        .mocked(logError)
        .mock.calls.find(([label]) => label === "Error clearing file cache:")?.[1];
      expect(error).toMatchObject({ code: "ENOENT", path: cached });
      expect(logError).toHaveBeenCalledWith("Error clearing Scribe caches:", error);
      expect(await fs.readFile(`${cached}.moved`, "utf8")).toBe("Generated cache fixture");
      expect(await fs.readFile(join(pdf, "fixture.md"), "utf8")).toBe("Generated PDF fixture");
    });

    it("reports a later real folder removal failure with a partial-cleanup warning and the original cause", async () => {
      const f = fixture(root, undefined, (dir) => fs.rename(dir, `${dir}.moved`));
      await f.cache.set(f.app.vault, "synthetic", "Generated cache fixture");
      const pdf = join(root, ".scribe/pdf-cache");
      await fs.mkdir(pdf, { recursive: true });
      await fs.writeFile(join(pdf, "fixture.md"), "Generated PDF fixture");
      const notice = await f.run();
      expect(notice).toContain(FAILURE);
      expect(notice).toContain("ENOENT");
      expect(notice).toContain(RECOVERY);
      expect(logError).toHaveBeenCalledWith(
        "Error clearing Scribe caches:",
        expect.objectContaining({ code: "ENOENT", path: pdf })
      );
      await expect(
        fs.access(join(root, ".scribe/file-content-cache/synthetic.md"))
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readFile(join(`${pdf}.moved`, "fixture.md"), "utf8")).toBe(
        "Generated PDF fixture"
      );
    });
  });
});
