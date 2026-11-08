import React, { memo, useEffect, useRef, useState } from "react";
import { AgentReasoningBlock } from "@/components/chat-components/AgentReasoningBlock";
import { useTrailExpansion } from "@/agentMode/ui/useTrailExpansion";
import { formatWorkedDuration } from "@/agentMode/ui/AgentTurnDurationIndicator";
import type { ThoughtPart } from "@/agentMode/ui/agentTrail";

interface ReasoningBlockProps {
  part: ThoughtPart;
  isStreaming: boolean;
  open?: boolean;
  onToggle?: () => void;
}

export const ReasoningBlock: React.FC<ReasoningBlockProps> = memo(function ReasoningBlock({
  part,
  isStreaming,
  open,
  onToggle,
}) {
  const expansion = useTrailExpansion();
  const rootRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const isActive = isStreaming && part.durationMs === undefined;

  useEffect(() => {
    if (!isActive || part.startedAtMs === undefined) return;
    const intervalWindow = rootRef.current?.win;
    if (!intervalWindow) return;
    const id = intervalWindow.setInterval(() => setNow(Date.now()), 100);
    return () => intervalWindow.clearInterval(id);
  }, [isActive, part.startedAtMs]);

  const startedAt = part.startedAtMs;
  const elapsedMs =
    part.durationMs ??
    (isActive && startedAt !== undefined ? Math.max(0, now - startedAt) : undefined);

  return (
    <div ref={rootRef}>
      <AgentReasoningBlock
        open={open ?? expansion.isOpen("reasoning")}
        onToggle={onToggle ?? (() => expansion.toggle("reasoning"))}
        status={isActive ? "reasoning" : "complete"}
        elapsedLabel={elapsedMs === undefined ? undefined : formatWorkedDuration(elapsedMs)}
        text={part.text}
      />
    </div>
  );
});
