import React, { useMemo, useState } from "react";
import type { AgentToolContentBlock } from "@/agentMode/session/types";
import { formatToolText, toolValueText } from "@/agentMode/ui/toolContentFormat";
import { Markdown } from "@/components/Markdown";
import { CopyButton } from "@/components/chat-components/CopyButton";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { isRecord } from "@/utils/obsidianInternals";

interface ToolTextContentProps {
  text: string;
  markdown?: boolean;
}

const PAGE_CHARS = 32_000;

export function ToolTextContent({ text, markdown }: ToolTextContentProps) {
  const [visibleChars, setVisibleChars] = useState(PAGE_CHARS);
  const formatted = useMemo(() => formatToolText(text), [text]);
  const visible = formatted.text.slice(0, visibleChars);
  const isJson = formatted.kind === "json" || formatted.kind === "json-string";
  return (
    <div className="tw-max-h-96 tw-min-w-0 tw-overflow-y-auto tw-rounded tw-bg-secondary-alt tw-p-2">
      <div className="tw-flex tw-justify-end">
        <CopyButton text={text} />
      </div>
      {formatted.kind === "json-string" ? (
        <div className="tw-pb-1 tw-text-xs tw-text-muted">{t("JSON string")}</div>
      ) : null}
      {(markdown || formatted.kind === "markdown") && !isJson ? (
        <Markdown className="tw-break-words tw-text-sm" text={visible} sourcePath="" />
      ) : (
        <pre className="tw-m-0 tw-overflow-x-auto tw-whitespace-pre-wrap tw-break-words tw-text-xs">
          {visible}
        </pre>
      )}
      {visibleChars < formatted.text.length ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setVisibleChars((count) => count + PAGE_CHARS)}
        >
          {t("Show more")}
        </Button>
      ) : null}
      {formatted.kind === "json-string" ? (
        <details className="tw-mt-1 tw-text-xs">
          <summary className="tw-cursor-pointer tw-text-muted">{t("Original data")}</summary>
          <pre className="tw-m-0 tw-overflow-x-auto tw-whitespace-pre-wrap tw-break-words tw-text-xs">
            {text}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

interface ToolContentProps {
  content: AgentToolContentBlock;
}

export function ToolContent({ content }: ToolContentProps) {
  const type = content.type;
  const data = typeof content.data === "string" ? content.data : undefined;
  const mimeType = typeof content.mimeType === "string" ? content.mimeType : undefined;
  const resource = isRecord(content.resource) ? content.resource : undefined;
  const uri =
    typeof content.uri === "string"
      ? content.uri
      : typeof resource?.uri === "string"
        ? resource.uri
        : undefined;
  const name = typeof content.name === "string" ? content.name : uri;
  // 服务器可能返回任意资源地址；保留原文，只让受支持的链接可直接打开。https://github.com/ItsDalk-Lane/Scribe/issues/52
  const safeLink = uri && /^(?:https?:|obsidian:)/i.test(uri) ? uri : undefined;
  const original = (
    <details className="tw-mt-1 tw-text-xs">
      <summary className="tw-cursor-pointer tw-text-muted">{t("Original data")}</summary>
      <ToolTextContent text={toolValueText(content)} />
    </details>
  );
  if (type === "image" && data && mimeType?.startsWith("image/")) {
    return (
      <div className="tw-min-w-0 tw-rounded tw-bg-secondary-alt tw-p-2">
        <div className="tw-flex tw-justify-end">
          <CopyButton text={toolValueText(content)} />
        </div>
        <img
          src={`data:${mimeType};base64,${data}`}
          alt={typeof content.name === "string" ? content.name : t("Tool image")}
          className="tw-max-h-96 tw-max-w-full tw-object-contain"
        />
        {original}
      </div>
    );
  }
  if (type === "audio" && data && mimeType?.startsWith("audio/")) {
    return (
      <div className="tw-rounded tw-bg-secondary-alt tw-p-2">
        <CopyButton text={toolValueText(content)} />
        <audio controls src={`data:${mimeType};base64,${data}`} aria-label={t("Tool audio")} />
        {original}
      </div>
    );
  }
  if (type === "resource_link" || type === "resource") {
    const text = typeof resource?.text === "string" ? resource.text : undefined;
    const blob = typeof resource?.blob === "string" ? resource.blob : undefined;
    const resourceMime =
      typeof resource?.mimeType === "string" ? resource.mimeType : "application/octet-stream";
    return (
      <div className="tw-min-w-0 tw-space-y-1 tw-rounded tw-bg-secondary-alt tw-p-2">
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
          {safeLink ? (
            <a href={safeLink} className="tw-break-all tw-text-accent">
              {name}
            </a>
          ) : (
            <span className="tw-break-all tw-text-xs">{name ?? t("Resource")}</span>
          )}
          <CopyButton text={toolValueText(content)} />
        </div>
        {typeof content.description === "string" ? (
          <ToolTextContent text={content.description} />
        ) : null}
        {text !== undefined ? (
          <ToolTextContent text={text} markdown={resourceMime === "text/markdown"} />
        ) : null}
        {blob ? (
          <a
            href={`data:${resourceMime};base64,${blob}`}
            download={typeof content.name === "string" ? content.name : "resource"}
            className="tw-text-accent"
          >
            {t("Download resource")}
          </a>
        ) : null}
        {original}
      </div>
    );
  }
  return (
    <div className="tw-min-w-0">
      {type === "json" && typeof content.name === "string" ? (
        <div className="tw-py-1 tw-text-xs tw-text-muted">
          {content.name === "structuredContent"
            ? t("Structured content")
            : content.name === "metadata"
              ? t("Metadata")
              : content.name}
        </div>
      ) : null}
      <ToolTextContent
        text={type === "text" || type === "json" ? (content.text ?? "") : toolValueText(content)}
      />
      {type === "text" || type === "json" ? original : null}
    </div>
  );
}
