import { gitlabModelMappings } from "./gitlabModelMappings";

describe("gitlabModelMappings", () => {
  describe("gitlabModelMappings", () => {
    it("retains every model alias and inference protocol from the pinned official SDK table", async () => {
      const originalFetch = window.fetch;
      window.fetch = jest.fn(async () => {
        throw new Error("Unexpected network request");
      });
      try {
        const { MODEL_MAPPINGS } = await import("gitlab-ai-provider");
        expect(gitlabModelMappings).toEqual(MODEL_MAPPINGS);
      } finally {
        window.fetch = originalFetch;
      }
      expect(Object.keys(gitlabModelMappings)).toHaveLength(44);
    });
  });
});
