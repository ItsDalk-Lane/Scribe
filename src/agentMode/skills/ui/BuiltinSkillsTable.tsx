import { t } from "@/lib/i18n";
import type { AgentBrand, BackendId } from "@/agentMode/session/types";
import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import { SkillRowLayout } from "./SkillRowLayout";

export interface BuiltinSkillRow {
  name: string;
  description: string;
  content: string;
}

export interface BuiltinSkillsTableProps {
  skills: readonly BuiltinSkillRow[];
  unavailableReasons?: Readonly<Record<string, string>>;
  agents: readonly AgentBrand[];
  availableAgents: readonly BackendId[];
  error?: string;
}

export function BuiltinSkillsTable({
  skills,
  unavailableReasons,
  agents,
  availableAgents,
  error,
}: BuiltinSkillsTableProps) {
  return (
    <section aria-label={t("Built-in skills")} className="tw-group/settings tw-space-y-3">
      <div role="heading" aria-level={3} className="tw-text-left tw-text-sm tw-font-semibold">
        {t("Built-in skills")}
      </div>
      <p className="tw-m-0 tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
        {t("Scribe built-in skills are always enabled and read-only.")}
      </p>
      {error && (
        <div role="alert" className="tw-text-ui-smaller tw-text-error">
          {error}
        </div>
      )}
      <div className="tw-space-y-1.5">
        {skills.map((skill) => (
          <BuiltinSkillItem
            key={skill.name}
            skill={skill}
            unavailableReason={unavailableReasons?.[skill.name]}
            available={agents.some((agent) => availableAgents.includes(agent.id))}
          />
        ))}
        {skills.length === 0 && (
          <p className="tw-text-ui-smaller tw-text-muted">
            {t("No built-in skills match your search.")}
          </p>
        )}
      </div>
    </section>
  );
}

interface BuiltinSkillItemProps {
  skill: BuiltinSkillRow;
  unavailableReason?: string;
  available: boolean;
}

const BuiltinSkillItem = React.memo(function BuiltinSkillItem({
  skill,
  unavailableReason,
  available,
}: BuiltinSkillItemProps) {
  const [previewOpen, setPreviewOpen] = React.useState(false);
  return (
    <div>
      <SkillRowLayout
        name={skill.name}
        description={skill.description}
        annotations={<Badge variant="secondary">{t("Read-only")}</Badge>}
        controls={
          <span
            title={
              unavailableReason ??
              (available ? t("Always enabled") : t("Set up Claude Code to use this skill."))
            }
            className="tw-max-w-24 tw-truncate tw-text-ui-smaller tw-text-muted"
          >
            {unavailableReason ??
              (available ? t("Always enabled") : t("Set up Claude Code to use this skill."))}
          </span>
        }
        actions={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPreviewOpen(!previewOpen)}
            aria-label={t("View {p0} (read-only)", { p0: skill.name })}
          >
            <Eye className="tw-size-4" />
          </Button>
        }
      />
      {previewOpen && (
        <pre
          aria-label={t("{p0} content (read-only)", { p0: skill.name })}
          className="tw-max-h-80 tw-overflow-auto tw-whitespace-pre-wrap tw-break-all tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-transparent tw-p-3 tw-text-ui-smaller tw-leading-relaxed"
        >
          {skill.content}
        </pre>
      )}
    </div>
  );
});
