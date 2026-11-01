import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { NativeSdkChatModel, type NativeLanguageModel } from "./NativeSdkChatModel";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";

function nativeModel(overrides: Record<string, unknown> = {}): NativeLanguageModel {
  return {
    specificationVersion: "v4",
    provider: "fixture",
    modelId: "fixture-model",
    supportedUrls: {},
    doGenerate: jest.fn().mockResolvedValue({
      content: [{ type: "text", text: "Fixture answer" }],
      finishReason: { unified: "stop", raw: "STOP" },
      usage: { inputTokens: { total: 3 }, outputTokens: { total: 2 } },
      warnings: [],
    }),
    doStream: jest.fn(),
    ...overrides,
  } as unknown as NativeLanguageModel;
}

describe("NativeSdkChatModel", () => {
  describe("NativeSdkChatModel", () => {
    describe("_llmType()", () => {
      it("identifies the native provider SDK bridge", () => {
        expect(new NativeSdkChatModel(nativeModel())._llmType()).toBe("native-provider-sdk");
      });
    });
    describe("_generate()", () => {
      it("returns a provider reply and usage without altering system or conversation text", async () => {
        const sdk = nativeModel();
        const result = await new NativeSdkChatModel(sdk).invoke([
          new SystemMessage("My original system prompt"),
          new HumanMessage("A private question"),
          new AIMessage("A previous answer"),
        ]);
        expect(result.content).toBe("Fixture answer");
        expect(result.usage_metadata).toEqual({
          input_tokens: 3,
          output_tokens: 2,
          total_tokens: 5,
        });
        expect(sdk.doGenerate).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: [
              { role: "system", content: "My original system prompt" },
              { role: "user", content: [{ type: "text", text: "A private question" }] },
              { role: "assistant", content: [{ type: "text", text: "A previous answer" }] },
            ],
          })
        );
      });
      it.each(["v2", "v3", "v4"])(
        "keeps image bytes while adapting the %s prompt format",
        async (version) => {
          const sdk = nativeModel({ specificationVersion: version });
          await new NativeSdkChatModel(sdk).invoke([
            new HumanMessage({
              content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
            }),
          ]);
          const input = (sdk.doGenerate as jest.Mock).mock.calls[0][0] as {
            prompt: Array<{
              content: Array<{
                type: string;
                mediaType: string;
                data: { data: Uint8Array } | Uint8Array;
              }>;
            }>;
          };
          const image = input.prompt[0].content[0];
          expect(image.type).toBe("file");
          expect(image.mediaType).toBe("image/png");
          expect(version === "v4" ? (image.data as { data: Uint8Array }).data : image.data).toEqual(
            new Uint8Array([1, 2, 3])
          );
        }
      );
      it("passes remote image URLs as URLs without changing their address", async () => {
        const sdk = nativeModel();
        await new NativeSdkChatModel(sdk).invoke([
          new HumanMessage({
            content: [{ type: "image_url", image_url: "https://images.example/private.png" }],
          }),
        ]);
        expect(
          (sdk.doGenerate as jest.Mock).mock.calls[0][0].prompt[0].content[0].data.url.href
        ).toBe("https://images.example/private.png");
      });
      it("preserves V2 usage totals and reasoning while returning the original reply", async () => {
        const sdk = nativeModel({
          specificationVersion: "v2",
          doGenerate: jest.fn().mockResolvedValue({
            content: [
              { type: "reasoning", text: "Private reasoning" },
              { type: "text", text: "Reply" },
            ],
            finishReason: "length",
            usage: { inputTokens: 2, outputTokens: 3, totalTokens: 8 },
            warnings: [],
          }),
        });
        const result = await new NativeSdkChatModel(sdk).invoke("Original input");
        expect(result.content).toBe("Reply");
        expect(result.additional_kwargs.reasoning_content).toBe("Private reasoning");
        expect(result.response_metadata.finish_reason).toBe("length");
        expect(result.usage_metadata?.total_tokens).toBe(8);
      });
      it("does not invent usage when the provider reports no counts", async () => {
        const sdk = nativeModel({
          doGenerate: jest.fn().mockResolvedValue({
            content: [{ type: "text", text: "Reply" }],
            finishReason: { unified: "stop" },
            usage: { inputTokens: {}, outputTokens: {} },
            warnings: [],
          }),
        });
        expect((await new NativeSdkChatModel(sdk).invoke("Input")).usage_metadata).toBeUndefined();
      });
      it("forwards both session header forms and the explicit output limit", async () => {
        const sdk = nativeModel();
        const controller = new AbortController();
        await new NativeSdkChatModel(sdk, 2048).invoke("Original", {
          signal: controller.signal,
          headers: { "x-opencode-session": "conversation-one" },
          options: { headers: { "User-Agent": "obsidian-scribe/4" } },
        });
        expect(sdk.doGenerate).toHaveBeenCalledWith(
          expect.objectContaining({
            abortSignal: controller.signal,
            maxOutputTokens: 2048,
            headers: {
              "x-opencode-session": "conversation-one",
              "User-Agent": "obsidian-scribe/4",
            },
          })
        );
      });
      it("refreshes a lazy provider before each auxiliary request", async () => {
        const sdk = nativeModel();
        const resolve = jest.fn(async () => sdk);
        const client = new NativeSdkChatModel(resolve);
        await client.invoke("First");
        await client.invoke("Second");
        expect(resolve).toHaveBeenCalledTimes(2);
      });
      it("rejects unsupported tool messages before a provider request is sent", async () => {
        const sdk = nativeModel();
        await expect(
          new NativeSdkChatModel(sdk).invoke([
            new ToolMessage({ content: "tool result", tool_call_id: "call-1" }),
          ])
        ).rejects.toThrow("Unsupported native model message role");
        expect(sdk.doGenerate).not.toHaveBeenCalled();
      });
      it("rejects unsupported content before it can be silently dropped", async () => {
        const sdk = nativeModel();
        await expect(
          new NativeSdkChatModel(sdk).invoke([
            new HumanMessage({ content: [{ type: "unsupported", value: "private" }] }),
          ])
        ).rejects.toThrow("Unsupported native model message content");
        expect(sdk.doGenerate).not.toHaveBeenCalled();
      });
      it("retries a transient provider failure and returns the successful reply", async () => {
        jest.useFakeTimers();
        try {
          const sdk = nativeModel();
          jest
            .mocked(sdk.doGenerate)
            .mockRejectedValueOnce(
              Object.assign(new Error("Temporary capacity failure"), { statusCode: 503 })
            );
          const reply = new NativeSdkChatModel(sdk).invoke("Original retry input");
          await jest.runAllTimersAsync();
          expect((await reply).content).toBe("Fixture answer");
          expect(sdk.doGenerate).toHaveBeenCalledTimes(2);
        } finally {
          jest.useRealTimers();
        }
      });
      it("preserves a rejected provider error without retrying invalid credentials", async () => {
        const error = Object.assign(new Error("Invalid provider key"), { statusCode: 401 });
        const sdk = nativeModel({ doGenerate: jest.fn().mockRejectedValue(error) });
        await expect(new NativeSdkChatModel(sdk).invoke("Fixture")).rejects.toThrow(
          "Invalid provider key"
        );
        expect(sdk.doGenerate).toHaveBeenCalledTimes(1);
      });
    });
    describe("_streamResponseChunks()", () => {
      it.each(["v2", "v3", "v4"])("streams %s text, reasoning and final usage", async (version) => {
        const sdk = nativeModel({
          specificationVersion: version,
          doStream: jest.fn(async () => ({
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: "reasoning-delta", id: "r", delta: "Reasoning" });
                controller.enqueue({ type: "text-delta", id: "t", delta: "Reply" });
                controller.enqueue({
                  type: "finish",
                  finishReason: version === "v2" ? "stop" : { unified: "stop" },
                  usage:
                    version === "v2"
                      ? { inputTokens: 2, outputTokens: 1 }
                      : { inputTokens: { total: 2 }, outputTokens: { total: 1 } },
                });
                controller.close();
              },
            }),
          })),
        });
        const chunks = [];
        for await (const chunk of await new NativeSdkChatModel(sdk).stream("Original"))
          chunks.push(chunk);
        expect(
          chunks.map((chunk) => (typeof chunk.content === "string" ? chunk.content : "")).join("")
        ).toBe("Reply");
        expect(
          chunks.find((chunk) => chunk.additional_kwargs.reasoning_content)?.additional_kwargs
            .reasoning_content
        ).toBe("Reasoning");
        expect(chunks.find((chunk) => chunk.usage_metadata)?.usage_metadata?.total_tokens).toBe(3);
      });
      it("throws streamed provider errors without restarting an already emitted response", async () => {
        const sdk = nativeModel({
          doStream: jest.fn(async () => ({
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: "text-delta", id: "t", delta: "Partial" });
                controller.enqueue({ type: "error", error: new Error("Provider stream failed") });
                controller.close();
              },
            }),
          })),
        });
        const iterator = await new NativeSdkChatModel(sdk).stream("Original");
        expect((await iterator.next()).value?.content).toBe("Partial");
        await expect(iterator.next()).rejects.toThrow("Provider stream failed");
        expect(sdk.doStream).toHaveBeenCalledTimes(1);
      });
      it("cancels a pending reader when the user stops the response", async () => {
        const cancelled = jest.fn();
        let started!: () => void;
        const opened = new Promise<void>((resolve) => {
          started = resolve;
        });
        const source = new ReadableStream<LanguageModelV4StreamPart>({ cancel: cancelled });
        const getReader = source.getReader.bind(
          source
        ) as () => ReadableStreamDefaultReader<LanguageModelV4StreamPart>;
        source.getReader = (() => {
          started();
          return getReader();
        }) as typeof source.getReader;
        const sdk = nativeModel({ doStream: jest.fn(async () => ({ stream: source })) });
        const controller = new AbortController();
        const pending = new NativeSdkChatModel(sdk).stream("Original", {
          signal: controller.signal,
        });
        await opened;
        controller.abort();
        await expect(pending).rejects.toThrow();
        expect(cancelled).toHaveBeenCalled();
      });
    });
  });
});
