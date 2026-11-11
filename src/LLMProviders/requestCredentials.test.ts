import { createProviderChatModel } from "@/LLMProviders/createProviderChatModel";
import { ChatModelProviders } from "@/constants";
import type { CustomModel } from "@/aiParams";

const mockWithSecret = jest.fn<Promise<unknown>, [string, (value: string) => Promise<unknown>]>();
const mockResolvers: Array<(options: object) => Promise<unknown>> = [];
jest.mock(
  "@/services/secretStore",
  () => ({
    SecretStore: { getInstance: () => ({ withSecret: mockWithSecret }) },
  }),
  { virtual: true }
);
jest.mock("@/LLMProviders/piChatModel", () => ({
  createPiChatModel: (model: object, resolve: (options: object) => Promise<unknown>) => {
    mockResolvers.push(resolve);
    return { model, stream: jest.fn(), agentStream: jest.fn() };
  },
}));
jest.mock("@earendil-works/pi-ai/api/openai-completions", () => ({ stream: jest.fn() }));

function savedModel(): CustomModel {
  return {
    name: "test-model",
    provider: ChatModelProviders.OPENAI_FORMAT,
    providerNpm: "@ai-sdk/openai-compatible",
    baseUrl: "https://provider.example/v1",
    enabled: true,
    requiresApiKey: true,
    credentialRef: "provider-record",
  };
}

describe("requestCredentials", () => {
  beforeEach(() => {
    mockResolvers.length = 0;
    mockWithSecret.mockReset();
    mockWithSecret.mockImplementation(async (_id, execute) => execute("synthetic-provider-key"));
  });
  describe("createProviderChatModel()", () => {
    it("keeps a saved credential encrypted while constructing a reusable model", async () => {
      await createProviderChatModel(savedModel());
      expect(mockWithSecret).not.toHaveBeenCalled();
    });
    it("resolves only the selected credential independently for each outgoing request", async () => {
      await createProviderChatModel(savedModel());
      const request = (await mockResolvers[0]({})) as {
        options: { apiKey: string };
        redactionValues: string[];
      };
      expect(mockWithSecret).toHaveBeenCalledWith("provider-record", expect.any(Function));
      expect(request.options.apiKey).toBe("synthetic-provider-key");
      expect(request.redactionValues).toContain("synthetic-provider-key");
      await mockResolvers[0]({});
      expect(mockWithSecret).toHaveBeenCalledTimes(2);
    });
    it("does not prepare a provider request when unlocking is cancelled", async () => {
      mockWithSecret.mockRejectedValue(new DOMException("Cancelled", "AbortError"));
      await createProviderChatModel(savedModel());
      await expect(mockResolvers[0]({})).rejects.toMatchObject({ name: "AbortError" });
    });
  });
});
