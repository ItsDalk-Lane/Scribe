import { arr, obj, str } from "@earendil-works/pi-schema";
import { defineNativeTool, getNativeToolPolicy } from "@/agentMode/sdk/nativeToolDefinition";

describe("nativeToolDefinition", () => {
  describe("defineNativeTool()", () => {
    it("keeps policy-free tools conservative rather than implicitly exempting them from approval https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
      const tool = defineNativeTool(
        "extension",
        "Extension",
        "Unknown action",
        obj({}),
        async () => ({ content: [], details: undefined })
      );
      expect(tool.executionMode).toBe("sequential");
      expect(getNativeToolPolicy(tool)).toBeUndefined();
    });

    it.each(["read", "search", "fetch"] as const)(
      "lets a managed %s tool use Pi parallel execution by default https://github.com/ItsDalk-Lane/Scribe/issues/70",
      (kind) => {
        const tool = defineNativeTool(
          "inspect",
          "Inspect",
          "Inspect current data",
          obj({}),
          async () => ({ content: [], details: undefined }),
          { kind }
        );
        expect(tool.executionMode).toBe("parallel");
      }
    );

    it.each(["edit", "execute", "think", "switch_mode"] as const)(
      "keeps a managed %s tool sequential unless the definition explicitly overrides it https://github.com/ItsDalk-Lane/Scribe/issues/70",
      (kind) => {
        const tool = defineNativeTool(
          "operate",
          "Operate",
          "Perform an operation",
          obj({}),
          async () => ({ content: [], details: undefined }),
          { kind }
        );
        expect(tool.executionMode).toBe("sequential");
        const sequentialRead = defineNativeTool(
          "inspect",
          "Inspect",
          "Inspect",
          obj({}),
          async () => ({ content: [], details: undefined }),
          { kind: "read", executionMode: "sequential" }
        );
        expect(sequentialRead.executionMode).toBe("sequential");
      }
    );

    it("reports the failing nested field without copying raw arguments into the validation error https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      const execute = jest.fn(async () => ({ content: [], details: undefined }));
      const tool = defineNativeTool(
        "edit",
        "Edit",
        "Edit",
        obj({ edits: arr(obj({ oldText: str({ minLength: 1 }) })) }),
        execute
      );
      await expect(tool.execute("invalid", { edits: [{ oldText: "" }] })).rejects.toThrow(
        "/edits/0/oldText: expected at least 1 characters"
      );
      expect(execute).not.toHaveBeenCalled();
    });

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

  describe("getNativeToolPolicy()", () => {
    it("retains its private policy through runtime object spreads without exposing it in model JSON https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
      const tool = defineNativeTool(
        "read",
        "Read",
        "Read",
        obj({}),
        async () => ({ content: [], details: undefined }),
        { kind: "read", skillAuthoring: true }
      );
      expect(getNativeToolPolicy(tool)).toEqual({ kind: "read", skillAuthoring: true });
      expect(getNativeToolPolicy({ ...tool })).toBe(getNativeToolPolicy(tool));
      expect(JSON.stringify(tool)).not.toContain("skillAuthoring");
      expect(Object.isFrozen(getNativeToolPolicy(tool))).toBe(true);
    });
  });
});
