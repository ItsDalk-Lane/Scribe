import { act, renderHook } from "@testing-library/react";
import type { CustomModel } from "@/aiParams";
import { ChatModelProviders } from "@/constants";
import { useStreamingChatSession } from "@/hooks/use-streaming-chat-session";
import { fixtureSse } from "@/LLMProviders/testing/piFixtures";
import * as obsidian from "obsidian";

jest.mock("@/logger");

const { __setRequestUrlImpl: setRequestUrlImpl } = obsidian as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/8";
const mockTextUpdate = jest.fn();

jest.mock("@/hooks/use-raf-throttled-callback", () => ({
  // The test observes the delivery boundary, not the browser's frame scheduling. https://github.com/ItsDalk-Lane/Scribe/issues/8
  useRafThrottledCallback: (callback: (text: string) => void) => (text: string) => {
    callback(text);
    mockTextUpdate(text);
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function controlledReply() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = jest.fn();
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel: cancelled,
  });
  const chunk = (text: string, finish: string | null = null) =>
    controller.enqueue(
      new TextEncoder().encode(
        `data: ${JSON.stringify({
          id: "reply",
          model: "fixture-model",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content: text }, finish_reason: finish }],
        })}\n\n`
      )
    );
  return {
    response: {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream" }),
      body,
    } as Response,
    chunk,
    cancelled,
    fail(error: Error) {
      controller.error(error);
    },
    finish() {
      chunk("", "stop");
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  };
}

const model: CustomModel = {
  configuredModelId: "fixture",
  name: "fixture-model",
  provider: ChatModelProviders.OPENAI_FORMAT,
  providerNpm: "@ai-sdk/openai-compatible",
  baseUrl: "https://fixture.invalid/v1",
  apiKey: "fixture-key",
  enabled: true,
  enableCors: false,
};

function observeText(expected: string): Promise<void> {
  const update = deferred<void>();
  mockTextUpdate.mockImplementation((text: string) => {
    if (text === expected) update.resolve();
  });
  return update.promise;
}

describe("use-streaming-chat-session", () => {
  describe("useStreamingChatSession()", () => {
    const originalFetch = window.fetch;

    beforeEach(() => {
      mockTextUpdate.mockReset();
    });

    afterEach(() => {
      window.fetch = originalFetch;
    });

    it(`publishes each received text increment before the connection completes (${issue})`, async () => {
      const reply = controlledReply();
      const started = deferred<RequestInit>();
      window.fetch = jest.fn(async (_url, init) => {
        started.resolve(init!);
        return reply.response;
      });
      const { result } = renderHook(() =>
        useStreamingChatSession({
          model,
          systemPrompt: "Keep the original instruction.",
          onNonAbortError: started.reject,
        })
      );
      let turn!: Promise<string | null>;
      await act(async () => {
        turn = result.current.runTurn(async () => "Question");
        await started.promise;
      });
      expect(result.current.isStreaming).toBe(true);

      const firstText = observeText("First");
      await act(async () => {
        reply.chunk("First");
        await firstText;
      });
      expect(result.current.streamingText).toBe("First");
      expect(result.current.getLatestStreamingText()).toBe("First");
      expect(result.current.getIsFirstTurn()).toBe(true);

      const secondText = observeText("First second");
      await act(async () => {
        reply.chunk(" second");
        await secondText;
      });
      expect(result.current.streamingText).toBe("First second");
      expect(result.current.isStreaming).toBe(true);

      await act(async () => {
        reply.finish();
        expect(await turn).toBe("First second");
      });
      expect(result.current.streamingText).toBe("");
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.getIsFirstTurn()).toBe(false);
    });

    it(`replays a stopped partial answer in the follow-up without duplicating text (${issue})`, async () => {
      const reply = controlledReply();
      const followUp = controlledReply();
      const firstStarted = deferred<RequestInit>();
      const secondStarted = deferred<RequestInit>();
      window.fetch = jest
        .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockImplementationOnce(async (_url, init) => {
          firstStarted.resolve(init!);
          return reply.response;
        })
        .mockImplementationOnce(async (_url, init) => {
          secondStarted.resolve(init!);
          return followUp.response;
        });
      const onNonAbortError = jest.fn();
      const { result } = renderHook(() =>
        useStreamingChatSession({ model, systemPrompt: "Original system", onNonAbortError })
      );
      let first!: Promise<string | null>;
      await act(async () => {
        first = result.current.runTurn(async () => "First question");
        await firstStarted.promise;
      });
      const text = observeText("Kept partial");
      await act(async () => {
        reply.chunk("Kept partial");
        await text;
      });
      await act(async () => {
        result.current.stop();
        expect(await first).toBe("Kept partial");
      });
      expect((await firstStarted.promise).signal?.aborted).toBe(true);
      expect(onNonAbortError).not.toHaveBeenCalled();

      let second!: Promise<string | null>;
      await act(async () => {
        second = result.current.runTurn(async ({ isFirstTurn }) => {
          expect(isFirstTurn).toBe(false);
          return "Continue";
        });
        await secondStarted.promise;
      });
      const request = await secondStarted.promise;
      expect(JSON.parse(request.body as string).messages).toEqual([
        { role: "system", content: "Original system" },
        { role: "user", content: "First question" },
        { role: "assistant", content: "Kept partial" },
        { role: "user", content: "Continue" },
      ]);
      await act(async () => {
        followUp.chunk("Continuation");
        followUp.finish();
        expect(await second).toBe("Continuation");
      });
    });

    it(`resets history and prevents a cancelled turn from changing its replacement (${issue})`, async () => {
      const previous = controlledReply();
      const next = controlledReply();
      const firstStarted = deferred<RequestInit>();
      const nextStarted = deferred<RequestInit>();
      window.fetch = jest
        .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockImplementationOnce(async (_url, init) => {
          firstStarted.resolve(init!);
          return previous.response;
        })
        .mockImplementationOnce(async (_url, init) => {
          nextStarted.resolve(init!);
          return next.response;
        });
      const { result } = renderHook(() =>
        useStreamingChatSession({ model, systemPrompt: "Original system" })
      );
      let oldTurn!: Promise<string | null>;
      await act(async () => {
        oldTurn = result.current.runTurn(async () => "Discard me");
        await firstStarted.promise;
      });
      const text = observeText("Discarded answer");
      await act(async () => {
        previous.chunk("Discarded answer");
        await text;
      });
      let newTurn!: Promise<string | null>;
      await act(async () => {
        result.current.reset();
        newTurn = result.current.runTurn(async ({ isFirstTurn }) => {
          expect(isFirstTurn).toBe(true);
          return "New question";
        });
        await nextStarted.promise;
        expect(await oldTurn).toBeNull();
      });
      expect(result.current.isStreaming).toBe(true);
      expect(JSON.parse((await nextStarted.promise).body as string).messages).toEqual([
        { role: "system", content: "Original system" },
        { role: "user", content: "New question" },
      ]);
      await act(async () => {
        next.chunk("New answer");
        next.finish();
        expect(await newTurn).toBe("New answer");
      });
    });

    it(`aborts an unmounted session without reporting an error or committing output (${issue})`, async () => {
      const reply = controlledReply();
      const started = deferred<RequestInit>();
      window.fetch = jest.fn(async (_url, init) => {
        started.resolve(init!);
        return reply.response;
      });
      const onNonAbortError = jest.fn();
      const { result, unmount } = renderHook(() =>
        useStreamingChatSession({ model, systemPrompt: "System", onNonAbortError })
      );
      let turn!: Promise<string | null>;
      await act(async () => {
        turn = result.current.runTurn(async () => "Question");
        await started.promise;
      });
      const text = observeText("Uncommitted");
      await act(async () => {
        reply.chunk("Uncommitted");
        await text;
      });
      unmount();
      expect(await turn).toBeNull();
      expect((await started.promise).signal?.aborted).toBe(true);
      expect(onNonAbortError).not.toHaveBeenCalled();
    });

    it(`does not save a failed partial reply and retries with the original history (${issue})`, async () => {
      const failedReply = controlledReply();
      const retryReply = controlledReply();
      const firstStarted = deferred<RequestInit>();
      const retryStarted = deferred<RequestInit>();
      window.fetch = jest
        .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockImplementationOnce(async (_url, init) => {
          firstStarted.resolve(init!);
          return failedReply.response;
        })
        .mockImplementationOnce(async (_url, init) => {
          retryStarted.resolve(init!);
          return retryReply.response;
        });
      const onNonAbortError = jest.fn();
      const { result } = renderHook(() =>
        useStreamingChatSession({ model, systemPrompt: "System", onNonAbortError })
      );
      let failed!: Promise<string | null>;
      await act(async () => {
        failed = result.current.runTurn(async () => "Original question");
        await firstStarted.promise;
      });
      const partial = observeText("Incomplete");
      await act(async () => {
        failedReply.chunk("Incomplete");
        await partial;
      });
      await act(async () => {
        failedReply.fail(new Error("Connection interrupted"));
        expect(await failed).toBeNull();
      });
      expect(onNonAbortError).toHaveBeenCalledTimes(1);
      expect(onNonAbortError.mock.calls[0][0]).toHaveProperty(
        "message",
        expect.stringContaining("Connection interrupted")
      );
      expect(result.current.getIsFirstTurn()).toBe(true);
      expect(result.current.getMemory()?.chatHistory.messages).toEqual([]);
      let retry!: Promise<string | null>;
      await act(async () => {
        retry = result.current.runTurn(async () => "Original question");
        await retryStarted.promise;
      });
      expect(JSON.parse((await retryStarted.promise).body as string).messages).toEqual([
        { role: "system", content: "System" },
        { role: "user", content: "Original question" },
      ]);
      await act(async () => {
        retryReply.chunk("Complete");
        retryReply.finish();
        expect(await retry).toBe("Complete");
      });
    });

    it(`ignores a late buffered compatibility response after stop and reset (${issue})`, async () => {
      const opened = deferred<void>();
      const oldResponse = deferred<unknown>();
      const body = (text: string) => ({
        status: 200,
        json: {},
        headers: { "content-type": "text/event-stream" },
        text: fixtureSse({
          choices: [{ index: 0, message: { content: text }, finish_reason: "stop" }],
        }),
        arrayBuffer: new ArrayBuffer(0),
      });
      setRequestUrlImpl(
        jest
          .fn()
          .mockImplementationOnce(() => {
            opened.resolve();
            return oldResponse.promise;
          })
          .mockResolvedValue(body("New answer"))
      );
      window.fetch = jest
        .fn()
        .mockRejectedValue(new Error("Compatibility mode must not use native fetch"));
      const onNonAbortError = jest.fn();
      const { result } = renderHook(() =>
        useStreamingChatSession({
          model: { ...model, enableCors: true },
          systemPrompt: "System",
          onNonAbortError,
        })
      );
      let oldTurn!: Promise<string | null>;
      await act(async () => {
        oldTurn = result.current.runTurn(async () => "Discard");
        await opened.promise;
      });
      await act(async () => {
        result.current.stop();
        expect(await oldTurn).toBeNull();
      });
      await act(async () => {
        result.current.reset();
        oldResponse.resolve(body("Late stale answer"));
        expect(await result.current.runTurn(async () => "New question")).toBe("New answer");
      });
      expect(result.current.getMemory()?.chatHistory.messages).toMatchObject([
        { role: "user", content: "New question" },
        { role: "assistant", content: [{ type: "text", text: "New answer" }] },
      ]);
      expect(onNonAbortError).not.toHaveBeenCalled();
      expect(window.fetch).not.toHaveBeenCalled();
    });

    it.each(["stop", "reset", "unmount"] as const)(
      `does not start inference when %s interrupts prompt preparation (${issue})`,
      async (action) => {
        const prompt = deferred<string>();
        const preparing = deferred<void>();
        window.fetch = jest.fn();
        const { result, unmount } = renderHook(() =>
          useStreamingChatSession({ model, systemPrompt: "System" })
        );
        let turn!: Promise<string | null>;
        await act(async () => {
          turn = result.current.runTurn(async () => {
            preparing.resolve();
            return prompt.promise;
          });
          await preparing.promise;
        });
        await act(async () => {
          if (action === "stop") result.current.stop();
          else if (action === "reset") result.current.reset();
          else unmount();
          prompt.resolve("Old prepared question");
          expect(await turn).toBeNull();
        });
        expect(window.fetch).not.toHaveBeenCalled();
      }
    );
  });
});
