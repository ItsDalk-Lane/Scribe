import React, { memo, useEffect, useRef, useState } from "react";
import { AgentReasoningBlock } from "@/components/chat-components/AgentReasoningBlock";
import { useTrailExpansion } from "@/agentMode/ui/useTrailExpansion";
import type { ThoughtPart } from "@/agentMode/ui/agentTrail";

interface ReasoningBlockProps {
  part: ThoughtPart;
  isStreaming: boolean;
}

export const ReasoningBlock: React.FC<ReasoningBlockProps> = memo(function ReasoningBlock({
  part,
  isStreaming,
}) {
  const expansion = useTrailExpansion();
  const fallbackStartedAtRef = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isStreaming) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isStreaming]);

  const startedAt = part.startedAtMs ?? fallbackStartedAtRef.current;
  const elapsedMs = part.durationMs ?? (isStreaming ? Math.max(0, now - startedAt) : 0);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  const steps = part.text
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return (
    <AgentReasoningBlock
      open={expansion.isOpen("reasoning")}
      onToggle={() => expansion.toggle("reasoning")}
      status={isStreaming ? "reasoning" : "complete"}
      elapsedSeconds={elapsedSeconds}
      steps={steps.length > 0 ? steps : [part.text]}
    />
  );
});
