import { getSubagents } from "@/agentMode/subagents/SubagentManager";
import {
  AGENT_COMMANDS_DIRECTORY,
  AgentCommandManager,
  getAgentCommands,
  type AgentCommandDefinition,
} from "@/agentMode/agentCommands/AgentCommandManager";
import { AGENT_BUILTIN_COMMANDS } from "@/agentMode/agentCommands/builtinAgentCommands";
import type {
  AgentExtensionGroup,
  AgentExtensionItem,
  AgentExtensionRuntimeSnapshot,
} from "@/agentMode/session/extensionInventory";
import type {
  AgentExtensionDetails,
  AgentExtensionManager,
  AgentExtensionScope,
} from "@/agentMode/session/extensionManagement";
import { filterSkillsForScope } from "@/agentMode/session/scopedSkills";
import { getManagedSkills } from "@/agentMode/skills/SkillManager";
import type { Skill } from "@/agentMode/skills/types";
import { COMPACT_COMMAND_NAME } from "@/commands/compactCommand";
import { t } from "@/lib/i18n";
import { getSettings, setSettings } from "@/settings/model";
import { normalizeAbsPath } from "@/utils/pathUtils";
import { sha256 } from "@/utils/hash";
import { frozenOr } from "@/utils/sliceCache";
import { v4 as uuidv4 } from "uuid";

export const NATIVE_SKILLS_PROJECT_DIR = ".scribe/skills";
const EMPTY_ENTRIES: readonly never[] = Object.freeze([]);
const READ_ONLY = Object.freeze({ edit: false, delete: false, toggle: false });
const SAVED_COMMAND_ACTIONS = Object.freeze({ edit: true, delete: true, toggle: true });
const BUILTIN_COMMAND_ACTIONS = Object.freeze({ edit: false, delete: false, toggle: true });
const SUBAGENT = Object.freeze({
  name: "delegate_task",
  description:
    "Delegate a task to an independent Scribe child agent using the current model and permission policy.",
});
const SUBAGENTS = Object.freeze([SUBAGENT]);
const SAVED_COMMAND_PREFIX = "command:";
const BUILTIN_COMMAND_PREFIX = "builtin-command:";

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

function disabledBuiltinCommands(): readonly string[] {
  return getSettings().agentMode.disabledBuiltinCommands;
}

function builtinCommandItem(name: string): AgentExtensionItem {
  return {
    id: `${BUILTIN_COMMAND_PREFIX}${name}`,
    name,
    description:
      name === COMPACT_COMMAND_NAME ? t("Summarize this chat to free up context") : undefined,
    kind: "command",
    source: "runtime",
    enabled: !disabledBuiltinCommands().includes(name),
    builtin: true,
    capabilities: BUILTIN_COMMAND_ACTIONS,
  };
}

function savedCommandItem(command: AgentCommandDefinition, cwd: string | null): AgentExtensionItem {
  return {
    id: `${SAVED_COMMAND_PREFIX}${command.id}`,
    name: command.name,
    description: command.description,
    kind: "command",
    source: "project",
    enabled: command.enabled,
    capabilities: SAVED_COMMAND_ACTIONS,
    ...(cwd
      ? {
          target: {
            path: `${AGENT_COMMANDS_DIRECTORY}/${command.id}.json`,
            format: "json" as const,
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
      items: [
        ...AGENT_BUILTIN_COMMANDS.map((name) => builtinCommandItem(name)),
        ...getAgentCommands().map((command) => savedCommandItem(command, cwd)),
      ],
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
  const disabledBuiltins = disabledBuiltinCommands();
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
    commands: frozenOr(
      getAgentCommands()
        .filter((command) => command.enabled)
        .map((command) => command.name),
      EMPTY_ENTRIES
    ),
    builtinCommands: frozenOr(
      AGENT_BUILTIN_COMMANDS.filter((name) => !disabledBuiltins.includes(name)),
      EMPTY_ENTRIES
    ),
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

function commandIdOf(item: AgentExtensionItem): string {
  return item.id.slice(SAVED_COMMAND_PREFIX.length);
}

function descriptionOf(config: Record<string, unknown> | undefined): string {
  return typeof config?.description === "string" ? config.description : "";
}

async function savedCommandDetails(item: AgentExtensionItem): Promise<AgentExtensionDetails> {
  await AgentCommandManager.getInstance().refresh();
  const command = getAgentCommands().find((entry) => entry.id === commandIdOf(item));
  if (!command) throw new Error(t("This command no longer exists."));
  return {
    item,
    revision: command.revision ?? "",
    content: command.content,
    config: { description: command.description },
  };
}

function setBuiltinCommandEnabled(name: string, enabled: boolean): void {
  setSettings((current) => {
    const others = current.agentMode.disabledBuiltinCommands.filter((entry) => entry !== name);
    return {
      agentMode: {
        ...current.agentMode,
        disabledBuiltinCommands: enabled ? others : [...others, name],
      },
    };
  });
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
      if (kind === "command" && ownsScope(scope)) await AgentCommandManager.getInstance().refresh();
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
      if (item.kind === "command" && item.builtin) return { item, revision: item.id };
      if (item.kind === "command") return savedCommandDetails(item);
      return unsupported();
    },
    async save(draft) {
      if (draft.kind !== "command") return unsupported();
      const original = draft.original;
      await AgentCommandManager.getInstance().save({
        id: original ? commandIdOf(original.item) : uuidv4(),
        name: draft.name,
        description: descriptionOf(draft.config),
        content: draft.content ?? "",
        enabled: original?.item.enabled ?? true,
        revision: original?.revision,
      });
    },
    async toggle(details, enabled) {
      if (details.item.kind !== "command") return unsupported();
      if (details.item.builtin) {
        setBuiltinCommandEnabled(details.item.name, enabled);
        return;
      }
      await AgentCommandManager.getInstance().save({
        id: commandIdOf(details.item),
        name: details.item.name,
        description: descriptionOf(details.config),
        content: details.content ?? "",
        enabled,
        revision: details.revision,
      });
    },
    async delete(details) {
      if (details.item.kind !== "command" || details.item.builtin) return unsupported();
      await AgentCommandManager.getInstance().remove({
        id: commandIdOf(details.item),
        revision: details.revision,
      });
    },
    import: unsupported,
    pluginAction: unsupported,
    marketplaces: unsupported,
    testConnection: unsupported,
  };
}
