import type { CustomModel } from "@/aiParams";
import { withModelCredentials } from "@/LLMProviders/modelCredentials";

const mockWithSecret = jest.fn<Promise<unknown>, [string, (value: string) => Promise<unknown>]>();
jest.mock("@/services/secretStore", () => ({
  SecretStore: { getInstance: () => ({ withSecret: mockWithSecret }) },
}));
const model: CustomModel = { name: "Example", provider: "openai", enabled: true };

describe("modelCredentials", () => {
  describe("withModelCredentials()", () => {
    beforeEach(() => mockWithSecret.mockReset());
    it("passes a keyless model directly to its request operation", async () => {
      const use = jest.fn(async (value: CustomModel) => value.name);
      expect(await withModelCredentials(model, use)).toBe("Example");
      expect(use).toHaveBeenCalledWith(model);
      expect(mockWithSecret).not.toHaveBeenCalled();
    });
    it("uses a newly entered credential directly without reading a saved key", async () => {
      const draft = { ...model, apiKey: "newly-entered", credentialRef: "previous-reference" };
      expect(await withModelCredentials(draft, async (value) => value.apiKey)).toBe(
        "newly-entered"
      );
      expect(mockWithSecret).not.toHaveBeenCalled();
    });
    it("masks saved JSON secrets when authentication fails before a Pi request can be returned", async () => {
      mockWithSecret.mockImplementation(async (_id, execute) =>
        execute(JSON.stringify({ private_key: "private-pem-value" }))
      );
      await expect(
        withModelCredentials({ ...model, credentialRef: "saved" }, async () => {
          throw new Error("Rejected private-pem-value");
        })
      ).rejects.toThrow("Rejected [redacted]");
    });
    it("resolves the selected reference into a request copy without modifying the reusable model", async () => {
      mockWithSecret.mockImplementation(async (_id, execute) => execute("request-only-key"));
      const saved = { ...model, credentialRef: "chosen-reference" };
      expect(await withModelCredentials(saved, async (value) => value.apiKey)).toBe(
        "request-only-key"
      );
      expect(saved).toEqual({ ...model, credentialRef: "chosen-reference" });
      expect(mockWithSecret).toHaveBeenCalledWith("chosen-reference", expect.any(Function));
    });
  });
});
