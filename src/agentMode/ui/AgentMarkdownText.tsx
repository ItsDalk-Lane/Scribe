import { Markdown } from "@/components/Markdown";
import type { App } from "obsidian";
import React, { memo } from "react";

interface AgentMarkdownTextProps {
  text: string;
  app: App;
}

export const AgentMarkdownText: React.FC<AgentMarkdownTextProps> = memo(function AgentMarkdownText({
  text,
  app,
}) {
  const sourcePath = app.workspace.getActiveFile()?.path ?? "";
  return <Markdown className="tw-p-1 tw-text-sm" sourcePath={sourcePath} text={text} />;
});
