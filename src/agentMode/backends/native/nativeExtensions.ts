import { getSubagents } from "@/agentMode/subagents/SubagentManager";
import type {
  AgentExtensionGroup,
  AgentExtensionItem,
  AgentExtensionRuntimeSnapshot,
} from "@/agentMode/session/extensionInventory";
import type {
  AgentExtensionManager,
  AgentExtensionScope,
} from "@/agentMode/session/extensionManagement";
import { filterSkillsForScope } from "@/agentMode/session/scopedSkills";
import { getManagedSkills } from "@/agentMode/skills/SkillManager";
import type { Skill } from "@/agentMode/skills/types";
import { normalizeAbsPath } from "@/utils/pathUtils";
import { sha256 } from "@/utils/hash";
import { frozenOr } from "@/utils/sliceCache";

export const NATIVE_SKILLS_PROJECT_DIR = ".scribe/skills";
const EMPTY_ENTRIES: readonly never[] = Object.freeze([]);
const READ_ONLY = Object.freeze({ edit: false, delete: false, toggle: false });
const SUBAGENT = Object.freeze({
  name: "delegate_task",
  description:
    "Delegate a task to an independent Scribe child agent using the current model and permission policy.",
});
const SUBAGENTS = Object.freeze([SUBAGENT]);
const BUILTIN_COMMANDS = Object.freeze(["compact"]);

export function getNativeScopedSkills(cwd: string | null): readonly Skill[] {
  return filterSkillsForScope(getManagedSkills(), cwd, NATIVE_SKILLS_PROJECT_DIR);
}

function skillItem(skill: Skill, cwd: string | null): AgentExtensionItem {
  const enabled = skill.enabledAgents.includes("native");
  const available = enabled && (!skill.disableModelInvocation || skill.userInvocable !== false);
  return {
    id: `skill:${skill.filePath}`,
    name: skill.name,
    description: skill.description,
    source: "project",
    kind: "skill",
    enabled,
    location: skill.filePath,
    runtimeName: skill.name,
    availability: !enabled
      ? "disabled"
      : !available
        ? "not_loaded"
        : skill.disableModelInvocation
          ? "manual_only"
          : "loaded",
    unavailableReason:
      enabled && !available ? "This skill permits neither model nor manual invocation." : undefined,
    readOnly: true,
    capabilities: READ_ONLY,
    ...(cwd
      ? {
          target: {
            path: skill.filePath,
            format: "markdown" as const,
            scope: { kind: "project" as const, cwd },
          },
        }
      : {}),
  };
}

export function readNativeExtensions({
  cwd,
}: {
  cwd: string | null;
}): readonly AgentExtensionGroup[] {
  return [
    {
      kind: "skill",
      status: "partial",
      warnings: EMPTY_ENTRIES,
      items: frozenOr(
        getNativeScopedSkills(cwd).map((skill) => skillItem(skill, cwd)),
        EMPTY_ENTRIES
      ),
    },
    {
      kind: "command",
      status: "partial",
      warnings: EMPTY_ENTRIES,
      items: EMPTY_ENTRIES,
    },
    {
      kind: "subagent",
      status: "partial",
      warnings: EMPTY_ENTRIES,
      items: [
        ...getSubagents().map(
          (entry): AgentExtensionItem => ({
            id: `subagent:${entry.id}`,
            name: entry.name,
            description: entry.description,
            kind: "subagent",
            source: "runtime",
            enabled: entry.enabled,
            availability: entry.enabled ? "loaded" : "disabled",
            readOnly: true,
            capabilities: READ_ONLY,
          })
        ),
        {
          id: "builtin:delegate_task",
          ...SUBAGENT,
          source: "runtime",
          kind: "subagent",
          availability: "loaded",
          builtin: true,
          readOnly: true,
          capabilities: READ_ONLY,
        },
      ],
    },
  ];
}

export function readNativeExtensionRuntime(cwd: string | null): AgentExtensionRuntimeSnapshot {
  const skills = getNativeScopedSkills(cwd);
  return {
    skills: frozenOr(
      skills
        .filter(
          (skill) =>
            skill.enabledAgents.includes("native") &&
            (!skill.disableModelInvocation || skill.userInvocable !== false)
        )
        .map((skill) => skill.name),
      EMPTY_ENTRIES
    ),
    disabledSkills: frozenOr(
      skills.filter((skill) => !skill.enabledAgents.includes("native")).map((skill) => skill.name),
      EMPTY_ENTRIES
    ),
    manualSkills: frozenOr(
      skills
        .filter(
          (skill) =>
            skill.enabledAgents.includes("native") &&
            skill.disableModelInvocation &&
            skill.userInvocable !== false
        )
        .map((skill) => skill.name),
      EMPTY_ENTRIES
    ),
    commands: EMPTY_ENTRIES,
    builtinCommands: BUILTIN_COMMANDS,
    subagents: [
      ...SUBAGENTS,
      ...getSubagents()
        .filter((entry) => entry.enabled)
        .map((entry) => ({ name: entry.name, description: entry.description })),
    ],
    hooks: EMPTY_ENTRIES,
    hooksDisabled: true,
    plugins: EMPTY_ENTRIES,
    failedPlugins: EMPTY_ENTRIES,
    mcpServers: EMPTY_ENTRIES,
  };
}

async function unsupported(): Promise<never> {
  throw new Error("This configuration is not supported by the native Scribe runtime.");
}

export function createNativeExtensionManager({
  cwd,
}: {
  cwd: string | null;
}): AgentExtensionManager {
  function ownsScope(scope: AgentExtensionScope): boolean {
    return (
      scope.kind === "project" &&
      cwd !== null &&
      normalizeAbsPath(scope.cwd) === normalizeAbsPath(cwd)
    );
  }
  return {
    async list(kind, scope) {
      if (scope.kind === "user") return EMPTY_ENTRIES;
      const group = readNativeExtensions({ cwd: scope.cwd }).find((entry) => entry.kind === kind);
      if (!group) return EMPTY_ENTRIES;
      if (kind !== "skill") return ownsScope(scope) ? group.items : EMPTY_ENTRIES;
      return frozenOr(
        group.items.filter(
          (item) =>
            ownsScope(scope) ||
            getManagedSkills().find((skill) => `skill:${skill.filePath}` === item.id)?.location
              .kind === "project"
        ),
        EMPTY_ENTRIES
      );
    },
    async details(item) {
      if (item.kind === "skill") {
        const skill = getManagedSkills().find((entry) => `skill:${entry.filePath}` === item.id);
        if (!skill) throw new Error("The skill is no longer registered.");
        return {
          item: skillItem(skill, cwd),
          revision: skill.contentHash ?? sha256(skill.body),
          content: skill.body,
        };
      }
      if (item.kind === "subagent" && item.id === "builtin:delegate_task")
        return { item, revision: "builtin:delegate_task", content: SUBAGENT.description };
      return unsupported();
    },
    save: unsupported,
    toggle: unsupported,
    delete: unsupported,
    import: unsupported,
    pluginAction: unsupported,
    marketplaces: unsupported,
    testConnection: unsupported,
  };
}
