import { testProviderConnection } from "@/LLMProviders/testProviderConnection";
import { fixtureSse } from "@/LLMProviders/testing/piFixtures";
import type { Provider } from "@/modelManagement";
import * as obsidian from "obsidian";

jest.mock("@/logger");
const { __setRequestUrlImpl: setRequestUrlImpl } = obsidian as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};
const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/8";
const provider: Provider = {
  providerId: "fixture",
  providerType: "openai-compatible",
  displayName: "Fixture",
  baseUrl: "https://fixture.invalid/v1",
  requiresApiKey: true,
  enableCors: true,
  origin: { kind: "byok" },
  addedAt: 0,
};

describe("testProviderConnection integration", () => {
  describe("testProviderConnection()", () => {
    it.each([
      [401, "invalid_api_key"],
      [403, "permission_denied"],
      [429, "chat_error"],
    ])(
      `classifies HTTP %s through real pi-ai errors without retrying or exposing the key (${issue})`,
      async (status, code) => {
        const request = jest.fn(async () => ({
          status,
          json: { error: { message: "Rejected fixture-key" } },
          text: JSON.stringify({ error: { message: "Rejected fixture-key" } }),
          headers: { "content-type": "application/json" },
          arrayBuffer: new ArrayBuffer(0),
        }));
        setRequestUrlImpl(request);
        const result = await testProviderConnection({
          provider,
          model: { id: "private-model", displayName: "Private model" },
          apiKey: "fixture-key",
        });
        expect(result).toMatchObject({ ok: false, code });
        expect(result.message).toContain("[redacted]");
        expect(result.message).not.toContain("fixture-key");
        expect(request).toHaveBeenCalledTimes(1);
      }
    );

    it.each([
      ["OK", true, undefined],
      ["", false, "empty_response"],
    ] as const)(
      `requires actual nonempty text %s before verifying the chat (${issue})`,
      async (text, ok, code) => {
        setRequestUrlImpl(async () => ({
          status: 200,
          json: {},
          headers: { "content-type": "text/event-stream" },
          text: fixtureSse({
            choices: [{ index: 0, message: { content: text }, finish_reason: "stop" }],
          }),
          arrayBuffer: new ArrayBuffer(0),
        }));
        const result = await testProviderConnection({
          provider,
          model: { id: "private-model", displayName: "Private model" },
          apiKey: "fixture-key",
        });
        expect(result.ok).toBe(ok);
        expect(result.code).toBe(code);
      }
    );
  });
});
