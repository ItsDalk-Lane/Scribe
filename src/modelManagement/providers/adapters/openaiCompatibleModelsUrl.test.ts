import { openaiCompatibleModelsUrl } from "@/modelManagement/providers/adapters/openaiCompatibleModelsUrl";

describe("openaiCompatibleModelsUrl", () => {
  describe("openaiCompatibleModelsUrl()", () => {
    it("uses the conventional models path for an ordinary OpenAI-compatible base URL", () => {
      expect(openaiCompatibleModelsUrl("https://api.example/v1")).toBe(
        "https://api.example/v1/models"
      );
    });

    it.each([
      ["https://opencode.ai/inference/go/openai/v1", "https://opencode.ai/inference/go/v1/models"],
      ["https://opencode.ai/inference/openai/v1", "https://opencode.ai/inference/v1/models"],
    ])(
      "maps the exact official protocol base %s to its model directory (https://github.com/logancyang/obsidian-copilot/issues/3147)",
      (baseUrl, expected) => {
        expect(openaiCompatibleModelsUrl(baseUrl)).toBe(expected);
      }
    );

    it.each([
      [
        " https://opencode.ai/inference/go/openai/v1/// ",
        "https://opencode.ai/inference/go/v1/models",
      ],
      [" https://custom.example/v1/// ", "https://custom.example/v1/models"],
    ])(
      "ignores whitespace and trailing slashes in %s (https://github.com/logancyang/obsidian-copilot/issues/3147)",
      (baseUrl, expected) => {
        expect(openaiCompatibleModelsUrl(baseUrl)).toBe(expected);
      }
    );

    it.each([
      "https://proxy.example/inference/go/openai/v1",
      "https://opencode.ai.proxy.example/inference/go/openai/v1",
      "http://opencode.ai/inference/go/openai/v1",
      "https://opencode.ai/inference/go/openai/v2",
      "https://opencode.ai/custom/openai/v1",
    ])(
      "keeps the credential destination and path unchanged for an unconfigured base %s (https://github.com/logancyang/obsidian-copilot/issues/3147)",
      (baseUrl) => {
        expect(openaiCompatibleModelsUrl(baseUrl)).toBe(`${baseUrl}/models`);
      }
    );
  });
});
