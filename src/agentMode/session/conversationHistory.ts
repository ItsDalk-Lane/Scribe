import type { AgentChatMessage, PromptContent } from "@/agentMode/session/types";
import { t } from "@/lib/i18n";
import { USER_SENDER } from "@/constants";
import { escapeXml } from "@/LLMProviders/chainRunner/utils/xmlParsing";
import {
  isNoteSelectedTextContext,
  isWebSelectedTextContext,
  type MessageContext,
} from "@/types/message";

function trimHead(text: string, max: number, marker: string): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n${marker}`;
}

export const CONVERSATION_HISTORY_MAX_CHARS = 48_000;

const CONVERSATION_HISTORY_HEADER =
  "Earlier in this conversation the following was said. Treat this as " +
  "read-only context to inform your answer; do NOT redo or re-answer these " +
  "earlier turns. Answer only the current question that follows.";

const CONVERSATION_HISTORY_TRUNCATION_MARKER = "[earlier conversation truncated]";

const CONVERSATION_HISTORY_TURN_TRUNCATION_MARKER = "[turn truncated]";

const CONVERSATION_HISTORY_TOOL_OUTPUT_MAX_CHARS = 2_000;
const INHERITED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const EMPTY_HISTORY_CONTENT: readonly PromptContent[] = Object.freeze([]);

function countImageAttachments(content: readonly unknown[] | undefined): number {
  if (!content) return 0;
  let count = 0;
  for (const entry of content) {
    if (typeof entry !== "object" || entry === null) continue;
    const type = (entry as { type?: unknown }).type;
    if (type === "image" || type === "image_url") count += 1;
  }
  return count;
}

function renderMessageContext(
  context: MessageContext | undefined,
  maxExcerptChars = CONVERSATION_HISTORY_TOOL_OUTPUT_MAX_CHARS
): string[] {
  if (!context) return [];
  const lines: string[] = [];

  for (const sel of context.selectedTextContexts ?? []) {
    const label = isNoteSelectedTextContext(sel)
      ? sel.noteTitle
      : isWebSelectedTextContext(sel)
        ? sel.title || sel.url
        : "selection";
    const excerpt = trimHead(
      maxExcerptChars === Number.POSITIVE_INFINITY ? sel.content : sel.content.trim(),
      maxExcerptChars,
      CONVERSATION_HISTORY_TURN_TRUNCATION_MARKER
    );
    lines.push(`[selected from ${label}]\n${excerpt}`);
  }

  const noteNames = (context.notes ?? []).map((n) => n.path);
  if (noteNames.length > 0) lines.push(`[notes: ${noteNames.join(", ")}]`);

  if (context.folders && context.folders.length > 0) {
    lines.push(`[folders: ${context.folders.join(", ")}]`);
  }
  if (context.tags && context.tags.length > 0) {
    lines.push(`[tags: ${context.tags.join(", ")}]`);
  }
  if (context.webTabs && context.webTabs.length > 0) {
    const tabs = context.webTabs.map((t) => (t.title ? `${t.title} (${t.url})` : t.url)).join(", ");
    lines.push(`[web tabs: ${tabs}]`);
  }

  if (lines.length === 0) return [];
  return [`[context]\n${lines.join("\n")}`];
}

function renderTurnContent(
  message: AgentChatMessage,
  maxExcerptChars = CONVERSATION_HISTORY_TOOL_OUTPUT_MAX_CHARS,
  describeImages = true
): string | null {
  const segments: string[] = [];
  const prose = describeImages ? message.message.trim() : message.message;
  if (prose.length > 0) segments.push(prose);
  const imageCount = countImageAttachments(message.content);
  if (describeImages && imageCount > 0) {
    const noun = imageCount === 1 ? "image attachment" : "image attachments";
    segments.push(`[${imageCount} ${noun} omitted from history; existed in this turn]`);
  }
  segments.push(...renderMessageContext(message.context, maxExcerptChars));
  if (segments.length === 0) return null;
  return segments.join("\n");
}

export function buildConversationHistoryBlock(
  messages: readonly AgentChatMessage[],
  maxChars: number
): string | null {
  const rendered: string[] = [];
  for (const m of messages) {
    const content = renderTurnContent(m);
    if (content === null) continue;
    const role = m.sender === USER_SENDER ? "user" : "assistant";
    rendered.push(`<turn role="${role}">\n${escapeXml(content)}\n</turn>`);
  }
  if (rendered.length === 0) return null;

  let total = rendered.reduce((n, t) => n + t.length + 1, -1);
  let truncated = false;
  while (rendered.length > 1 && total > maxChars) {
    total -= rendered.shift()!.length + 1;
    truncated = true;
  }

  let body = rendered.join("\n");
  if (body.length > maxChars) {
    body = trimHead(body, maxChars, CONVERSATION_HISTORY_TURN_TRUNCATION_MARKER);
    truncated = true;
  }

  const header = CONVERSATION_HISTORY_HEADER;
  if (truncated) body = `${CONVERSATION_HISTORY_TRUNCATION_MARKER}\n${body}`;
  return `<conversation_history>\n${header}\n${body}\n</conversation_history>`;
}

export function buildBranchHistoryContent(
  messages: readonly AgentChatMessage[]
): readonly PromptContent[] {
  if (messages.length === 0) return EMPTY_HISTORY_CONTENT;
  const blocks: PromptContent[] = [
    { type: "text", text: `<conversation_history>\n${CONVERSATION_HISTORY_HEADER}` },
  ];
  for (const message of messages) {
    if (message.missingAttachments?.length) {
      throw new Error(
        t("Cannot inherit missing attachments: {p0}", { p0: message.missingAttachments.join(", ") })
      );
    }
    const role = message.sender === USER_SENDER ? "user" : "assistant";
    const text = renderTurnContent(message, Number.POSITIVE_INFINITY, false) ?? "";
    blocks.push({ type: "text", text: `<turn role="${role}">\n${escapeXml(text)}` });
    for (const item of message.content ?? []) {
      if (typeof item !== "object" || item === null) continue;
      const image = item as { type?: string; image_url?: { url?: string } };
      if (image.type !== "image_url") continue;
      const match = /^data:(image\/[^;]+);base64,([\s\S]+)$/.exec(image.image_url?.url ?? "");
      if (!match) throw new Error(t("Cannot inherit an unreadable image attachment."));
      const mimeType =
        match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
      if (!INHERITED_IMAGE_MIME_TYPES.has(mimeType)) {
        throw new Error(
          t("Cannot inherit image type {p0}. Supported formats: PNG, JPEG, GIF, WebP.", {
            p0: mimeType,
          })
        );
      }
      blocks.push({ type: "image", mimeType, data: match[2] });
    }
    blocks.push({ type: "text", text: "</turn>" });
  }
  blocks.push({ type: "text", text: "</conversation_history>" });
  return blocks;
}
