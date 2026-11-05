import {
  createNativeExtensionManager,
  getNativeScopedSkills,
  readNativeExtensions,
  readNativeExtensionRuntime,
} from "@/agentMode/backends/native/nativeExtensions";
import { getManagedSkills } from "@/agentMode/skills/SkillManager";
import type { Skill } from "@/agentMode/skills/types";
import type { AgentExtensionItem } from "@/agentMode/session/extensionInventory";

jest.mock("@/agentMode/skills/SkillManager", () => ({ getManagedSkills: jest.fn() }));
jest.mock("@/logger");

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

describe("nativeExtensions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getManagedSkills).mockReturnValue([shared, first, second]);
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
    it("lists registered native skills and genuine delegation entries while leaving saved commands to their own tab", () => {
      const groups = readNativeExtensions({ cwd: "/vault/first" });
      expect(groups.map((group) => group.kind)).toEqual(["skill", "command", "subagent"]);
      expect(groups[0].items.map((item) => item.name)).toEqual(["shared", "first"]);
      expect(groups[1].items).toEqual([]);
      expect(groups[2].items[0]).toMatchObject({
        name: "delegate_task",
        availability: "loaded",
        readOnly: true,
      });
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
    it("leaves saved commands out of the agent tab and refuses to configure them there", async () => {
      const manager = createNativeExtensionManager({ cwd: "/vault" });
      expect(await manager.list("command", scope)).toEqual([]);
      const item: AgentExtensionItem = {
        id: "command:Summarize",
        name: "Summarize",
        kind: "command",
        source: "project",
        availability: "loaded",
      };
      const details = { item, revision: "any" };
      await expect(
        manager.save({ kind: "command", scope, name: "Summarize", content: "Overwrite" })
      ).rejects.toThrow("not supported");
      await expect(manager.toggle(details, false)).rejects.toThrow("not supported");
      await expect(manager.delete(details)).rejects.toThrow("not supported");
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
