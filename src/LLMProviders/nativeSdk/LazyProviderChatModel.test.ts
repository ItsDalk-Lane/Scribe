import { LazyProviderChatModel } from "./LazyProviderChatModel";
import { FakeListChatModel } from "@langchain/core/utils/testing";

describe("LazyProviderChatModel", () => {
  describe("LazyProviderChatModel", () => {
    describe("_llmType()", () => {
      it("identifies a provider that obtains current credentials before use", () => {
        expect(
          new LazyProviderChatModel(
            async () => new FakeListChatModel({ responses: ["Reply"] })
          )._llmType()
        ).toBe("authenticated-provider");
      });
    });
    describe("_generate()", () => {
      it("resolves fresh credentials for each request and returns the child reply", async () => {
        const child = new FakeListChatModel({ responses: ["First reply", "Second reply"] });
        const resolve = jest.fn(async () => child);
        const model = new LazyProviderChatModel(resolve);
        expect((await model.invoke("First original input")).content).toBe("First reply");
        expect((await model.invoke("Second original input")).content).toBe("Second reply");
        expect(resolve).toHaveBeenCalledTimes(2);
      });
      it("surfaces authentication errors without invoking the child model", async () => {
        const resolve = jest.fn(async () => {
          throw Object.assign(new Error("Access denied"), { status: 401 });
        });
        await expect(new LazyProviderChatModel(resolve).invoke("Input")).rejects.toThrow(
          "Access denied"
        );
        expect(resolve).toHaveBeenCalledTimes(1);
      });
    });
    describe("_streamResponseChunks()", () => {
      it("forwards the entire child stream after resolving credentials", async () => {
        const model = new LazyProviderChatModel(
          async () => new FakeListChatModel({ responses: ["Stream reply"] })
        );
        const chunks = [];
        for await (const chunk of await model.stream("Original input"))
          chunks.push(typeof chunk.content === "string" ? chunk.content : "");
        expect(chunks.join("")).toBe("Stream reply");
      });
    });
  });
});
