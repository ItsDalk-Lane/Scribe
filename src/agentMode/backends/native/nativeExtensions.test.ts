import {
  createNativeExtensionManager,
  getNativeScopedSkills,
  readNativeExtensions,
  readNativeExtensionRuntime,
} from "@/agentMode/backends/native/nativeExtensions";
import { getManagedSkills } from "@/agentMode/skills/SkillManager";
import type { Skill } from "@/agentMode/skills/types";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { EMPTY_COMMAND } from "@/commands/constants";
import { getCachedCustomCommands } from "@/commands/state";
import type { CustomCommand } from "@/commands/type";

jest.mock("@/agentMode/skills/SkillManager", () => ({ getManagedSkills: jest.fn() }));
jest.mock("@/commands/state", () => ({ getCachedCustomCommands: jest.fn() }));
jest.mock("@/commands/customCommandManager", () => ({
  CustomCommandManager: { getInstance: jest.fn() },
}));
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
const command: CustomCommand = {
  ...EMPTY_COMMAND,
  title: "Summarize",
  content: "Summarize this selection",
  enabled: true,
};
const scope = { kind: "project" as const, cwd: "/vault" };

describe("nativeExtensions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getManagedSkills).mockReturnValue([shared, first, second]);
    jest.mocked(getCachedCustomCommands).mockReturnValue([command]);
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
    it("lists only registered native skill, command and genuine delegation entries without scanning files", () => {
      const groups = readNativeExtensions({ cwd: "/vault/first" });
      expect(groups.map((group) => group.kind)).toEqual(["skill", "command", "subagent"]);
      expect(groups[0].items.map((item) => item.name)).toEqual(["shared", "first"]);
      expect(groups[1].items[0]).toMatchObject({
        name: "Summarize",
        availability: "loaded",
        capabilities: { edit: true, delete: true, toggle: true },
      });
      expect(groups[2].items[0]).toMatchObject({
        name: "delegate_task",
        availability: "loaded",
        readOnly: true,
      });
      expect(CustomCommandManager.getInstance).not.toHaveBeenCalled();
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
      jest
        .mocked(getCachedCustomCommands)
        .mockReturnValue([command, { ...command, title: "Disabled", enabled: false }]);
      expect(readNativeExtensionRuntime("/vault/first")).toMatchObject({
        skills: ["shared", "first"],
        manualSkills: ["first"],
        disabledSkills: ["disabled"],
        commands: ["Summarize"],
        builtinCommands: ["compact"],
        subagents: [{ name: "delegate_task" }],
        hooks: [],
        plugins: [],
        mcpServers: [],
      });
      expect(CustomCommandManager.getInstance).not.toHaveBeenCalled();
    });
  });
  describe("createNativeExtensionManager()", () => {
    const writes = {
      createCommand: jest.fn().mockResolvedValue(undefined),
      updateCommand: jest.fn().mockResolvedValue(undefined),
      deleteCommand: jest.fn().mockResolvedValue(undefined),
    };
    beforeEach(() => {
      jest
        .mocked(CustomCommandManager.getInstance)
        .mockReturnValue(writes as unknown as CustomCommandManager);
    });
    it("lists scope-owned registrations once and opens their current content", async () => {
      const manager = createNativeExtensionManager({ cwd: "/vault" });
      expect(await manager.list("command", { kind: "user" })).toEqual([]);
      expect(await manager.list("command", { kind: "project", cwd: "/vault/first" })).toEqual([]);
      expect(
        (await manager.list("skill", { kind: "project", cwd: "/vault/first" })).map(
          (item) => item.name
        )
      ).toEqual(["first"]);
      const [item] = await manager.list("command", scope);
      expect(await manager.details(item)).toMatchObject({
        content: command.content,
        config: command,
        revision: expect.any(String),
      });
      const [skill] = await manager.list("skill", scope);
      expect(await manager.details(skill)).toMatchObject({ content: shared.body });
      const [agent] = await manager.list("subagent", scope);
      expect(await manager.details(agent)).toMatchObject({
        content: expect.stringContaining("independent Scribe"),
      });
    });
    it("reuses native command editing, enablement and deletion while preserving existing command metadata", async () => {
      const manager = createNativeExtensionManager({ cwd: "/vault" });
      const [item] = await manager.list("command", scope);
      const original = await manager.details(item);
      await manager.save({
        kind: "command",
        scope,
        name: "Summarize",
        content: "New instruction",
        original,
      });
      expect(writes.updateCommand).toHaveBeenCalledWith(
        { ...command, content: "New instruction" },
        "Summarize",
        false,
        command
      );
      await manager.toggle(original, false);
      expect(writes.updateCommand).toHaveBeenCalledWith(
        { ...command, enabled: false },
        "Summarize",
        false,
        command
      );
      await manager.delete(original);
      expect(writes.deleteCommand).toHaveBeenCalledWith(command);
      await manager.save({ kind: "command", scope, name: "Rewrite", content: "Rewrite this" });
      expect(writes.createCommand).toHaveBeenCalledWith({
        ...EMPTY_COMMAND,
        title: "Rewrite",
        content: "Rewrite this",
      });
    });
    it("rejects stale edits, invalid names and unsupported old configuration actions before touching storage", async () => {
      const manager = createNativeExtensionManager({ cwd: "/vault" });
      const [item] = await manager.list("command", scope);
      const original = await manager.details(item);
      jest
        .mocked(getCachedCustomCommands)
        .mockReturnValue([{ ...command, content: "User changed it" }]);
      await expect(
        manager.save({ kind: "command", scope, name: "Summarize", content: "Overwrite", original })
      ).rejects.toThrow("changed");
      await expect(
        manager.save({ kind: "command", scope, name: "../outside", content: "Overwrite" })
      ).rejects.toThrow("invalid characters");
      await expect(
        manager.save({ kind: "command", scope: { kind: "user" }, name: "New", content: "Body" })
      ).rejects.toThrow("not supported");
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
      expect(writes.createCommand).not.toHaveBeenCalled();
      expect(writes.updateCommand).not.toHaveBeenCalled();
      expect(writes.deleteCommand).not.toHaveBeenCalled();
    });
  });
});
