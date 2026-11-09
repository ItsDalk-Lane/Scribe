import { raceWithAbortSignal } from "@earendil-works/pi-ai/utils/abort";
import {
  classifyProviderFailure,
  type ProviderRequestFailure,
} from "@/LLMProviders/providerRequestFailure";
import { isRecord } from "@/utils/obsidianInternals";

const MAX_ERROR_BYTES = 65_536;

function parseRecord(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function observeProviderResponse(
  response: Response,
  onFailure: (failure: ProviderRequestFailure) => void,
  signal?: AbortSignal,
  onPayload?: (payload: unknown) => void,
  onEnd?: () => void
): Promise<Response> {
  if (!response.body) {
    if (!response.ok)
      onFailure(classifyProviderFailure({ status: response.status, headers: response.headers }));
    return response;
  }
  const reader = response.body.getReader();
  const operationSignal = signal ?? new AbortController().signal;
  if (!response.ok) {
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    try {
      while (bytes < MAX_ERROR_BYTES) {
        const next = await raceWithAbortSignal(reader.read(), operationSignal);
        if (next.done) break;
        const chunk = next.value.subarray(0, MAX_ERROR_BYTES - bytes);
        bytes += chunk.byteLength;
        text += decoder.decode(chunk, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel();
    }
    onFailure(
      classifyProviderFailure({
        status: response.status,
        payload: parseRecord(text),
        headers: response.headers,
      })
    );
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  const decoder = new TextDecoder();
  let pending = "";
  let eventData = "";
  let discardingLine = false;
  const observe = (text: string) => {
    const payload = parseRecord(text);
    if (payload !== undefined) onPayload?.(payload);
    if (
      isRecord(payload) &&
      (payload.error !== undefined ||
        payload.type === "error" ||
        payload.type === "response.failed")
    )
      onFailure(classifyProviderFailure({ payload, headers: response.headers }));
  };
  const readLine = (line: string) => {
    if (line.startsWith("data:")) {
      if (eventData.length < MAX_ERROR_BYTES) eventData += `${line.slice(5).trimStart()}\n`;
    } else if (!line.trim()) {
      if (eventData.length <= MAX_ERROR_BYTES) observe(eventData);
      eventData = "";
    } else if (line.trimStart().startsWith("{")) {
      observe(line);
    }
  };
  // 在 SDK 丢失错误结构前旁路观察，原始字节仍按需流向原解析器。https://github.com/ItsDalk-Lane/Scribe/issues/31
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await raceWithAbortSignal(reader.read(), operationSignal);
        const text = decoder.decode(next.value, { stream: !next.done });
        for (const fragment of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
          if (!discardingLine) pending += fragment;
          if (pending.length > MAX_ERROR_BYTES) {
            pending = "";
            eventData = "";
            discardingLine = true;
          }
          if (fragment.endsWith("\n")) {
            if (!discardingLine) readLine(pending.replace(/\r?\n$/, ""));
            pending = "";
            discardingLine = false;
          }
        }
        if (next.done) {
          if (pending && !discardingLine) readLine(pending);
          if (eventData && eventData.length <= MAX_ERROR_BYTES) observe(eventData);
          onEnd?.();
          controller.close();
          reader.releaseLock();
        } else controller.enqueue(next.value);
      } catch (error) {
        // 正文读取失败在 SDK 丢失错误结构之前先给出类别；网络中断按暂时性处理，可由上层既有边界决定是否重试。https://github.com/ItsDalk-Lane/Scribe/issues/58
        onFailure(
          error instanceof TypeError
            ? { kind: "transient" }
            : classifyProviderFailure({ cause: error, callerAborted: operationSignal.aborted })
        );
        controller.error(error);
        await reader.cancel().catch(() => {});
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
