import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { isRecord } from "@/utils/obsidianInternals";

export function reduceToolHistory(messages: AgentMessage[]): AgentMessage[] {
  const reads = new Map<string, number>();
  let latestBatch = -1;
  for (const [index, message] of messages.entries()) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "toolCall") continue;
      latestBatch = index;
      if (
        part.name === "read_note" &&
        typeof part.arguments.path === "string" &&
        part.arguments.path.trim()
      )
        reads.set(part.id, index);
    }
  }
  const fullResults = new Map<string, Map<string, string>>();
  let reduced: AgentMessage[] | undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (
      message.role !== "toolResult" ||
      message.toolName !== "read_note" ||
      message.isError ||
      message.content.length !== 1 ||
      message.content[0].type !== "text" ||
      !isRecord(message.details) ||
      typeof message.details.path !== "string" ||
      !message.details.path.trim() ||
      !reads.has(message.toolCallId) ||
      reads.get(message.toolCallId)! >= index
    )
      continue;
    const path = message.details.path;
    const text = message.content[0].text;
    const atPath = fullResults.get(path) ?? new Map<string, string>();
    const retainedId = atPath.get(text);
    if (!retainedId) {
      atPath.set(text, message.toolCallId);
      fullResults.set(path, atPath);
      continue;
    }
    // 路径可重读不保证旧版本可恢复，只省略当前上下文中仍有完整副本的重复读取。https://github.com/ItsDalk-Lane/Scribe/issues/66
    if (index >= latestBatch) continue;
    const preview = [...text].slice(0, 240).join("");
    const replacement = `${preview}\n\n[Duplicate read_note text omitted for ${JSON.stringify(path)}. Identical full text remains in tool result ${JSON.stringify(retainedId)} in this context.]`;
    if (replacement.length >= text.length) continue;
    reduced ??= messages.slice();
    reduced[index] = { ...message, content: [{ ...message.content[0], text: replacement }] };
  }
  if (!reduced) return messages;
  // 供应商旧用量描述的是缩减前前缀，请求视图必须重新按当前内容计量，原记录仍保留实测值。https://github.com/ItsDalk-Lane/Scribe/issues/66
  return reduced.map((message) =>
    message.role === "assistant" &&
    (message.usage.input ||
      message.usage.output ||
      message.usage.cacheRead ||
      message.usage.cacheWrite ||
      message.usage.totalTokens)
      ? {
          ...message,
          usage: {
            ...message.usage,
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
          },
        }
      : message
  );
}
