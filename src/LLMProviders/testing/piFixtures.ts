import type { Context, AssistantMessage } from "@earendil-works/pi-ai";
import type { ProviderChatModel, ChatStreamOptions } from "@/LLMProviders/piChatModel";

export async function collectReply(
  model: ProviderChatModel,
  prompt: string | Context = "hi",
  options?: ChatStreamOptions
): Promise<AssistantMessage> {
  const context =
    typeof prompt === "string"
      ? { messages: [{ role: "user" as const, content: prompt, timestamp: 0 }] }
      : prompt;
  for await (const event of model.stream(context, options))
    if (event.type === "done") return event.message;
  throw new Error("No completed assistant message");
}

export async function collectText(
  model: ProviderChatModel,
  prompt: string | Context = "hi",
  options?: ChatStreamOptions
): Promise<string> {
  const result = await collectReply(model, prompt, options);
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

export function sse(records: unknown[], done = false): string {
  return (
    records
      .map((record) => {
        const event =
          typeof record === "object" &&
          record &&
          "type" in record &&
          typeof record.type === "string"
            ? `event: ${record.type}\n`
            : "";
        return `${event}data: ${JSON.stringify(record)}\n\n`;
      })
      .join("") + (done ? "data: [DONE]\n\n" : "")
  );
}

export function fixtureSse(payload: Record<string, unknown>): string {
  if (payload.candidates) return sse([payload]);
  if (payload.finish_reason === "COMPLETE") {
    const message = payload.message as { content: Array<{ text: string }> };
    return sse([
      ...message.content.map((part) => ({
        type: "content-delta",
        delta: { message: { content: part } },
      })),
      {
        type: "message-end",
        delta: { finish_reason: payload.finish_reason, usage: payload.usage },
      },
    ]);
  }
  if (payload.type === "message") {
    const blocks = payload.content as Array<{ text: string }>;
    return sse([
      { type: "message_start", message: { ...payload, content: [], stop_reason: null } },
      ...blocks.flatMap((block, index) => [
        { type: "content_block_start", index, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } },
        { type: "content_block_stop", index },
      ]),
      { type: "message_delta", delta: { stop_reason: payload.stop_reason }, usage: payload.usage },
      { type: "message_stop" },
    ]);
  }
  if (payload.object === "response") {
    const output = payload.output as Array<{ id: string; content: Array<{ text: string }> }>;
    return sse([
      { type: "response.created", response: { ...payload, status: "in_progress", output: [] } },
      ...output.flatMap((item, output_index) => [
        { type: "response.output_item.added", output_index, item: { ...item, content: [] } },
        ...item.content.flatMap((part, content_index) => [
          {
            type: "response.content_part.added",
            output_index,
            content_index,
            item_id: item.id,
            part: { type: "output_text", text: "", annotations: [] },
          },
          {
            type: "response.output_text.delta",
            output_index,
            content_index,
            item_id: item.id,
            delta: part.text,
          },
          {
            type: "response.output_text.done",
            output_index,
            content_index,
            item_id: item.id,
            text: part.text,
          },
          {
            type: "response.content_part.done",
            output_index,
            content_index,
            item_id: item.id,
            part,
          },
        ]),
        { type: "response.output_item.done", output_index, item },
      ]),
      { type: "response.completed", response: payload },
    ]);
  }
  if (!payload.choices) return JSON.stringify(payload);
  const choices = payload.choices as Array<{
    message: object;
    finish_reason: string;
    index: number;
  }>;
  return sse(
    [
      {
        ...payload,
        object: "chat.completion.chunk",
        choices: choices.map(({ message, ...choice }) => ({ ...choice, delta: message })),
      },
    ],
    true
  );
}
