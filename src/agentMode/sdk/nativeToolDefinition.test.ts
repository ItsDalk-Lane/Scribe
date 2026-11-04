import { obj, str } from "@earendil-works/pi-schema";
import { defineNativeTool } from "@/agentMode/sdk/nativeToolDefinition";

describe("nativeToolDefinition", () => {
  describe("defineNativeTool()", () => {
    it("validates arguments and preserves the call, cancellation and progress callbacks", async () => {
      const result = {
        content: [{ type: "text" as const, text: "Actual note" }],
        details: undefined,
      };
      const execute = jest.fn(async () => result);
      const tool = defineNativeTool(
        "read_note",
        "Read note",
        "Read a note",
        obj({ path: str() }),
        execute
      );
      const controller = new AbortController();
      const onUpdate = jest.fn();
      expect(await tool.execute("call-one", { path: "note.md" }, controller.signal, onUpdate)).toBe(
        result
      );
      expect(execute).toHaveBeenCalledWith(
        "call-one",
        { path: "note.md" },
        controller.signal,
        onUpdate
      );
      // @ts-expect-error -- 故意向参数校验边界传入无效类型。
      await expect(tool.execute("invalid-call", { path: 1 })).rejects.toThrow("Invalid arguments");
      controller.abort();
      await expect(
        tool.execute("stopped-call", { path: "note.md" }, controller.signal)
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(execute).toHaveBeenCalledTimes(1);
    });
  });
});
