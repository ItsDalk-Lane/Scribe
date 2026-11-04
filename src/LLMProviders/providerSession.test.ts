import { getProviderSessionOptions, resetProviderSession } from "@/LLMProviders/providerSession";
import { ChatModelProviders } from "@/constants";

const GO_MODEL = {
  provider: ChatModelProviders.OPENAI_FORMAT,
  baseUrl: "https://opencode.ai/inference/go/openai/v1",
};
const issue = "https://github.com/anomalyco/opencode/issues/47756";

describe("providerSession", () => {
  describe("getProviderSessionOptions", () => {
    it.each([
      [ChatModelProviders.ANTHROPIC, "https://opencode.ai/inference/go/anthropic/v1"],
      [ChatModelProviders.GOOGLE, "https://opencode.ai/inference/go/google/v1beta"],
      [ChatModelProviders.OPENAI, GO_MODEL.baseUrl],
    ])(
      `keeps the same conversation across Go protocol changes %s (${issue})`,
      (provider, baseUrl) => {
        const owner = {};
        const first = getProviderSessionOptions(GO_MODEL, owner);
        expect(
          getProviderSessionOptions({ provider, baseUrl }, owner)?.options.headers[
            "x-opencode-session"
          ]
        ).toBe(first?.options.headers["x-opencode-session"]);
      }
    );
    it(`identifies Scribe and attaches a session to an official Go conversation (${issue})`, () => {
      const result = getProviderSessionOptions(GO_MODEL, {});
      expect(result?.options.headers["User-Agent"]).toBe("obsidian-scribe/4");
      expect(result?.options.headers["x-opencode-session"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it(`keeps one session across turns and model reconstruction for the same memory owner (${issue})`, () => {
      const owner = {};
      const first = getProviderSessionOptions(GO_MODEL, owner);
      const second = getProviderSessionOptions({ ...GO_MODEL }, owner);
      expect(first?.options.headers["x-opencode-session"]).toBeDefined();
      expect(second?.options.headers["x-opencode-session"]).toBe(
        first?.options.headers["x-opencode-session"]
      );
    });

    it(`gives independent conversations distinct session identities (${issue})`, () => {
      const first = getProviderSessionOptions(GO_MODEL, {});
      const second = getProviderSessionOptions(GO_MODEL, {});
      expect(first?.options.headers["x-opencode-session"]).toBeDefined();
      expect(second?.options.headers["x-opencode-session"]).not.toBe(
        first?.options.headers["x-opencode-session"]
      );
    });

    it(`recognizes the official Go base with surrounding whitespace and trailing slashes (${issue})`, () => {
      const result = getProviderSessionOptions(
        { ...GO_MODEL, baseUrl: " https://opencode.ai/inference/go/openai/v1/// " },
        {}
      );
      expect(result?.options.headers["x-opencode-session"]).toBeDefined();
    });

    it.each([
      null,
      { provider: ChatModelProviders.OPENAI_FORMAT },
      { ...GO_MODEL, baseUrl: "not a provider URL" },
      { ...GO_MODEL, baseUrl: "https://api.openai.com/v1" },
      { ...GO_MODEL, baseUrl: "https://proxy.example/inference/go/openai/v1" },
      { ...GO_MODEL, baseUrl: "https://opencode.ai.proxy.example/inference/go/openai/v1" },
      { ...GO_MODEL, baseUrl: "http://opencode.ai/inference/go/openai/v1" },
      { ...GO_MODEL, baseUrl: "https://opencode.ai/inference/openai/v1" },
    ])(`adds no Go headers for a different provider or routing target %p (${issue})`, (model) => {
      expect(getProviderSessionOptions(model, {})).toBeUndefined();
    });
  });

  describe("resetProviderSession", () => {
    it(`starts a different session when a memory owner is reused for a new conversation (${issue})`, () => {
      const owner = {};
      const first = getProviderSessionOptions(GO_MODEL, owner);
      resetProviderSession(owner);
      const second = getProviderSessionOptions(GO_MODEL, owner);
      expect(first?.options.headers["x-opencode-session"]).toBeDefined();
      expect(second?.options.headers["x-opencode-session"]).toBeDefined();
      expect(second?.options.headers["x-opencode-session"]).not.toBe(
        first?.options.headers["x-opencode-session"]
      );
    });
  });
});
