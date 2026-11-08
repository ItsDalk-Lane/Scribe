import { t } from "@/lib/i18n";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { Brain } from "lucide-react";
import React, { useState } from "react";

interface AgentReasoningBlockProps {
  status: "idle" | "reasoning" | "collapsed" | "complete";
  elapsedLabel?: string;
  text: string;
  open?: boolean;
  onToggle?: () => void;
}

export const AgentReasoningBlock: React.FC<AgentReasoningBlockProps> = ({
  status,
  elapsedLabel,
  text,
  open,
  onToggle,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  if (status === "idle") return null;
  const isActive = status === "reasoning";
  const expanded = open ?? isExpanded;
  // 收起时仅预览最近收到的一行，展开仍保留原始流中的全部空格和换行。https://github.com/ItsDalk-Lane/Scribe/issues/52
  const latestLine = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .at(-1)
    ?.trim();

  return (
    <AgentActivityCard
      icon={Brain}
      isRunning={isActive}
      label={
        <>
          <span className="tw-shrink-0">{isActive ? t("Thinking") : t("Thought for")}</span>
          <span className="tw-shrink-0 tw-text-xs tw-tabular-nums tw-text-muted">
            {elapsedLabel ?? t("Duration unavailable")}
          </span>
          {isActive && !expanded && latestLine ? (
            <span className="tw-min-w-0 tw-truncate tw-font-normal" aria-hidden="true">
              {latestLine.slice(-160)}
            </span>
          ) : null}
        </>
      }
      expandable={text.length > 0}
      open={expanded}
      onToggle={onToggle ?? (() => setIsExpanded((value) => !value))}
    >
      <div className="tw-whitespace-pre-wrap tw-break-words tw-text-xs tw-leading-relaxed tw-text-muted">
        {text}
      </div>
    </AgentActivityCard>
  );
};
