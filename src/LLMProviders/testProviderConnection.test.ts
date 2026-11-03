import { testProviderConnection } from "./testProviderConnection";
import type { Provider } from "@/modelManagement";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

const mockCreateModel = jest.fn();
jest.mock("@/LLMProviders/chatModelManager", () => ({
  __esModule: true,
  default: { getInstance: () => ({ createModelInstanceFromBridged: mockCreateModel }) },
}));
const provider: Provider = {
  providerId: "p",
  providerType: "openai-compatible",
  displayName: "Test",
  baseUrl: "https://provider.example/v1",
  origin: { kind: "byok" },
  addedAt: 0,
  requiresApiKey: true,
};
const input = {
  provider,
  model: { id: "test-model", displayName: "Test model" },
  apiKey: "test-secret",
};

describe("testProviderConnection", () => {
  describe("testProviderConnection()", () => {
    beforeEach(() => {
      mockCreateModel.mockReset();
    });
    it("sends only the connection prompt through the same model factory and waits for actual reply text", async () => {
      const stream = jest.fn().mockImplementation(async function* () {
        yield { type: "text_delta", delta: "O" };
        yield { type: "text_delta", delta: "K" };
      });
      mockCreateModel.mockResolvedValue({ stream });
      const result = await testProviderConnection(input);
      expect(result).toMatchObject({ ok: true });
      expect(result.message).toContain("Test model");
      expect(mockCreateModel).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "test-model",
          apiKey: "test-secret",
          baseUrl: provider.baseUrl,
          providerNpm: "@ai-sdk/openai-compatible",
          enableCors: true,
        })
      );
      expect(stream.mock.calls[0][0]).toEqual({
        messages: [expect.objectContaining({ content: "Reply with OK." })],
      });
    });
    it("keeps a permission refusal distinct from an invalid key and redacts the supplied secret", async () => {
      mockCreateModel.mockResolvedValue({
        stream: jest.fn().mockImplementation(() => {
          throw Object.assign(new Error("permission denied test-secret"), { status: 403 });
        }),
      });
      expect(await testProviderConnection(input)).toMatchObject({
        ok: false,
        code: "permission_denied",
      });
      const result = await testProviderConnection(input);
      expect(result.message).toContain("permission denied");
      expect(result.message).not.toContain("test-secret");
    });
    it("reports invalid credentials for an actual 401 chat response", async () => {
      mockCreateModel.mockResolvedValue({
        stream: jest.fn().mockImplementation(() => {
          throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
        }),
      });
      expect(await testProviderConnection(input)).toMatchObject({
        ok: false,
        code: "invalid_api_key",
      });
    });
    it("does not call the model when a required credential is blank", async () => {
      expect(await testProviderConnection({ ...input, apiKey: "   " })).toMatchObject({
        ok: false,
        code: "missing_api_key",
      });
      expect(mockCreateModel).not.toHaveBeenCalled();
    });
    it("does not mark an empty model response as a verified chat", async () => {
      mockCreateModel.mockResolvedValue({
        stream: async function* () {
          yield { type: "text_delta", delta: "" };
        },
      });
      expect(await testProviderConnection(input)).toMatchObject({
        ok: false,
        code: "empty_response",
      });
    });
    it("does not send a request after the user cancels the test", async () => {
      const controller = new AbortController();
      controller.abort();
      expect(await testProviderConnection({ ...input, signal: controller.signal })).toMatchObject({
        ok: false,
        code: "cancelled",
      });
      expect(mockCreateModel).not.toHaveBeenCalled();
    });
    it("times out a nonresponsive model without starting another request", async () => {
      jest.useFakeTimers();
      const stream = createAssistantMessageEventStream();
      mockCreateModel.mockResolvedValue({
        stream: () => stream,
      });
      const result = testProviderConnection(input);
      await jest.advanceTimersByTimeAsync(90000);
      expect(await result).toMatchObject({ ok: false, code: "timeout" });
      expect(mockCreateModel).toHaveBeenCalledTimes(1);
      stream.end();
      jest.useRealTimers();
    });
  });
});
