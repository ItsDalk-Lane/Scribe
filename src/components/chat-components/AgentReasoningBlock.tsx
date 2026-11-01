import { t } from "@/lib/i18n";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { formatDuration } from "@/lib/duration";
import { Brain } from "lucide-react";
import React, { useState } from "react";

interface AgentReasoningBlockProps {
  status: "idle" | "reasoning" | "collapsed" | "complete";
  elapsedSeconds: number;
  steps: string[];
  open?: boolean;
  onToggle?: () => void;
}

export const AgentReasoningBlock: React.FC<AgentReasoningBlockProps> = ({
  status,
  elapsedSeconds,
  steps,
  open,
  onToggle,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [prevStatus, setPrevStatus] = useState(status);

  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status === "collapsed" || status === "complete") {
      setIsExpanded(false);
    }
  }

  if (status === "idle") {
    return null;
  }

  const isActive = status === "reasoning";
  const canExpand = steps.length > 0;

  return (
    <AgentActivityCard
      icon={Brain}
      label={
        <>
          <span>
            {isActive ? (
              <>
                {t("Reasoning")}
                <span className="copilot-shimmer-text" aria-hidden="true">
                  ...
                </span>
              </>
            ) : (
              t("Thought for")
            )}
          </span>
          {!isActive ? (
            <span className="tw-font-normal">{formatDuration(elapsedSeconds * 1000)}</span>
          ) : null}
        </>
      }
      expandable={canExpand}
      open={open ?? isExpanded}
      onToggle={onToggle ?? (() => setIsExpanded((expanded) => !expanded))}
    >
      <ul className="tw-list-outside tw-list-disc tw-space-y-1.5 tw-pl-4 max-md:tw-space-y-1">
        {steps.map((step, i) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- steps are append-only with no stable id; text may repeat
          <li key={i} className="tw-text-xs tw-leading-[1.4] tw-text-muted">
            {step}
          </li>
        ))}
      </ul>
    </AgentActivityCard>
  );
};
