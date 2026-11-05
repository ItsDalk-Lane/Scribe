import { t } from "@/lib/i18n";
import type { CompactionPart } from "@/agentMode/ui/agentTrail";
import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import { cn } from "@/lib/utils";
import { FoldVertical } from "lucide-react";
import React from "react";

interface CompactionRowProps {
  part: CompactionPart;
}

const RUNNING_LABEL = {
  manual: "Compacting conversation…",
  auto: "Context is full, compacting…",
} as const;

function formatTokens(count: number): string {
  return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count);
}

function completedText(part: CompactionPart): string {
  const label =
    part.trigger === "auto" ? t("Context compacted automatically") : t("Context compacted");
  return part.preTokens !== undefined && part.postTokens !== undefined
    ? `${label} · ${formatTokens(part.preTokens)} → ${formatTokens(part.postTokens)} tokens`
    : label;
}

const Hairline: React.FC = () => (
  <span className="tw-flex-1 tw-border-0 tw-border-t tw-border-solid tw-border-border" />
);

const CompactionIcon: React.FC<{ className?: string }> = ({ className }) => (
  <FoldVertical aria-hidden="true" className={cn("tw-size-3 tw-shrink-0", className)} />
);

const StatusLine: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="tw-flex tw-items-center tw-gap-1.5 tw-py-1 tw-pl-1 tw-text-ui-small tw-text-muted">
    <CompactionIcon />
    <span>{children}</span>
  </div>
);

export const CompactionRow: React.FC<CompactionRowProps> = ({ part }) => {
  switch (part.status) {
    case "in_progress":
      return (
        <AgentTurnDurationIndicator
          status="running"
          startedAtMs={part.startedAtMs}
          label={t(RUNNING_LABEL[part.trigger])}
          icon={<CompactionIcon />}
          inline
        />
      );
    case "completed":
      return (
        <div className="tw-flex tw-items-center tw-gap-2 tw-py-1 tw-text-ui-small tw-text-muted">
          <Hairline />
          <CompactionIcon />
          <span>{completedText(part)}</span>
          <Hairline />
        </div>
      );
    case "failed":
      return (
        <div
          role="alert"
          className="tw-flex tw-items-center tw-gap-1.5 tw-py-1 tw-pl-1 tw-text-ui-small tw-text-muted"
        >
          <CompactionIcon className="tw-text-warning" />
          <span>
            {part.error ? t("Couldn't compact: {p0}", { p0: part.error }) : t("Couldn't compact")}
          </span>
        </div>
      );
    case "cancelled":
      return <StatusLine>{t("Compaction cancelled")}</StatusLine>;
    case "skipped":
      return <StatusLine>{t("Nothing to compact yet")}</StatusLine>;
  }
};
