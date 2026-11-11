import {
  createNativeExtensionManager,
  getNativeScopedSkills,
  readNativeExtensions,
  readNativeExtensionRuntime,
} from "@/agentMode/backends/native/nativeExtensions";
import { getSubagents } from "@/agentMode/subagents/SubagentManager";
import { getManagedSkills } from "@/agentMode/skills/SkillManager";
import type { Skill } from "@/agentMode/skills/types";
import type { AgentExtensionItem } from "@/agentMode/session/extensionInventory";
import {
  AgentCommandManager,
  getAgentCommands,
  type AgentCommandDefinition,
} from "@/agentMode/agentCommands/AgentCommandManager";
import { getSettings, setSettings, type ScribeSettings } from "@/settings/model";

jest.mock("@/agentMode/skills/SkillManager", () => ({ getManagedSkills: jest.fn() }));
jest.mock("@/logger");
jest.mock("@/agentMode/subagents/SubagentManager", () => ({ getSubagents: jest.fn() }));
jest.mock("@/agentMode/agentCommands/AgentCommandManager", () => ({
  ...jest.requireActual<typeof import("@/agentMode/agentCommands/AgentCommandManager")>(
    "@/agentMode/agentCommands/AgentCommandManager"
  ),
  AgentCommandManager: { getInstance: jest.fn() },
  getAgentCommands: jest.fn(() => []),
}));
jest.mock("@/settings/model", () => ({ getSettings: jest.fn(), setSettings: jest.fn() }));

const shared: Skill = {
  name: "shared",
  description: "Shared instructions",
  filePath: "/vault/Scribe/skills/shared/SKILL.md",
  dirPath: "/vault/Scribe/skills/shared",
  body: "Shared body",
  enabledAgents: ["native"],
  location: { kind: "canonical" },
};
const first: Skill = {
  ...shared,
  name: "first",
  filePath: "/vault/first/.scribe/skills/first/SKILL.md",
  dirPath: "/vault/first/.scribe/skills/first",
  location: { kind: "project", agentDirs: ["native"] },
};
const second: Skill = {
  ...first,
  name: "second",
  filePath: "/vault/second/.scribe/skills/second/SKILL.md",
  dirPath: "/vault/second/.scribe/skills/second",
};
const scope = { kind: "project" as const, cwd: "/vault" };
const savedCommand: AgentCommandDefinition = {
  id: "translate",
  name: "翻译",
  description: "译成英文",
  content: "请翻译",
  enabled: true,
  revision: "r1",
};
const settingsWith = (disabledBuiltinCommands: string[]) =>
  ({ agentMode: { disabledBuiltinCommands } }) as unknown as ScribeSettings;
function fakeCommandManager(overrides: { save?: jest.Mock; remove?: jest.Mock } = {}) {
  return {
    save: jest.fn(async () => {}),
    remove: jest.fn(async () => {}),
    refresh: jest.fn(async () => []),
    ...overrides,
  } as unknown as AgentCommandManager;
}

describe("nativeExtensions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getSubagents).mockReturnValue([]);
    jest.mocked(getManagedSkills).mockReturnValue([shared, first, second]);
    jest.mocked(getSettings).mockReturnValue(settingsWith([]));
    jest.mocked(getAgentCommands).mockReturnValue([]);
  });
  describe("getNativeScopedSkills()", () => {
    it("follows the current project while retaining shared skills and rereading registration changes", () => {
      expect(getNativeScopedSkills("/vault/first").map((skill) => skill.name)).toEqual([
        "shared",
        "first",
      ]);
      expect(getNativeScopedSkills("/vault/second").map((skill) => skill.name)).toEqual([
        "shared",
        "second",
      ]);
      jest.mocked(getManagedSkills).mockReturnValue([]);
      expect(getNativeScopedSkills("/vault/first")).toEqual([]);
    });
  });
  describe("readNativeExtensions()", () => {
    it("lists custom definitions including disabled agents while keeping disabled definitions out of runtime discovery", () => {
      jest.mocked(getSubagents).mockReturnValue([
        {
          id: "review",
          name: "Reviewer",
          description: "Review notes",
          instructions: "Check sources",
          enabled: true,
        },
        {
          id: "writing",
          name: "Writer",
          description: "Write notes",
          instructions: "Write clearly",
          enabled: false,
        },
      ]);
      const items = readNativeExtensions({ cwd: "/vault" }).find(
        (group) => group.kind === "subagent"
      )!.items;
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Reviewer", enabled: true, availability: "loaded" }),
          expect.objectContaining({ name: "Writer", enabled: false, availability: "disabled" }),
          expect.objectContaining({ name: "delegate_task" }),
        ])
      );
      expect(readNativeExtensionRuntime("/vault").subagents!.map((entry) => entry.name)).toEqual([
        "delegate_task",
        "Reviewer",
      ]);
    });
    it("lists registered native skills, the built-in command and genuine delegation entries", () => {
      const groups = readNativeExtensions({ cwd: "/vault/first" });
      expect(groups.map((group) => group.kind)).toEqual(["skill", "command", "subagent"]);
      expect(groups[0].items.map((item) => item.name)).toEqual(["shared", "first"]);
      expect(groups[1].items.map((item) => item.name)).toEqual(["compact"]);
      expect(groups[2].items[0]).toMatchObject({
        name: "delegate_task",
        availability: "loaded",
        readOnly: true,
      });
    });
    it("lists the built-in compact command with a switch and saved Agent commands with edit, switch and delete actions", () => {
      jest.mocked(getAgentCommands).mockReturnValue([savedCommand]);
      const items = readNativeExtensions({ cwd: "/vault" }).find(
        (group) => group.kind === "command"
      )!.items;
      expect(items).toEqual([
        expect.objectContaining({
          id: "builtin-command:compact",
          name: "compact",
          enabled: true,
          builtin: true,
          capabilities: { edit: false, delete: false, toggle: true },
        }),
        expect.objectContaining({
          id: "command:translate",
          name: "翻译",
          description: "译成英文",
          enabled: true,
          capabilities: { edit: true, delete: true, toggle: true },
          target: expect.objectContaining({ path: ".scribe/agent-commands/translate.json" }),
        }),
      ]);
    });
    it("shows a switched-off built-in command as disabled in the inventory", () => {
      jest.mocked(getSettings).mockReturnValue(settingsWith(["compact"]));
      const [compact] = readNativeExtensions({ cwd: "/vault" }).find(
        (group) => group.kind === "command"
      )!.items;
      expect(compact).toMatchObject({ name: "compact", enabled: false });
    });
  });
  describe("readNativeExtensionRuntime()", () => {
    it("reports disabled and manual skills honestly, with no external plugins, hooks or MCP connections", () => {
      jest
        .mocked(getManagedSkills)
        .mockReturnValue([
          shared,
          { ...first, disableModelInvocation: true },
          { ...shared, name: "disabled", enabledAgents: [] },
          { ...shared, name: "inaccessible", disableModelInvocation: true, userInvocable: false },
        ]);
      expect(readNativeExtensionRuntime("/vault/first")).toMatchObject({
        skills: ["shared", "first"],
        manualSkills: ["first"],
        disabledSkills: ["disabled"],
        commands: [],
        builtinCommands: ["compact"],
        subagents: [{ name: "delegate_task" }],
        hooks: [],
        plugins: [],
        mcpServers: [],
      });
    });
    it("reports only enabled saved commands and built-in commands that are still switched on", () => {
      jest
        .mocked(getAgentCommands)
        .mockReturnValue([
          savedCommand,
          { ...savedCommand, id: "draft", name: "草稿", enabled: false },
        ]);
      jest.mocked(getSettings).mockReturnValue(settingsWith(["compact"]));
      expect(readNativeExtensionRuntime("/vault")).toMatchObject({
        commands: ["翻译"],
        builtinCommands: [],
      });
    });
  });
  describe("createNativeExtensionManager()", () => {
    it("lists scope-owned registrations once and opens their current content", async () => {
      const manager = createNativeExtensionManager({ cwd: "/vault" });
      expect(await manager.list("command", { kind: "user" })).toEqual([]);
      expect(await manager.list("command", { kind: "project", cwd: "/vault/first" })).toEqual([]);
      expect(
        (await manager.list("skill", { kind: "project", cwd: "/vault/first" })).map(
          (item) => item.name
        )
      ).toEqual(["first"]);
      const [skill] = await manager.list("skill", scope);
      expect(await manager.details(skill)).toMatchObject({ content: shared.body });
      const [agent] = await manager.list("subagent", scope);
      expect(await manager.details(agent)).toMatchObject({
        content: expect.stringContaining("independent Scribe"),
      });
    });
    it("lists the built-in command and saved Agent commands once, for the vault that owns them", async () => {
      jest.mocked(AgentCommandManager.getInstance).mockReturnValue(fakeCommandManager());
      jest.mocked(getAgentCommands).mockReturnValue([savedCommand]);
      const manager = createNativeExtensionManager({ cwd: "/vault" });
      expect((await manager.list("command", scope)).map((item) => item.id)).toEqual([
        "builtin-command:compact",
        "command:translate",
      ]);
      expect(await manager.list("command", { kind: "project", cwd: "/vault/first" })).toEqual([]);
    });
    it("opens a saved Agent command with its stored content, description and revision", async () => {
      jest.mocked(AgentCommandManager.getInstance).mockReturnValue(fakeCommandManager());
      jest.mocked(getAgentCommands).mockReturnValue([savedCommand]);
      const manager = createNativeExtensionManager({ cwd: "/vault" });
      const [, saved] = await manager.list("command", scope);
      expect(await manager.details(saved)).toMatchObject({
        revision: "r1",
        content: "请翻译",
        config: { description: "译成英文" },
      });
    });
    it("creates a new Agent command under a generated identifier, and editing keeps its identifier, revision and switch", async () => {
      const save = jest.fn(async () => {});
      jest.mocked(AgentCommandManager.getInstance).mockReturnValue(fakeCommandManager({ save }));
      jest.mocked(getAgentCommands).mockReturnValue([savedCommand]);
      const manager = createNativeExtensionManager({ cwd: "/vault" });
      await manager.save({
        kind: "command",
        scope,
        name: "周报",
        content: "写周报",
        config: { description: "" },
      });
      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: expect.any(String), name: "周报", content: "写周报" })
      );
      const [, saved] = await manager.list("command", scope);
      await manager.save({
        kind: "command",
        scope,
        name: "翻译",
        content: "新内容",
        config: { description: "译成英文" },
        original: { item: { ...saved, enabled: false }, revision: "r1" },
      });
      expect(save).toHaveBeenLastCalledWith({
        id: "translate",
        name: "翻译",
        description: "译成英文",
        content: "新内容",
        enabled: false,
        revision: "r1",
      });
    });
    it("switches a saved Agent command by rewriting it with the revision it was opened with", async () => {
      const save = jest.fn(async () => {});
      jest.mocked(AgentCommandManager.getInstance).mockReturnValue(fakeCommandManager({ save }));
      const saved: AgentExtensionItem = {
        id: "command:translate",
        name: "翻译",
        description: "译成英文",
        kind: "command",
        source: "project",
        enabled: true,
        capabilities: { edit: true, delete: true, toggle: true },
      };
      await createNativeExtensionManager({ cwd: "/vault" }).toggle(
        { item: saved, revision: "r1", content: "请翻译", config: { description: "译成英文" } },
        false
      );
      expect(save).toHaveBeenCalledWith({
        id: "translate",
        name: "翻译",
        description: "译成英文",
        content: "请翻译",
        enabled: false,
        revision: "r1",
      });
    });
    it("turns a built-in command off by adding it to the disabled list and back on by removing it", async () => {
      const compact: AgentExtensionItem = {
        id: "builtin-command:compact",
        name: "compact",
        kind: "command",
        source: "runtime",
        builtin: true,
        enabled: true,
        capabilities: { edit: false, delete: false, toggle: true },
      };
      const manager = createNativeExtensionManager({ cwd: "/vault" });
      await manager.toggle({ item: compact, revision: "builtin-command:compact" }, false);
      const turnOff = jest.mocked(setSettings).mock.calls.at(-1)![0] as (
        current: ScribeSettings
      ) => Partial<ScribeSettings>;
      expect(turnOff(settingsWith([])).agentMode?.disabledBuiltinCommands).toEqual(["compact"]);
      await manager.toggle({ item: compact, revision: "builtin-command:compact" }, true);
      const turnOn = jest.mocked(setSettings).mock.calls.at(-1)![0] as (
        current: ScribeSettings
      ) => Partial<ScribeSettings>;
      expect(turnOn(settingsWith(["compact"])).agentMode?.disabledBuiltinCommands).toEqual([]);
    });
    it("deletes a saved Agent command against the revision it was opened with and refuses to delete built-in commands", async () => {
      const remove = jest.fn(async () => {});
      jest.mocked(AgentCommandManager.getInstance).mockReturnValue(fakeCommandManager({ remove }));
      const manager = createNativeExtensionManager({ cwd: "/vault" });
      const saved: AgentExtensionItem = {
        id: "command:translate",
        name: "翻译",
        kind: "command",
        source: "project",
        enabled: true,
        capabilities: { edit: true, delete: true, toggle: true },
      };
      await manager.delete({ item: saved, revision: "r1" });
      expect(remove).toHaveBeenCalledWith({ id: "translate", revision: "r1" });
      const compact: AgentExtensionItem = {
        id: "builtin-command:compact",
        name: "compact",
        kind: "command",
        source: "runtime",
        builtin: true,
        enabled: true,
      };
      await expect(
        manager.delete({ item: compact, revision: "builtin-command:compact" })
      ).rejects.toThrow("not supported");
    });
    it("rejects unsupported configuration actions before touching storage", async () => {
      const manager = createNativeExtensionManager({ cwd: "/vault" });
      await expect(manager.import({ kind: "plugin", scope, content: "{}" })).rejects.toThrow(
        "not supported"
      );
      await expect(
        manager.pluginAction({ action: "install", scope, plugin: "old-plugin" })
      ).rejects.toThrow("not supported");
      await expect(manager.marketplaces()).rejects.toThrow("not supported");
      await expect(manager.testConnection({ kind: "mcp", scope, name: "server" })).rejects.toThrow(
        "not supported"
      );
    });
  });
});
