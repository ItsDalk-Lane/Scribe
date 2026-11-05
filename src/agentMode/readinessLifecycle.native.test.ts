import * as disk from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystemAdapter, type App } from "obsidian";
import type ScribePlugin from "@/main";
import { createAgentSessionManager } from "@/agentMode";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { NativeBackendDescriptor } from "@/agentMode/backends/native/descriptor";
import { SkillManager } from "@/agentMode/skills/SkillManager";
import { getSettings, setSettings } from "@/settings/model";
import { __resetVaultBaseCache } from "@/utils/vaultPath";

let mockAppDataRoot: string;

jest.mock("@/utils/appPaths", () => ({
  ...jest.requireActual("@/utils/appPaths"),
  scribeAppDataDir: () => mockAppDataRoot,
  getVaultId: () => "isolated-readiness-vault",
}));
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

function makeApp(root: string): App {
  const full = (relative: string) => join(root, ...relative.split("/"));
  const adapter = Object.assign(
    new (FileSystemAdapter as unknown as new (base: string) => FileSystemAdapter)(root),
    {
      exists: async (relative: string) => {
        try {
          await disk.stat(full(relative));
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw error;
        }
      },
      read: (relative: string) => disk.readFile(full(relative), "utf8"),
      write: (relative: string, content: string) => disk.writeFile(full(relative), content, "utf8"),
      rmdir: (relative: string) => disk.rm(full(relative), { recursive: true }),
      remove: (relative: string) => disk.unlink(full(relative)),
      mkdir: (relative: string) => disk.mkdir(full(relative)),
      list: async (relative: string) => {
        const entries = await disk.readdir(full(relative), { withFileTypes: true });
        return {
          folders: entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => `${relative}/${entry.name}`),
          files: entries
            .filter((entry) => entry.isFile())
            .map((entry) => `${relative}/${entry.name}`),
        };
      },
      process: async (relative: string, update: (content: string) => string) => {
        const next = update(await disk.readFile(full(relative), "utf8"));
        await disk.writeFile(full(relative), next, "utf8");
        return next;
      },
    }
  );
  return {
    vault: {
      adapter,
      configDir: ".fixture-config",
      getAbstractFileByPath: () => null,
      getRoot: () => null,
      on: () => ({}),
      offref: () => undefined,
    },
    workspace: { getActiveFile: () => null },
    metadataCache: { on: () => ({}), offref: () => undefined },
  } as unknown as App;
}

async function changeModels(manager: AgentSessionManager, enabledModels: string[]): Promise<void> {
  const original = manager.onInstallStateChanged.bind(manager);
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const completed = new Promise<void>((done, failed) => {
    resolve = done;
    reject = failed;
  });
  const observation = jest
    .spyOn(manager, "onInstallStateChanged")
    .mockImplementationOnce(async (id) => {
      try {
        await original(id);
        resolve();
      } catch (error) {
        reject(error);
        throw error;
      }
    });
  try {
    setSettings((current) => ({
      backends: { ...current.backends, native: { ...current.backends.native, enabledModels } },
    }));
    await completed;
  } finally {
    observation.mockRestore();
  }
}

describe("agentModeReadiness", () => {
  describe("createAgentSessionManager()", () => {
    it("retains the chat draft, saved skill preferences and existing skill link when the last model is disabled and enabled again (https://github.com/ItsDalk-Lane/Scribe/issues/21)", async () => {
      const root = await disk.mkdtemp(join(tmpdir(), "scribe-readiness-lifecycle-"));
      mockAppDataRoot = join(root, "app-data");
      __resetVaultBaseCache();
      const host = window as unknown as { require?: (id: string) => unknown };
      const originalRequire = host.require;
      host.require = () => ({ ipcRenderer: { sendSync: () => false } });
      const app = makeApp(root);
      setSettings((current) => ({
        scribeFolder: "scribe",
        providers: {
          local: {
            providerId: "local",
            providerType: "openai-compatible",
            displayName: "Local test provider",
            origin: { kind: "byok" },
            baseUrl: "http://localhost:1234/v1",
            requiresApiKey: false,
            addedAt: 1,
          },
        },
        configuredModels: [
          {
            configuredModelId: "one",
            providerId: "local",
            info: { id: "one", displayName: "One" },
            configuredAt: 1,
          },
        ],
        backends: { native: { enabledModels: ["one"] } },
        agentMode: {
          ...current.agentMode,
          notificationSound: false,
          skills: {
            ...current.agentMode.skills,
            builtinPreferences: { "json-canvas": { disabled: true } },
          },
        },
      }));
      const plugin = {
        app,
        manifest: { version: "test" },
        saveData: async () => undefined,
      } as unknown as ScribePlugin;
      let sessionManager: AgentSessionManager | undefined;
      try {
        sessionManager = createAgentSessionManager(app, plugin);
        await sessionManager.preloadModels("native");
        const skills = SkillManager.getInstance();
        expect(await skills.refresh()).toMatchObject({ ok: true, reconcileErrorCount: 0 });
        const link = join(root, ".scribe", "skills", "obsidian-markdown");
        const skillFile = join(root, "scribe", "skills", "obsidian-markdown", "SKILL.md");
        expect((await disk.lstat(link)).isSymbolicLink()).toBe(true);
        const originalLink = await disk.readlink(link);
        const originalSkill = await disk.readFile(skillFile);
        const preferences = { "json-canvas": { disabled: true } };
        expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("ready");
        const chat = await sessionManager.createSession("native");
        await chat.ready;
        const draft = "A test draft that has not been sent";
        sessionManager.drafts.update(chat.chatInputId, (current) => ({ ...current, input: draft }));

        await changeModels(sessionManager, []);

        expect(
          sessionManager.getSessions().some((item) => item.internalId === chat.internalId)
        ).toBe(true);
        expect(sessionManager.drafts.get(chat.chatInputId)?.input).toBe(draft);
        expect(getSettings().agentMode.skills.builtinPreferences).toEqual(preferences);
        expect(await disk.readlink(link)).toBe(originalLink);
        expect(await disk.readFile(skillFile)).toEqual(originalSkill);
        expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).not.toBe("ready");

        await changeModels(sessionManager, ["one"]);

        expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("ready");
        const restoredChats = sessionManager
          .getSessions()
          .filter((item) => item.chatInputId === chat.chatInputId);
        expect(restoredChats).toHaveLength(1);
        expect(restoredChats[0].projectId).toBe(chat.projectId);
        expect(sessionManager.getActiveSession()?.chatInputId).toBe(chat.chatInputId);
        expect(sessionManager.drafts.get(chat.chatInputId)?.input).toBe(draft);
        expect(getSettings().agentMode.skills.builtinPreferences).toEqual(preferences);
        expect(await disk.readlink(link)).toBe(originalLink);
        expect(await disk.readFile(skillFile)).toEqual(originalSkill);
      } finally {
        await sessionManager?.shutdown();
        SkillManager.resetForTesting();
        __resetVaultBaseCache();
        host.require = originalRequire;
        await disk.rm(root, { recursive: true, force: true });
      }
    });
  });
});
