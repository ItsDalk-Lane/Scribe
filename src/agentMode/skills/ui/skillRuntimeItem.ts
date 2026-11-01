import type { AgentExtensionItem } from "@/agentMode/session/extensionInventory";
import type { BackendId, Skill } from "@/agentMode/skills/types";
import { decideToggleAction } from "@/agentMode/skills/toggleDecision";
import { t } from "@/lib/i18n";

export function skillRuntimeItem(
  skill: Skill,
  agent: BackendId,
  runtimeItems?: readonly AgentExtensionItem[]
): AgentExtensionItem {
  const named = runtimeItems?.filter(
    (item) => !item.parentPluginId && (item.runtimeName ?? item.name) === skill.name
  );
  const observed =
    named?.find((item) => (item.location ?? item.target?.path) === skill.filePath) ??
    (named?.length === 1 && !named[0].location && !named[0].target?.path ? named[0] : undefined);
  const configured = skill.enabledAgents.includes(agent);
  const enable = decideToggleAction(skill, agent, true);
  const disable = decideToggleAction(skill, agent, false);
  const canEnable = enable.kind === "canonical-toggle" && !configured;
  const canDisable = disable.kind === "canonical-toggle" || disable.kind === "mirrored-remove-one";
  return {
    ...observed,
    id: skill.filePath,
    name: skill.name,
    source: "project",
    kind: "skill",
    location: skill.filePath,
    availability: observed?.availability ?? (runtimeItems && !configured ? "disabled" : undefined),
    capabilities: { edit: true, delete: true, toggle: true },
    canEnable: canEnable && observed?.canEnable !== false,
    canDisable: canDisable && observed?.canDisable !== false,
    unavailableReason:
      observed?.unavailableReason ??
      (enable.kind === "migrate-confirm" || disable.kind === "migrate-confirm"
        ? t("Move this skill to the shared folder before changing its availability.")
        : undefined),
  };
}
