import { getCachedCustomCommands, updateCachedCommands } from "./state";
import { App, TFile } from "obsidian";
import { parse, stringify } from "yaml";
import { CustomCommandManager } from "./customCommandManager";
import { trashFile } from "@/utils/vaultAdapterUtils";
import {
  EMPTY_COMMAND,
  COPILOT_COMMAND_ENABLED,
  COPILOT_COMMAND_CONTEXT_MENU_ENABLED,
  COPILOT_COMMAND_SLASH_ENABLED,
} from "./constants";

jest.mock("@/commands/customCommandUtils", () => ({
  getCommandFilePath: (title: string) => `commands/${title}.md`,
  getCustomCommandsFolder: () => "commands",
  getNextCustomCommandOrder: () => 1,
}));
jest.mock("@/utils", () => ({ ensureFolderExists: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/utils/vaultAdapterUtils", () => ({
  trashFile: jest.fn().mockResolvedValue(undefined),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(initial = "---\ncustom-property: keep\n---\nSaved prompt") {
  const file = Object.assign(new TFile(), { path: "commands/Review.md", basename: "Review" });
  const files = new Map([[file.path, file]]);
  const texts = new Map([[file.path, initial]]);
  const write = jest.fn(async (path: string, content: string) => {
    texts.set(path, content);
  });
  const vault = {
    getAbstractFileByPath: (path: string) => files.get(path),
    read: async (file: TFile) => texts.get(file.path)!,
    modify: jest.fn(async (file: TFile, content: string) => write(file.path, content)),
    process: jest.fn(async (file: TFile, update: (text: string) => string) => {
      const next = update(texts.get(file.path)!);
      await write(file.path, next);
      return next;
    }),
    create: jest.fn(async (path: string, content: string) => {
      if (files.has(path)) throw new Error("Already exists");
      await write(path, content);
      const created = Object.assign(new TFile(), {
        path,
        basename: path.split("/").at(-1)!.slice(0, -3),
      });
      files.set(path, created);
      return created;
    }),
    rename: jest.fn(async (file: TFile, path: string) => {
      if (files.has(path)) throw new Error("Already exists");
      const content = texts.get(file.path)!;
      texts.delete(file.path);
      files.delete(file.path);
      file.path = path;
      file.basename = path.split("/").at(-1)!.slice(0, -3);
      files.set(path, file);
      texts.set(path, content);
    }),
  };
  const frontmatter = (path = "commands/Review.md"): Record<string, unknown> => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(texts.get(path) ?? "");
    return match ? (parse(match[1]) as Record<string, unknown>) : {};
  };
  const app = {
    vault,
    fileManager: {
      processFrontMatter: jest.fn(
        async (file: TFile, update: (fields: Record<string, unknown>) => void) => {
          const metadata = frontmatter(file.path);
          update(metadata);
          const body = texts.get(file.path)!.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
          await write(file.path, `---\n${stringify(metadata)}---\n${body}`);
        }
      ),
    },
  } as unknown as App;
  (CustomCommandManager as unknown as { instance: unknown }).instance = undefined;
  return {
    app,
    vault,
    files,
    texts,
    write,
    frontmatter,
    manager: CustomCommandManager.getInstance(app),
  };
}

describe("customCommandManager", () => {
  describe("CustomCommandManager", () => {
    afterEach(() => {
      updateCachedCommands([]);
      jest.clearAllMocks();
    });
    describe("createCommand()", () => {
      it("refuses to overwrite a command file created after the editor was opened", async () => {
        const { manager, texts } = setup();
        const before = texts.get("commands/Review.md");
        await expect(
          manager.createCommand({ ...EMPTY_COMMAND, title: "Review", content: "New draft" })
        ).rejects.toThrow();
        expect(texts.get("commands/Review.md")).toBe(before);
      });
      it("writes the whole-command enabled setting while preserving both menu preferences", async () => {
        const { manager, frontmatter, files, texts } = setup();
        files.clear();
        texts.clear();
        await manager.createCommand({
          ...EMPTY_COMMAND,
          title: "Review",
          enabled: false,
          showInContextMenu: true,
          showInSlashMenu: true,
        });
        expect(frontmatter()[COPILOT_COMMAND_ENABLED]).toBe(false);
        expect(frontmatter()[COPILOT_COMMAND_CONTEXT_MENU_ENABLED]).toBe(true);
        expect(frontmatter()[COPILOT_COMMAND_SLASH_ENABLED]).toBe(true);
      });
    });
    describe("recordUsage()", () => {
      it("does not recreate a command removed before a delayed usage update", async () => {
        const { manager, files, texts } = setup();
        files.clear();
        texts.clear();
        await manager.recordUsage({ ...EMPTY_COMMAND, title: "Review" });
        expect(files.size).toBe(0);
        expect(texts.size).toBe(0);
      });
      it("serializes an in-flight usage update with editing and preserves both the edit and usage time", async () => {
        const { manager, write, texts, frontmatter } = setup();
        const original = { ...EMPTY_COMMAND, title: "Review", content: "Saved prompt" };
        updateCachedCommands([original]);
        const started = deferred(),
          release = deferred();
        write.mockImplementationOnce(async (path, content) => {
          started.resolve();
          await release.promise;
          texts.set(path, content);
        });
        const usage = manager.recordUsage(original);
        await started.promise;
        const edit = manager.updateCommand(
          { ...original, content: "Edited prompt" },
          original.title
        );
        const writesWhilePending = write.mock.calls.length;
        release.resolve();
        await Promise.all([usage, edit]);
        expect(writesWhilePending).toBe(1);
        expect(texts.get("commands/Review.md")).toContain("Edited prompt");
        expect(frontmatter()["copilot-command-last-used"]).toEqual(expect.any(Number));
        expect(frontmatter()["copilot-command-last-used"]).toBeGreaterThan(0);
        expect(getCachedCustomCommands()[0].content).toBe("Edited prompt");
      });
      it("changes only the usage time without replacing a newer file body or model selection", async () => {
        const { manager, texts, frontmatter } = setup(
          "---\ncopilot-command-model-key: new-model\n---\nExternally edited prompt"
        );
        const original = {
          ...EMPTY_COMMAND,
          title: "Review",
          content: "Stale prompt",
          modelKey: "old-model",
        };
        updateCachedCommands([original]);
        await manager.recordUsage(original);
        expect(texts.get("commands/Review.md")).toContain("Externally edited prompt");
        expect(frontmatter()["copilot-command-model-key"]).toBe("new-model");
        expect(getCachedCustomCommands()[0]).toMatchObject({
          content: "Externally edited prompt",
          modelKey: "new-model",
        });
      });
      it("does not restore a disabled command when a stale menu selection records usage", async () => {
        const { manager } = setup();
        const stale = { ...EMPTY_COMMAND, title: "Review" };
        updateCachedCommands([{ ...stale, enabled: false }]);
        const update = jest.spyOn(manager, "updateCommand");
        await manager.recordUsage(stale);
        expect(update).not.toHaveBeenCalled();
        update.mockRestore();
        updateCachedCommands([]);
      });
    });
    describe("updateCommand()", () => {
      it("accepts the reader's trimmed baseline when frontmatter is followed by blank lines and indentation", async () => {
        const { manager, texts } = setup("---\ncustom-property: keep\n---\n\n  Saved prompt");
        const baseline = { ...EMPTY_COMMAND, title: "Review", content: "Saved prompt" };
        await manager.updateCommand(
          { ...baseline, content: "Edited prompt" },
          "Review",
          false,
          baseline
        );
        expect(texts.get("commands/Review.md")).toContain("Edited prompt");
        expect(getCachedCustomCommands()[0].content).toBe("Edited prompt");
      });
      it("retains original body whitespace for a field-only change while keeping the cached body consistent with the reader", async () => {
        const { manager, texts } = setup(
          "---\ncopilot-command-enabled: true\n---\n\n  Saved prompt"
        );
        const baseline = { ...EMPTY_COMMAND, title: "Review", content: "Saved prompt" };
        await manager.updateCommand({ ...baseline, enabled: false }, "Review", false, baseline);
        expect(texts.get("commands/Review.md")?.endsWith("---\n\n  Saved prompt")).toBe(true);
        expect(getCachedCustomCommands()[0].content).toBe("Saved prompt");
      });
      it("edits a command with empty frontmatter while retaining a header comment", async () => {
        const { manager, texts } = setup("---\n# retained comment\n---\nSaved prompt");
        await manager.updateCommand(
          { ...EMPTY_COMMAND, title: "Review", content: "Edited prompt" },
          "Review"
        );
        expect(texts.get("commands/Review.md")).toContain("# retained comment");
        expect(texts.get("commands/Review.md")).toContain("Edited prompt");
      });
      it("uses the editor baseline to change only the requested field and preserve newer file contents", async () => {
        const { manager, texts, frontmatter } = setup(
          "---\ncopilot-command-enabled: true\n---\nNewer prompt"
        );
        const baseline = { ...EMPTY_COMMAND, title: "Review", content: "Old prompt" };
        await manager.updateCommand({ ...baseline, enabled: false }, "Review", false, baseline);
        expect(texts.get("commands/Review.md")).toContain("Newer prompt");
        expect(frontmatter()[COPILOT_COMMAND_ENABLED]).toBe(false);
      });
      it("rejects a conflicting edit without overwriting a newer version of the same field", async () => {
        const { manager, texts } = setup("Newer prompt");
        const baseline = { ...EMPTY_COMMAND, title: "Review", content: "Old prompt" };
        await expect(
          manager.updateCommand({ ...baseline, content: "My draft" }, "Review", false, baseline)
        ).rejects.toThrow("其他操作修改");
        expect(texts.get("commands/Review.md")).toBe("Newer prompt");
      });
      it("preserves both files and reports the recovery location if restoring a name is blocked by another file", async () => {
        const { manager, write, files, texts } = setup();
        const original = { ...EMPTY_COMMAND, title: "Review", content: "Saved prompt" };
        updateCachedCommands([original]);
        write.mockImplementationOnce(async () => {
          files.set(
            "commands/Review.md",
            Object.assign(new TFile(), { path: "commands/Review.md", basename: "Review" })
          );
          texts.set("commands/Review.md", "Created elsewhere");
          throw new Error("Cannot write file");
        });
        await expect(
          manager.updateCommand({ ...original, title: "Renamed", content: "Draft" }, "Review")
        ).rejects.toThrow("commands/Renamed.md");
        expect(texts.get("commands/Review.md")).toBe("Created elsewhere");
        expect(texts.get("commands/Renamed.md")).toContain("Saved prompt");
        expect(getCachedCustomCommands()[0]).toMatchObject({
          title: "Renamed",
          content: "Saved prompt",
        });
      });
      it("writes a complete document so no saved state loses its metadata between body and configuration updates", async () => {
        const { manager, write, frontmatter } = setup();
        await manager.updateCommand(
          {
            ...EMPTY_COMMAND,
            title: "Review",
            enabled: false,
            modelKey: "private-model",
            content: "Edited prompt",
          },
          "Review"
        );
        expect(write.mock.calls).toHaveLength(1);
        expect(write.mock.calls[0][1]).toContain("copilot-command-enabled: false");
        expect(write.mock.calls[0][1]).toContain("copilot-command-model-key: private-model");
        expect(frontmatter()["custom-property"]).toBe("keep");
      });
      it("restores the original filename and content when saving after a rename fails, then allows retry", async () => {
        const { manager, write, files, texts } = setup();
        const original = { ...EMPTY_COMMAND, title: "Review", content: "Saved prompt" };
        const changed = { ...original, title: "Renamed", content: "Edited prompt" };
        const before = texts.get("commands/Review.md");
        updateCachedCommands([original]);
        write.mockRejectedValueOnce(new Error("Cannot write file"));
        await expect(manager.updateCommand(changed, original.title)).rejects.toThrow(
          "Cannot write file"
        );
        expect([...files.keys()]).toEqual(["commands/Review.md"]);
        expect(texts.get("commands/Review.md")).toBe(before);
        expect(getCachedCustomCommands()).toEqual([original]);
        await manager.updateCommand(changed, original.title);
        expect([...files.keys()]).toEqual(["commands/Renamed.md"]);
        expect(texts.get("commands/Renamed.md")).toContain("Edited prompt");
      });
      it("keeps the saved command in the cache when writing its replacement fails", async () => {
        const { write, manager } = setup();
        const original = { ...EMPTY_COMMAND, title: "Review", content: "Saved prompt" };
        updateCachedCommands([original]);
        write.mockRejectedValueOnce(new Error("Cannot write file"));
        await expect(
          manager.updateCommand({ ...original, content: "Unsaved draft" }, original.title)
        ).rejects.toThrow("Cannot write file");
        expect(getCachedCustomCommands()).toEqual([original]);
        updateCachedCommands([]);
      });
      it("restores the saved command without changing either menu preference", async () => {
        const { manager, frontmatter } = setup();
        await manager.updateCommand(
          {
            ...EMPTY_COMMAND,
            title: "Review",
            enabled: true,
            showInContextMenu: false,
            showInSlashMenu: true,
          },
          "Review"
        );
        expect(frontmatter()[COPILOT_COMMAND_ENABLED]).toBe(true);
        expect(frontmatter()[COPILOT_COMMAND_CONTEXT_MENU_ENABLED]).toBe(false);
        expect(frontmatter()[COPILOT_COMMAND_SLASH_ENABLED]).toBe(true);
      });
    });
    describe("updateCommands()", () => {
      it("publishes the requested order after the command files are saved", async () => {
        const { manager } = setup();
        const original = { ...EMPTY_COMMAND, title: "Review", order: 20 };
        updateCachedCommands([original]);
        await manager.updateCommands([{ ...original, order: 0 }]);
        expect(getCachedCustomCommands()).toEqual([{ ...original, order: 0 }]);
      });
      it("does not publish an unsaved order when a batch write fails", async () => {
        const { write, manager } = setup();
        const original = { ...EMPTY_COMMAND, title: "Review", order: 20 };
        updateCachedCommands([original]);
        write.mockRejectedValueOnce(new Error("Cannot write file"));
        await expect(manager.updateCommands([{ ...original, order: 0 }])).rejects.toThrow(
          "Cannot write file"
        );
        expect(getCachedCustomCommands()).toEqual([original]);
      });
    });
    describe("reorderCommands()", () => {
      it("updates only ordering when the supplied rows contain an older copy of the command", async () => {
        const { manager, texts, frontmatter } = setup(
          "---\ncopilot-command-model-key: new-model\n---\nNewer prompt"
        );
        const stale = {
          ...EMPTY_COMMAND,
          title: "Review",
          content: "Old prompt",
          modelKey: "old-model",
          order: 20,
        };
        updateCachedCommands([stale]);
        await manager.reorderCommands([stale]);
        expect(texts.get("commands/Review.md")).toContain("Newer prompt");
        expect(frontmatter()["copilot-command-model-key"]).toBe("new-model");
        expect(frontmatter()["copilot-command-context-menu-order"]).toBe(0);
      });
    });
    describe("deleteCommand()", () => {
      it("removes a command from the list after moving its file to the trash", async () => {
        const { manager } = setup();
        const original = { ...EMPTY_COMMAND, title: "Review" };
        updateCachedCommands([original]);
        await manager.deleteCommand(original);
        expect(getCachedCustomCommands()).toEqual([]);
        expect(trashFile).toHaveBeenCalledTimes(1);
      });
      it("keeps a command in the list when moving its file to the trash fails", async () => {
        const { manager } = setup();
        const original = { ...EMPTY_COMMAND, title: "Review" };
        updateCachedCommands([original]);
        jest.mocked(trashFile).mockRejectedValueOnce(new Error("Cannot remove file"));
        await expect(manager.deleteCommand(original)).rejects.toThrow("Cannot remove file");
        expect(getCachedCustomCommands()).toEqual([original]);
      });
    });
  });
});
