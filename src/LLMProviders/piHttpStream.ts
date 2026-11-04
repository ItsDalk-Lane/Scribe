import type {
  Api,
  AssistantMessage,
  Model,
  StopReason,
  StreamOptions,
  ToolCall,
  JsonObject,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { raceWithAbortSignal } from "@earendil-works/pi-ai/utils/abort";
import { parseToolCallArguments } from "@earendil-works/pi-ai/utils/json-parse";
import { createAssistantMessage } from "@/LLMProviders/piChatModel";
import { logWarn } from "@/logger";
import { t } from "@/lib/i18n";
import { v4 as uuidv4 } from "uuid";

export interface HttpChatDelta {
  text?: string;
  thinking?: string;
  usage?: Partial<AssistantMessage["usage"]>;
  finishReason?: Extract<StopReason, "stop" | "length" | "toolUse">;
  toolCall?: {
    index: number;
    id?: string;
    name?: string;
    arguments?: string | JsonObject;
    thoughtSignature?: string;
  };
}

export function streamHttpCompletion(
  model: Model<Api>,
  options: StreamOptions | undefined,
  read: () => AsyncIterable<HttpChatDelta>
) {
  const events = createAssistantMessageEventStream();
  const output = createAssistantMessage(model);
  void (async () => {
    try {
      let finishReason: HttpChatDelta["finishReason"];
      const calls = new Map<number, { contentIndex: number; tool: ToolCall; json: string }>();
      events.push({ type: "start", partial: output });
      for await (const delta of read()) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (delta.toolCall) {
          const incoming = delta.toolCall;
          let call = calls.get(incoming.index);
          if (!call) {
            const tool: ToolCall = {
              type: "toolCall",
              id: incoming.id || uuidv4(),
              name: incoming.name || "",
              arguments: {},
            };
            call = { contentIndex: output.content.length, tool, json: "" };
            calls.set(incoming.index, call);
            output.content.push(tool);
            events.push({
              type: "toolcall_start",
              contentIndex: call.contentIndex,
              partial: output,
            });
          }
          if (incoming.id) call.tool.id = incoming.id;
          if (incoming.name) call.tool.name = incoming.name;
          if (incoming.thoughtSignature) call.tool.thoughtSignature = incoming.thoughtSignature;
          if (incoming.arguments !== undefined) {
            const fragment =
              typeof incoming.arguments === "string"
                ? incoming.arguments
                : JSON.stringify(incoming.arguments);
            call.json = typeof incoming.arguments === "string" ? call.json + fragment : fragment;
            events.push({
              type: "toolcall_delta",
              contentIndex: call.contentIndex,
              delta: fragment,
              partial: output,
            });
          }
        }
        for (const type of ["thinking", "text"] as const) {
          const value = delta[type];
          if (!value) continue;
          let index = output.content.findIndex((part) => part.type === type);
          if (index < 0) {
            index = output.content.length;
            output.content.push(
              type === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "" }
            );
            events.push({ type: `${type}_start`, contentIndex: index, partial: output });
          }
          const part = output.content[index];
          if (part.type === "text") part.text += value;
          else if (part.type === "thinking") part.thinking += value;
          events.push({
            type: `${type}_delta`,
            contentIndex: index,
            delta: value,
            partial: output,
          });
        }
        if (delta.usage) Object.assign(output.usage, delta.usage);
        if (delta.finishReason) {
          finishReason = delta.finishReason;
          output.stopReason = finishReason;
        }
      }
      // Disconnected custom-provider streams must not turn a partial answer into success. https://github.com/ItsDalk-Lane/Scribe/issues/8
      if (!finishReason) throw new Error(t("Unexpected response"));
      if (calls.size && finishReason === "stop") finishReason = "toolUse";
      if (finishReason === "toolUse" && !calls.size)
        throw new Error("Tool completion did not contain a tool call.");
      output.stopReason = finishReason;
      for (const call of calls.values()) {
        if (!call.tool.name) throw new Error("The provider returned a tool call without a name.");
        Object.assign(call.tool, parseToolCallArguments(call.json));
      }
      for (const [contentIndex, part] of output.content.entries()) {
        if (part.type === "text")
          events.push({ type: "text_end", contentIndex, content: part.text, partial: output });
        else if (part.type === "thinking")
          events.push({
            type: "thinking_end",
            contentIndex,
            content: part.thinking,
            partial: output,
          });
        else if (part.type === "toolCall")
          events.push({ type: "toolcall_end", contentIndex, toolCall: part, partial: output });
      }
      events.push({
        type: "done",
        reason: finishReason,
        message: output,
      });
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      events.push({ type: "error", reason: output.stopReason, error: output });
    } finally {
      events.end();
    }
  })();
  return events;
}

export async function* readJsonStream(
  response: Response,
  signal?: AbortSignal,
  ndjson = false
): AsyncGenerator<unknown> {
  if (!response.ok)
    throw Object.assign(
      new Error((await response.text()) || `${t("Unexpected response")} (${response.status})`),
      { status: response.status }
    );
  if (!response.body) throw new Error(t("Unexpected response"));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const operationSignal = signal ?? new AbortController().signal;
  try {
    while (true) {
      const next = await raceWithAbortSignal(reader.read(), operationSignal);
      buffer += decoder.decode(next.value, { stream: !next.done });
      const records = buffer.split(ndjson ? /\r?\n/ : /\r?\n\r?\n/);
      buffer = records.pop() || "";
      if (next.done && buffer.trim()) records.push(buffer);
      for (const record of records) {
        const data = ndjson
          ? record.trim()
          : record
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
        if (!data) continue;
        if (data === "[DONE]") {
          yield data;
          return;
        }
        yield JSON.parse(data);
      }
      if (next.done) return;
    }
  } finally {
    try {
      await reader.cancel();
    } catch (error) {
      logWarn("Error closing provider response stream:", error);
    } finally {
      reader.releaseLock();
    }
  }
}
