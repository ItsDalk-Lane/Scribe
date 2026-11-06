import * as disk from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystemAdapter, type App } from "obsidian";
import type ScribePlugin from "@/main";
import { createAgentSessionManager } from "@/agentMode";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { NativeBackendDescriptor } from "@/agentMode/backends/native/descriptor";
import { SkillManager, getManagedSkills } from "@/agentMode/skills/SkillManager";
import { SubagentManager } from "@/agentMode/subagents/SubagentManager";
import { getSettings, setSettings } from "@/settings/model";
import { __resetVaultBaseCache } from "@/utils/vaultPath";

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

function changeModels(enabledModels: string[]): void {
  setSettings((current) => ({
    backends: { ...current.backends, native: { ...current.backends.native, enabledModels } },
  }));
}

describe("agentModeReadiness", () => {
  describe("createAgentSessionManager()", () => {
    it("does not install or recreate skill files during startup and refresh https://github.com/ItsDalk-Lane/Scribe/issues/32", async () => {
      const root = await disk.mkdtemp(join(tmpdir(), "scribe-no-bundled-skills-"));
      __resetVaultBaseCache();
      const app = makeApp(root);
      setSettings((current) => ({
        scribeFolder: "scribe",
        providers: {},
        configuredModels: [],
        agentMode: { ...current.agentMode, notificationSound: false },
      }));
      const plugin = {
        app,
        manifest: { version: "test" },
        saveData: async () => undefined,
        register: jest.fn(),
      } as unknown as ScribePlugin;
      let manager: AgentSessionManager | undefined;
      try {
        manager = createAgentSessionManager(app, plugin);
        const skills = SkillManager.getInstance();
        expect(await skills.refresh()).toMatchObject({ ok: true, skillCount: 0 });
        const skillsRoot = join(root, ".scribe", "skills");
        await expect(disk.access(skillsRoot)).rejects.toMatchObject({ code: "ENOENT" });
        const file = join(skillsRoot, "formerly-bundled", "SKILL.md");
        const content =
          '---\nname: formerly-bundled\ndescription: Existing skill\nmetadata:\n  scribe-builtin-version: "1"\n  scribe-enabled-agents: ""\n---\nUser-edited instructions';
        await disk.mkdir(join(skillsRoot, "formerly-bundled"), { recursive: true });
        await disk.writeFile(file, content);
        expect(await skills.refresh(true)).toMatchObject({ ok: true, skillCount: 1 });
        expect(await disk.readFile(file, "utf8")).toBe(content);
        expect(getManagedSkills()[0].enabledAgents).toEqual([]);
        expect(await disk.readdir(skillsRoot)).toEqual(["formerly-bundled"]);
        await disk.rm(join(skillsRoot, "formerly-bundled"), { recursive: true });
        expect(await skills.refresh(true)).toMatchObject({ ok: true, skillCount: 0 });
        expect(await disk.readdir(skillsRoot)).toEqual([]);
      } finally {
        await manager?.shutdown();
        SubagentManager.reset();
        SkillManager.resetForTesting();
        __resetVaultBaseCache();
        await disk.rm(root, { recursive: true, force: true });
      }
    });

    it("retains chat availability, draft and skills when obsolete model switches change https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
      const root = await disk.mkdtemp(join(tmpdir(), "scribe-readiness-lifecycle-"));
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
        },
      }));
      const skillDir = join(root, ".scribe", "skills", "retained-skill");
      const skillContent =
        '---\nname: retained-skill\ndescription: Retained user skill\nmetadata:\n  scribe-builtin-version: "1"\n  scribe-enabled-agents: "native"\n  user-metadata: keep\n---\nExisting user-edited instructions';
      await disk.mkdir(skillDir, { recursive: true });
      await disk.writeFile(join(skillDir, "SKILL.md"), skillContent);
      const plugin = {
        app,
        manifest: { version: "test" },
        saveData: async () => undefined,
        register: jest.fn(),
      } as unknown as ScribePlugin;
      let sessionManager: AgentSessionManager | undefined;
      try {
        sessionManager = createAgentSessionManager(app, plugin);
        await sessionManager.preloadModels("native");
        const skills = SkillManager.getInstance();
        expect(await skills.refresh()).toMatchObject({ ok: true, reconcileErrorCount: 0 });
        const skillFile = join(skillDir, "SKILL.md");
        expect((await disk.lstat(skillDir)).isSymbolicLink()).toBe(false);
        const originalSkill = await disk.readFile(skillFile);
        expect(await disk.readdir(join(root, ".scribe", "skills"))).toEqual(["retained-skill"]);
        expect(originalSkill.toString()).toBe(skillContent);
        expect(getManagedSkills()[0].enabledAgents).toEqual(["native"]);
        expect(getManagedSkills()[0]).not.toHaveProperty("builtin");
        expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("ready");
        const chat = await sessionManager.createSession("native");
        await chat.ready;
        const draft = "A test draft that has not been sent";
        sessionManager.drafts.update(chat.chatInputId, (current) => ({ ...current, input: draft }));

        changeModels([]);

        expect(
          sessionManager.getSessions().some((item) => item.internalId === chat.internalId)
        ).toBe(true);
        expect(sessionManager.drafts.get(chat.chatInputId)?.input).toBe(draft);
        expect((await disk.lstat(skillDir)).isSymbolicLink()).toBe(false);
        expect(await disk.readFile(skillFile)).toEqual(originalSkill);
        expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("ready");

        changeModels(["one"]);

        expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("ready");
        const restoredChats = sessionManager
          .getSessions()
          .filter((item) => item.chatInputId === chat.chatInputId);
        expect(restoredChats).toHaveLength(1);
        expect(restoredChats[0].projectId).toBe(chat.projectId);
        expect(sessionManager.getActiveSession()?.chatInputId).toBe(chat.chatInputId);
        expect(sessionManager.drafts.get(chat.chatInputId)?.input).toBe(draft);
        expect((await disk.lstat(skillDir)).isSymbolicLink()).toBe(false);
        expect(await disk.readFile(skillFile)).toEqual(originalSkill);
      } finally {
        await sessionManager?.shutdown();
        SubagentManager.reset();
        SkillManager.resetForTesting();
        __resetVaultBaseCache();
        host.require = originalRequire;
        await disk.rm(root, { recursive: true, force: true });
      }
    });
  });
});
