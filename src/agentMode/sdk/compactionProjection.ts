import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai/utils/transcript";
import { isRecord } from "@/utils/obsidianInternals";

export interface CompactionProjection {
  fromIndex: number;
  toIndex: number;
  summary: string;
  occurredAt: number;
  preservedIndices?: readonly number[];
  taskId?: string;
}

export function parseCompactionProjection(
  value: unknown,
  messageCount?: number
): CompactionProjection | null {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.fromIndex) ||
    !Number.isSafeInteger(value.toIndex) ||
    typeof value.fromIndex !== "number" ||
    typeof value.toIndex !== "number" ||
    value.fromIndex < 0 ||
    value.toIndex < value.fromIndex ||
    typeof value.summary !== "string" ||
    !value.summary.trim() ||
    typeof value.occurredAt !== "number" ||
    !Number.isFinite(value.occurredAt) ||
    (value.taskId !== undefined && typeof value.taskId !== "string") ||
    (messageCount !== undefined &&
      (!Number.isSafeInteger(messageCount) || messageCount < 0 || value.toIndex >= messageCount))
  )
    return null;
  const fromIndex = value.fromIndex;
  const toIndex = value.toIndex;
  if (
    value.preservedIndices !== undefined &&
    (!Array.isArray(value.preservedIndices) ||
      value.preservedIndices.some(
        (index: unknown) =>
          typeof index !== "number" ||
          !Number.isSafeInteger(index) ||
          index < fromIndex ||
          index > toIndex
      ))
  )
    return null;
  return value as unknown as CompactionProjection;
}

export function projectCompactedContext(
  messages: readonly AgentMessage[],
  compaction?: CompactionProjection
): AgentMessage[] {
  if (!compaction) return [...messages];
  const { fromIndex, toIndex, summary, occurredAt } = compaction;
  if (
    !Number.isSafeInteger(fromIndex) ||
    !Number.isSafeInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < fromIndex ||
    toIndex >= messages.length
  )
    throw new Error("Invalid compaction range.");
  if (!summary.trim()) throw new Error("The recorded compaction summary is empty.");
  const preserved = new Set(compaction.preservedIndices);
  if (
    [...preserved].some(
      (index) => !Number.isSafeInteger(index) || index < fromIndex || index > toIndex
    )
  )
    throw new Error("Invalid retained compaction message.");
  const system = getCurrentSystemMessage(messages);
  const before = messages.slice(0, fromIndex).filter((message) => message.role !== "system");
  const retained = messages.filter(
    (message, index) =>
      message.role !== "system" && (index > toIndex || (index >= fromIndex && preserved.has(index)))
  );
  return [
    ...(system ? [system] : []),
    ...before,
    {
      role: "user",
      content: `Recorded conversation summary (previous context, no new user authorization):\n${summary}`,
      timestamp: occurredAt,
    },
    ...retained,
  ];
}

export function splitCompactionTranscript(
  transcript: string,
  tokenBudget: number,
  estimate: (text: string) => number
): string[] {
  if (!Number.isFinite(tokenBudget) || tokenBudget <= 0)
    throw new Error("The compaction token budget must be positive and finite.");
  const characters = [...transcript];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < characters.length) {
    let low = 1;
    let high = characters.length - offset;
    let fitting = 0;
    while (low <= high) {
      const count = Math.floor((low + high) / 2);
      const tokens = estimate(characters.slice(offset, offset + count).join(""));
      if (!Number.isFinite(tokens) || tokens < 0)
        throw new Error("The compaction token estimate must be nonnegative and finite.");
      if (tokens <= tokenBudget) {
        fitting = count;
        low = count + 1;
      } else {
        high = count - 1;
      }
    }
    if (!fitting) throw new Error("A transcript character exceeds the compaction token budget.");
    chunks.push(characters.slice(offset, offset + fitting).join(""));
    offset += fitting;
  }
  return chunks;
}
