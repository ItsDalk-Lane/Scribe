import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { sha256 } from "@/utils/hash";
import { isRecord } from "@/utils/obsidianInternals";

export interface DeliveredSkillPage {
  toolCallId?: string;
  callSeq?: number;
  resultSeq?: number;
  scope: string;
  name: string;
  version: string;
  offset: number;
  text: string;
  nextCursor?: string;
}

export interface ProjectedSkillPage extends DeliveredSkillPage {
  callIndex: number;
  resultIndex: number;
}

export function projectDeliveredSkillPages(
  messages: readonly AgentMessage[],
  scope: string
): ProjectedSkillPage[] {
  const calls = new Map<string, { name: string; callIndex: number; cursor?: string }>();
  const pages: ProjectedSkillPage[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type !== "toolCall" || part.name !== "invoke_skill" || !isRecord(part.arguments))
          continue;
        const { name, file, cursor } = part.arguments;
        if (
          typeof name === "string" &&
          name &&
          file === undefined &&
          (cursor === undefined || typeof cursor === "string")
        )
          calls.set(part.id, {
            name,
            callIndex: index,
            ...(typeof cursor === "string" ? { cursor } : {}),
          });
      }
    } else if (message.role === "toolResult") {
      const call = calls.get(message.toolCallId);
      calls.delete(message.toolCallId);
      if (
        !call ||
        message.toolName !== "invoke_skill" ||
        message.isError ||
        !isRecord(message.details) ||
        message.details.name !== call.name ||
        message.details.file !== undefined ||
        typeof message.details.truncated !== "boolean" ||
        message.content.length !== 1 ||
        message.content[0].type !== "text"
      )
        continue;
      const text = message.content[0].text;
      const current = call.cursor?.match(/^(\d+):([a-f0-9]{64})$/);
      const nextCursor = message.details.nextCursor;
      const next =
        typeof nextCursor === "string" ? nextCursor.match(/^(\d+):([a-f0-9]{64})$/) : null;
      if (
        (call.cursor && !current) ||
        (message.details.truncated ? !next : nextCursor !== undefined)
      )
        continue;
      const offset = current ? Number(current[1]) : 0;
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        (current && next && current[2] !== next[2])
      )
        continue;
      if (next) {
        const marker = `\n\n[Output truncated]\nContinue with cursor: ${next[0]}`;
        const end = Number(next[1]);
        if (
          !text.endsWith(marker) ||
          !Number.isSafeInteger(end) ||
          end !== offset + text.length - marker.length
        )
          continue;
      }
      const version =
        current?.[2] ??
        next?.[2] ??
        sha256(JSON.stringify([JSON.stringify([call.name, null]), text]));
      pages.push({
        toolCallId: message.toolCallId,
        callIndex: call.callIndex,
        resultIndex: index,
        scope,
        name: call.name,
        version,
        offset,
        text,
        ...(typeof nextCursor === "string" ? { nextCursor } : {}),
      });
    }
  }
  return pages;
}
