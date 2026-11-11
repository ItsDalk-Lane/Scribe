import { Markdown } from "@/components/Markdown";
import type { App } from "obsidian";
import React, { memo } from "react";

interface AgentMarkdownTextProps {
  text: string;
  app: App;
  sourcePath?: string;
  renderIdentity?: string;
  isStreaming?: boolean;
}

export const AgentMarkdownText: React.FC<AgentMarkdownTextProps> = memo(function AgentMarkdownText({
  text,
  sourcePath = "",
  renderIdentity,
  isStreaming = false,
}) {
  return (
    <Markdown
      className="tw-p-1 tw-text-sm"
      sourcePath={sourcePath}
      text={text}
      renderIdentity={renderIdentity}
      isStreaming={isStreaming}
      contentPolicy="model"
    />
  );
});
