import React, { useMemo } from "react";
import { CircleStop, Loader2, Check, X, Clock } from "lucide-react";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { AgentToolStatus } from "@/agentMode/session/types";
import { displayTargetFromPath, lookupToolSummary } from "@/agentMode/ui/toolSummaries";
import { renderDiff } from "@/agentMode/ui/diffRender";
import { getVaultBase } from "@/utils/vaultPath";
import { openLinkClickProps, openVaultPath } from "@/utils/openVaultPath";
import { useApp } from "@/context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToolContent, ToolTextContent } from "@/agentMode/ui/ToolContent";
import { toolValueText } from "@/agentMode/ui/toolContentFormat";
import { t } from "@/lib/i18n";
import { CopyButton } from "@/components/chat-components/CopyButton";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";

interface ActionCardProps {
  part: ToolCallPart;
  open: boolean;
  onToggle: () => void;
}

export const ActionCard: React.FC<ActionCardProps> = ({ part, open, onToggle }) => {
  const app = useApp();
  const summary = lookupToolSummary(part);
  const summaryCtx = useMemo(() => ({ vaultBase: getVaultBase(app) }), [app]);
  const Icon = summary.icon;
  const line = summary.collapsedLine(part, summaryCtx);
  const outputs = part.output ?? [];
  const expandable = part.input !== undefined || outputs.length > 0;
  const targetPath =
    part.status === "completed" ? (summary.targetPath?.(part, summaryCtx) ?? null) : null;
  const link = targetPath
    ? { path: targetPath, label: displayTargetFromPath(part, summaryCtx.vaultBase) ?? targetPath }
    : null;

  return (
    <TooltipProvider>
      <AgentActivityCard
        isRunning={part.status === "in_progress"}
        icon={Icon}
        label={
          link ? (
            <>
              <span className="tw-shrink-0">
                {line.slice(0, line.lastIndexOf(link.label)).trimEnd()}
              </span>
              <a
                href="#"
                className="tw-min-w-0 tw-truncate tw-text-normal hover:tw-text-accent hover:tw-underline"
                {...openLinkClickProps((pane) => openVaultPath(app, link.path, { pane }))}
              >
                {link.label}
              </a>
            </>
          ) : (
            <span className="tw-truncate">{line}</span>
          )
        }
        trailing={<StatusBadge status={part.status} />}
        expandable={expandable}
        open={open}
        onToggle={onToggle}
      >
        <section aria-label={t("Input")} className="tw-min-w-0 tw-space-y-1">
          <div className="tw-text-xs tw-font-medium tw-text-muted">{t("Input")}</div>
          {part.input === undefined ? (
            <div className="tw-text-xs tw-text-muted">{t("No input")}</div>
          ) : (
            <ToolTextContent text={toolValueText(part.input)} />
          )}
        </section>
        <section aria-label={t("Output")} className="tw-min-w-0 tw-space-y-1">
          <div className="tw-text-xs tw-font-medium tw-text-muted">{t("Output")}</div>
          {outputs.length === 0 ? (
            <div className="tw-text-xs tw-text-muted">
              {t(
                part.status === "pending" || part.status === "in_progress"
                  ? "Waiting for output"
                  : "No output"
              )}
            </div>
          ) : null}
          {outputs.map((output, index) => (
            // eslint-disable-next-line @eslint-react/no-array-index-key -- outputs retain protocol order
            <div key={index}>
              {output.type === "text" ? (
                <ToolTextContent text={output.text} />
              ) : output.type === "content" ? (
                <ToolContent content={output.content} />
              ) : (
                <div className="tw-rounded tw-bg-secondary-alt tw-p-2">
                  <p className="tw-font-mono tw-text-xs tw-text-muted">{output.path}</p>
                  <div className="tw-flex tw-justify-end">
                    <CopyButton text={renderDiff(output.oldText, output.newText)} />
                  </div>
                  <pre className="tw-max-h-96 tw-overflow-auto tw-whitespace-pre-wrap tw-text-xs">
                    {renderDiff(output.oldText, output.newText)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </section>
      </AgentActivityCard>
    </TooltipProvider>
  );
};

interface StatusBadgeProps {
  status: AgentToolStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  if (status === "in_progress") {
    return (
      <Loader2
        aria-label={t("Running")}
        className="tw-size-3 tw-shrink-0 tw-animate-spin tw-text-loading"
      />
    );
  }
  if (status === "pending")
    return <Clock aria-label={t("Waiting")} className="tw-size-3 tw-shrink-0 tw-text-muted" />;
  if (status === "failed") {
    return <X aria-label={t("Failed")} className="tw-size-3 tw-shrink-0 tw-text-error" />;
  }
  if (status === "cancelled") {
    return (
      <CircleStop aria-label={t("Cancelled")} className="tw-size-3 tw-shrink-0 tw-text-muted" />
    );
  }
  return <Check aria-label={t("Completed")} className="tw-size-3 tw-shrink-0 tw-text-success" />;
};
