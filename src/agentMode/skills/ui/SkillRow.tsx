import React from "react";
import type { Skill, RejectedSkill, SkillSource } from "@/agentMode/skills/types";
import { SkillRowLayout } from "@/agentMode/skills/ui/SkillRowLayout";
import { useSkillIcon } from "@/agentMode/skills/ui/useSkillIcon";
import { Button } from "@/components/ui/button";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { t } from "@/lib/i18n";
import { Play, Trash2 } from "lucide-react";

export function SkillSourceBadge({ source }: { source?: SkillSource }) {
  const labels = {
    builtin: "Built-in",
    agent: "Agent created",
    system: "System imported",
    local: "Local",
  };
  return (
    <span className="tw-rounded tw-bg-modifier-hover tw-px-1.5 tw-py-0.5 tw-text-ui-smaller tw-text-muted">
      {t(labels[source?.kind ?? "local"])}
    </span>
  );
}

export interface SkillActionsProps {
  skill: Skill | RejectedSkill;
  busy?: boolean;
  onUse: () => void;
  onToggle: (enabled: boolean) => void | Promise<void>;
  onUninstall: () => void;
}

export function SkillActions({ skill, busy, onUse, onToggle, onUninstall }: SkillActionsProps) {
  const valid = "enabledAgents" in skill;
  return (
    <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-2">
      <Button
        variant="ghost"
        size="icon"
        title={t("Use now")}
        aria-label={t("Use {name} now", { name: skill.name })}
        disabled={busy || !valid || skill.userInvocable === false}
        onClick={onUse}
      >
        <Play className="tw-size-4" />
      </Button>
      <SettingSwitch
        aria-label={t("Enable {name}", { name: skill.name })}
        checked={valid && skill.enabledAgents.includes("native")}
        disabled={busy || !valid}
        onCheckedChange={(enabled) => void onToggle(enabled)}
      />
      <Button
        variant="ghost"
        size="icon"
        title={t("Uninstall")}
        aria-label={`${t("Uninstall")} ${skill.name}`}
        disabled={busy}
        onClick={onUninstall}
      >
        <Trash2 className="tw-size-4" />
      </Button>
    </div>
  );
}

export interface SkillRowProps extends SkillActionsProps {
  onOpen: () => void;
  usageNote?: string;
}

export function SkillRow({ skill, onOpen, usageNote, ...actions }: SkillRowProps) {
  // 存在界面元数据时优先渲染显示名与图标，缺失时回退现状。https://github.com/ItsDalk-Lane/Scribe/issues/47
  const iconUrl = useSkillIcon(skill);
  return (
    <SkillRowLayout
      name={
        "uiMetadata" in skill && skill.uiMetadata?.displayName
          ? skill.uiMetadata.displayName
          : skill.name
      }
      description={
        "description" in skill
          ? (skill.uiMetadata?.shortDescription ?? skill.description)
          : t("Could not load this skill")
      }
      iconUrl={iconUrl}
      meta={usageNote}
      annotations={<SkillSourceBadge source={skill.source} />}
      controls={null}
      actions={<SkillActions skill={skill} {...actions} />}
      onOpen={onOpen}
    />
  );
}
