import { isCompactCommand, COMPACT_COMMAND_NAME } from "@/commands/compactCommand";
import { isBuiltinCommandEnabled } from "@/agentMode/agentCommands/builtinAgentCommands";
import { getSettings } from "@/settings/model";
import { USER_SENDER } from "@/constants";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { buildNativeChatId } from "@/utils/nativeChatId";
import type { AgentSessionIndexEntry } from "./AgentSessionIndex";
import type { AgentChatMessage } from "./types";

export interface MarkdownChatEntry {
  item: ChatHistoryItem;
  backendId?: string;
  sessionId?: string;
}

export const UNTITLED_NATIVE_CHAT = "Untitled chat";

const MAX_DERIVED_TITLE_CHARS = 60;

// 内置命令被用户关闭后，/compact 是普通消息，仍可作为标题来源。https://github.com/ItsDalk-Lane/Scribe/issues/53
const isCompactRecord = (message: string): boolean =>
  isCompactCommand(message) && isBuiltinCommandEnabled(getSettings(), COMPACT_COMMAND_NAME);

export function deriveChatTitleFromMessages(messages: AgentChatMessage[]): string | null {
  const firstUser = messages.find(
    (m) => m.sender === USER_SENDER && m.message.trim() && !isCompactRecord(m.message)
  );
  if (!firstUser) {
    return messages.some(
      (m) =>
        m.sender === USER_SENDER &&
        m.content?.some(
          (block) =>
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            block.type === "image_url"
        )
    )
      ? "Image attachment"
      : null;
  }
  const text = firstUser.message
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (text.length <= MAX_DERIVED_TITLE_CHARS) return text;
  return `${text.slice(0, MAX_DERIVED_TITLE_CHARS).trimEnd()}…`;
}

export function mergeChatHistoryItems(
  markdownEntries: MarkdownChatEntry[],
  nativeEntries: AgentSessionIndexEntry[]
): ChatHistoryItem[] {
  const nativeByKey = new Map<string, AgentSessionIndexEntry>();
  for (const entry of nativeEntries) {
    nativeByKey.set(`${entry.backendId}:${entry.sessionId}`, entry);
  }

  const merged: ChatHistoryItem[] = [];
  for (const { item, backendId, sessionId } of markdownEntries) {
    const key = backendId && sessionId ? `${backendId}:${sessionId}` : null;
    const twin = key ? nativeByKey.get(key) : undefined;
    if (twin && key) {
      nativeByKey.delete(key);
      merged.push({
        ...item,
        lastAccessedAt:
          twin.lastAccessedAtMs > item.lastAccessedAt.getTime()
            ? new Date(twin.lastAccessedAtMs)
            : item.lastAccessedAt,
        projectId: item.projectId ?? twin.projectId,
      });
      continue;
    }
    merged.push(item);
  }

  for (const entry of nativeByKey.values()) {
    merged.push({
      id: buildNativeChatId(entry.backendId, entry.sessionId),
      title: entry.title ?? UNTITLED_NATIVE_CHAT,
      createdAt: new Date(entry.createdAtMs),
      lastAccessedAt: new Date(entry.lastAccessedAtMs),
      backendId: entry.backendId,
      projectId: entry.projectId,
    });
  }

  return merged;
}
