import type { App } from "obsidian";
import { searchDeepSeek } from "@/agentMode/backends/native/deepSeekWebSearch";
import { SecretStore } from "@/services/secretStore";
import { safeFetchNoThrow } from "@/utils";

jest.mock("@/services/secretStore");
jest.mock("@/utils");

describe("deepSeekWebSearch", () => {
  describe("searchDeepSeek()", () => {
    const app = {} as App;
    const key = "dummy-secret-for-test";
    let withSecret: jest.Mock;

    beforeEach(() => {
      jest.resetAllMocks();
      withSecret = jest.fn((_ref, use: (key: string) => Promise<unknown>) => use(key));
      jest
        .mocked(SecretStore.getInstance)
        .mockReturnValue({ withSecret } as unknown as SecretStore);
    });

    it("posts the query to the official Search API with the chosen account and preserves returned links", async () => {
      const results = [{ title: "Public source", url: "https://example.com/source" }];
      jest.mocked(safeFetchNoThrow).mockResolvedValue(new Response(JSON.stringify({ results })));
      const signal = new AbortController().signal;
      await expect(searchDeepSeek(app, "chosen-account", "Scribe 中文", signal)).resolves.toEqual({
        text: JSON.stringify({ results }),
      });
      expect(withSecret).toHaveBeenCalledWith("chosen-account", expect.any(Function));
      expect(safeFetchNoThrow).toHaveBeenCalledWith("https://api.deepseek.com/v1/tools/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "Scribe 中文" }),
        signal,
      });
    });

    it("reports an explicit HTTP failure without including the remote error body", async () => {
      jest.mocked(safeFetchNoThrow).mockResolvedValue(new Response(key, { status: 402 }));
      await expect(
        searchDeepSeek(app, "chosen-account", "Scribe", new AbortController().signal)
      ).resolves.toEqual({
        failure: "DeepSeek search failed (HTTP 402).",
      });
    });

    it("does not resolve credentials for an invalid query", async () => {
      await expect(
        searchDeepSeek(app, "chosen-account", "😀".repeat(129), new AbortController().signal)
      ).rejects.toThrow("128");
      expect(withSecret).not.toHaveBeenCalled();
    });

    it("redacts credentials from thrown transport errors https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      jest.mocked(safeFetchNoThrow).mockRejectedValue(new Error(`request failed with ${key}`));
      await expect(
        searchDeepSeek(app, "chosen-account", "Scribe", new AbortController().signal)
      ).rejects.toThrow("[redacted]");
    });
  });
});
