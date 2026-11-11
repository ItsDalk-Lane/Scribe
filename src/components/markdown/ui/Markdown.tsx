import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { MarkdownRenderController } from "@/components/markdown/MarkdownRenderController";
import * as React from "react";

export interface MarkdownProps {
  className?: string;
  contentClassName?: string;
  nested?: boolean;
  onRendered?: (container: HTMLElement) => void;
  sourcePath: string;
  text: string;
  renderIdentity?: string;
  isStreaming?: boolean;
  contentPolicy?: "markdown" | "model";
}

export function Markdown({
  className,
  contentClassName,
  nested,
  onRendered,
  sourcePath,
  text,
  renderIdentity = "markdown",
  isStreaming = false,
  contentPolicy = "markdown",
}: MarkdownProps): React.ReactElement {
  const app = useApp();
  const targetRef = React.useRef<HTMLDivElement | null>(null);
  const controllerRef = React.useRef<MarkdownRenderController | null>(null);
  const onRenderedRef = React.useRef(onRendered);
  onRenderedRef.current = onRendered;

  React.useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    const controller = new MarkdownRenderController(app, target, () =>
      onRenderedRef.current?.(target)
    );
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [app]);

  React.useEffect(() => {
    controllerRef.current?.update({
      text,
      sourcePath,
      renderIdentity,
      isStreaming,
      contentPolicy,
      contentClassName: cn(!nested && "markdown-rendered", contentClassName),
    });
  }, [text, sourcePath, renderIdentity, isStreaming, contentPolicy, app, nested, contentClassName]);

  return <div className={cn(!nested && "markdown-rendered", className)} ref={targetRef} />;
}
