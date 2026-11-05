import type { AgentExtensionItem } from "@/agentMode/session/extensionInventory";
import type { BackendId, Skill } from "@/agentMode/skills/types";
import { decideToggleAction } from "@/agentMode/skills/toggleDecision";
import { requireNodeModule } from "@/utils/desktopRuntime";

function resolvedPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return requireNodeModule<typeof import("node:fs")>("fs").realpathSync(value);
  } catch {
    return value;
  }
}

export function sameSkillPath(left: string | undefined, right: string | undefined): boolean {
  const resolvedLeft = resolvedPath(left);
  return resolvedLeft !== undefined && resolvedLeft === resolvedPath(right);
}
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
    named?.find((item) => sameSkillPath(item.location ?? item.target?.path, skill.filePath)) ??
    // 同名的根范围报告不能确认项目中的另一个文件。https://github.com/ItsDalk-Lane/Scribe/issues/6
    (skill.location.kind === "canonical" &&
    skill.enabledAgents.includes(agent) &&
    named?.length === 1 &&
    !named[0].location &&
    !named[0].target?.path
      ? named[0]
      : undefined);
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
    availability:
      observed?.availability ??
      (skill.location.kind === "canonical"
        ? configured
          ? "manual_only"
          : "disabled"
        : runtimeItems && !configured
          ? "disabled"
          : undefined),
    capabilities: { edit: true, delete: true, toggle: true },
    canEnable: canEnable && observed?.canEnable !== false,
    canDisable: canDisable && observed?.canDisable !== false,
    unavailableReason:
      observed?.unavailableReason ??
      // 身份未确认时先说明状态未知，迁移限制不能代替运行状态。https://github.com/ItsDalk-Lane/Scribe/issues/6
      (configured && skill.location.kind !== "canonical" && !observed?.availability
        ? t("Availability could not be confirmed. Check again.")
        : enable.kind === "migrate-confirm" || disable.kind === "migrate-confirm"
          ? t("Move this skill to the shared folder before changing its availability.")
          : undefined),
  };
}
