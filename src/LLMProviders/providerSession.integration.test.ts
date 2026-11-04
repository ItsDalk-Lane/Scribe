import { act, renderHook } from "@testing-library/react";
import type { CustomModel } from "@/aiParams";
import { ChatModelProviders } from "@/constants";
import { useStreamingChatSession } from "@/hooks/use-streaming-chat-session";
import * as obsidianModule from "obsidian";

jest.mock("@/logger");

Object.defineProperty(AbortSignal.prototype, "throwIfAborted", {
  configurable: true,
  value() {
    if (this.aborted) throw this.reason;
  },
});

const issue = "https://github.com/anomalyco/opencode/issues/47756";
const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};
const model: CustomModel = {
  configuredModelId: "go-deepseek",
  name: "deepseek-v4.1-flash",
  provider: ChatModelProviders.OPENAI_FORMAT,
  baseUrl: "https://opencode.ai/inference/go/openai/v1",
  enabled: true,
  enableCors: true,
  apiKey: "test-key",
};

function captureRequests(): Array<Record<string, string>> {
  const requests: Array<Record<string, string>> = [];
  setRequestUrlImpl((request: { headers: Record<string, string>; body: string }) => {
    requests.push(request.headers);
    const streaming = (JSON.parse(request.body) as { stream?: boolean }).stream;
    const payload = {
      id: "chatcmpl-test",
      object: streaming ? "chat.completion.chunk" : "chat.completion",
      created: 1,
      model: model.name,
      choices: [
        {
          index: 0,
          ...(streaming
            ? { delta: { content: "ok" } }
            : { message: { role: "assistant", content: "ok" } }),
          finish_reason: "stop",
        },
      ],
    };
    const text = streaming
      ? `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`
      : JSON.stringify(payload);
    return Promise.resolve({
      status: 200,
      text,
      json: payload,
      arrayBuffer: new ArrayBuffer(0),
      headers: { "content-type": streaming ? "text/event-stream" : "application/json" },
    });
  });
  return requests;
}

function session(headers: Record<string, string>): string {
  const normalized = new Headers(headers);
  expect(normalized.get("user-agent")).toBe("obsidian-scribe/4");
  expect(normalized.get("authorization")).toBe("Bearer test-key");
  const value = normalized.get("x-opencode-session");
  expect(value).toEqual(expect.any(String));
  return value!;
}

describe("providerSession integration", () => {
  describe("useStreamingChatSession", () => {
    it(`keeps headers across quick-ask turns and model changes, then rotates on a new chat (${issue})`, async () => {
      const requests = captureRequests();
      const { result, rerender, unmount } = renderHook(
        ({ selected }) =>
          useStreamingChatSession({
            model: selected,
            systemPrompt: "Connection test",
            onNonAbortError: (error) => {
              throw error;
            },
          }),
        { initialProps: { selected: model } }
      );
      const turn = async (): Promise<void> => {
        await act(async () => {
          expect(await result.current.runTurn(async () => "Connection test")).toBe("ok");
        });
      };
      await turn();
      rerender({
        selected: { ...model, configuredModelId: "go-other-model", name: "other-model" },
      });
      await turn();
      act(() => result.current.reset());
      await turn();
      expect(requests).toHaveLength(3);
      expect(session(requests[0])).toBe(session(requests[1]));
      expect(session(requests[2])).not.toBe(session(requests[0]));
      unmount();
    });
  });
});
