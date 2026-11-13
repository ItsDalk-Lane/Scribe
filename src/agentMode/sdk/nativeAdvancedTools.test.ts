import { access, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimateTextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { App, FileSystemAdapter } from "obsidian";
import { getExcalidrawApi } from "@/excalidraw/excalidrawApi";
import { getNativeToolPolicy } from "@/agentMode/sdk/nativeToolDefinition";
import type { ExcalidrawApi } from "@/excalidraw/excalidrawTools";
import {
  createNativeAdvancedTools,
  type NativeAdvancedToolsOptions,
} from "@/agentMode/sdk/nativeAdvancedTools";
import { WebSearchOutcomeUnknown } from "@/agentMode/sdk/webSearchRouter";
import type { ScribeMode, PermissionDecision, SessionUpdate } from "@/agentMode/session/types";

jest.mock("@/excalidraw/excalidrawApi");
jest.mock("@/logger");

describe("nativeAdvancedTools", () => {
  describe("createNativeAdvancedTools()", () => {
    let root: string;
    let outside: string;
    let options: NativeAdvancedToolsOptions;
    let updates: SessionUpdate[];
    let api: ExcalidrawApi;
    let mode: ScribeMode;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "scribe-native-advanced-"));
      outside = await mkdtemp(join(tmpdir(), "scribe-native-outside-"));
      await writeFile(join(root, "drawing.excalidraw.md"), "old drawing");
      const adapter = new FileSystemAdapter();
      adapter.getBasePath = () => root;
      adapter.read = (path: string) => readFile(join(root, path), "utf8");
      adapter.exists = async (path: string) => {
        try {
          await access(join(root, path));
          return true;
        } catch {
          return false;
        }
      };
      api = {
        sceneElements: jest.fn(async () => [
          { id: "box-one", type: "rectangle", x: 0, y: 0, width: 100, height: 60 },
        ]),
        renderPng: jest.fn(async () => "AQID"),
        execute: jest.fn(async (request) => {
          if (request.command === "create" || request.command === "apply")
            await writeFile(join(root, String(request.path)), "new drawing");
          return {
            ok: true,
            data: {
              revision: 1,
              idMap: {},
              elements: [{ id: "box-one", type: "rectangle", x: 0, y: 0, width: 100, height: 60 }],
              nextOffset: null,
            },
          };
        }),
        connectLabelled: jest.fn(async () => ({ arrowId: "arrow", labelId: null })),
      };
      jest.mocked(getExcalidrawApi).mockReturnValue(api);
      updates = [];
      mode = "default";
      options = {
        app: { vault: { adapter } } as unknown as App,
        cwd: root,
        sessionId: "native-one",
        requester: "main",
        observedFileVersions: new Map(),
        getMode: () => mode,
        emit: (update) => updates.push(update),
        requestPermission: jest.fn(
          async (): Promise<PermissionDecision> => ({
            outcome: { outcome: "selected", optionId: "allow_once" },
          })
        ),
        askUser: jest.fn(async () => ({})),
        onPlanApproved: jest.fn(),
        skills: () => [
          {
            name: "note-format",
            description: "Format notes",
            body: "Keep frontmatter and use headings.",
            status: "available" as const,
          },
        ],
        fetch: jest.fn(
          async () =>
            new Response(
              '<main><h1>Marker</h1><a href="/source">Source</a><script>hidden</script></main>',
              { headers: { "content-type": "text/html" } }
            )
        ),
      };
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    });

    function execute(name: string, args: unknown, id = name, signal?: AbortSignal) {
      const tool = createNativeAdvancedTools(options).find((entry) => entry.name === name);
      if (!tool) throw new Error(`Missing tool ${name}`);
      return tool.execute(id, args, signal);
    }

    it("绘图读取采用实时分页版本，旧版本修改被拒绝 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      let revision = "live-A";
      api.execute = jest.fn(async (request) =>
        request.command === "read"
          ? {
              ok: true,
              data: {
                revision,
                elements: [{ id: "live-box", type: "rectangle", x: 0, y: 0, width: 5, height: 5 }],
                total: 1,
                nextOffset: null,
              },
            }
          : { ok: true, data: { revision } }
      );
      const read = await execute("excalidraw_read", { path: "drawing.excalidraw.md" });
      expect(JSON.stringify(read.content)).toContain("live-box");
      expect(api.sceneElements).not.toHaveBeenCalled();
      revision = "live-B";
      const result = await execute("excalidraw_write", {
        path: "drawing.excalidraw.md",
        operations: [{ op: "update", id: "live-box", set: { x: 10 } }],
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toMatch(/changed|read/i);
      expect(
        jest.mocked(api.execute).mock.calls.some(([request]) => request.command === "apply")
      ).toBe(false);
    });

    it("打开绘图期间撤销编辑权限会阻止后续真实修改 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      await execute("excalidraw_read", { path: "drawing.excalidraw.md" });
      const original = api.execute;
      api.execute = jest.fn(async (request) => {
        if (request.command === "open") mode = "plan";
        return original(request);
      });
      const result = await execute("excalidraw_write", {
        path: "drawing.excalidraw.md",
        operations: [{ op: "update", id: "box-one", set: { x: 10 } }],
      });
      expect(result.isError).toBe(true);
      expect(
        jest.mocked(api.execute).mock.calls.some(([request]) => request.command === "apply")
      ).toBe(false);
      expect(await readFile(join(root, "drawing.excalidraw.md"), "utf8")).toBe("old drawing");
    });

    it("hands a successful drawing read to the delivery owner without authorizing an early edit https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      options.observeFileVersion = jest.fn();
      const read = await execute(
        "excalidraw_read",
        { path: "drawing.excalidraw.md" },
        "pending-drawing"
      );
      expect(read.isError).toBe(false);
      expect(options.observeFileVersion).toHaveBeenCalledWith(
        read,
        "drawing.excalidraw.md",
        expect.objectContaining({ kind: "drawing", revision: expect.anything() })
      );
      const result = await execute("excalidraw_write", {
        path: "drawing.excalidraw.md",
        operations: [{ op: "update", id: "box-one", set: { x: 10 } }],
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toMatch(/read the current drawing/i);
    });

    it("实时绘图分页固定版本，模型已读版本用于本次修改 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      api.execute = jest.fn(async (request) => {
        if (request.command === "read")
          return {
            ok: true,
            data: {
              revision: "A",
              elements: [
                {
                  id: request.offset ? "second" : "first",
                  type: "rectangle",
                  x: 0,
                  y: 0,
                  width: 5,
                  height: 5,
                },
              ],
              nextOffset: request.detail === "elements" && !request.offset ? 1 : null,
            },
          };
        return { ok: true, revision: "B", data: { acceptedRevision: "B" } };
      });
      const read = await execute("excalidraw_read", { path: "drawing.excalidraw.md" });
      expect(JSON.stringify(read.content)).toContain("second");
      expect(api.execute).toHaveBeenCalledWith(
        expect.objectContaining({ command: "read", offset: 1, revision: "A" })
      );
      const result = await execute("excalidraw_write", {
        path: "drawing.excalidraw.md",
        operations: [{ op: "update", id: "first", set: { x: 20 } }],
      });
      expect(result.isError).toBe(false);
      expect(api.execute).toHaveBeenCalledWith(
        expect.objectContaining({ command: "apply", expectedRevision: "A" })
      );
      expect(options.observedFileVersions!.has("drawing.excalidraw.md")).toBe(false);
    });

    it("缺失实时版本拒绝读取，连接后没有提交凭据则报告已保存部分并停止继续连接 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      const original = api.execute;
      api.execute = jest.fn(async () => ({ ok: true, data: { elements: [] } }));
      expect((await execute("excalidraw_read", { path: "drawing.excalidraw.md" })).isError).toBe(
        true
      );
      api.execute = original;
      await execute("excalidraw_read", { path: "drawing.excalidraw.md" });
      const result = await execute("excalidraw_write", {
        path: "drawing.excalidraw.md",
        operations: [
          { op: "connect", from: "box-one", to: "box-two", label: "first" },
          { op: "connect", from: "box-two", to: "box-three", label: "second" },
        ],
      });
      expect(result.isError).toBe(true);
      expect(api.connectLabelled).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result.content)).toMatch(/Saved:.*first|Saved:.*Connected/);
      expect(JSON.stringify(result.content)).toContain("Don't redo the saved changes");
    });

    it("绘图已确认修改后撤权保留部分完成事实，已派发异常不能当作未开始 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      await execute("excalidraw_read", { path: "drawing.excalidraw.md" });
      const original = api.execute;
      api.execute = jest.fn(async (request) => {
        const reply = await original(request);
        if (request.command === "apply") mode = "plan";
        return reply;
      });
      const partial = await execute("excalidraw_write", {
        path: "drawing.excalidraw.md",
        operations: [
          { op: "update", id: "box-one", set: { x: 10 } },
          { op: "connect", from: "box-one", to: "box-two", label: "later" },
        ],
      });
      expect(partial.isError).toBe(true);
      expect(partial.details).toMatchObject({
        confirmedOperations: ["apply"],
        execution: { status: "partial", retry: "verify_before_retry", complete: false },
      });
      mode = "default";
      api.execute = original;
      await execute("excalidraw_read", { path: "drawing.excalidraw.md" });
      api.execute = jest.fn(async (request) => {
        if (request.command === "apply") throw new Error("connection lost after dispatch");
        return original(request);
      });
      const unknown = await execute("excalidraw_write", {
        path: "drawing.excalidraw.md",
        operations: [{ op: "update", id: "box-one", set: { x: 20 } }],
      });
      expect(unknown.details).toMatchObject({
        execution: { status: "outcome_unknown", retry: "verify_before_retry" },
      });
    });

    it("取消到达已确认apply之后仍返回已保存事实而不重放 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      await execute("excalidraw_read", { path: "drawing.excalidraw.md" });
      const original = api.execute;
      const controller = new AbortController();
      api.execute = jest.fn(async (request) => {
        const reply = await original(request);
        if (request.command === "apply") controller.abort();
        return reply;
      });
      const result = await execute(
        "excalidraw_write",
        {
          path: "drawing.excalidraw.md",
          operations: [{ op: "update", id: "box-one", set: { x: 10 } }],
        },
        "cancelled-after-apply",
        controller.signal
      );
      expect(result.isError).toBe(true);
      expect(result.details).toMatchObject({
        confirmedOperations: ["apply"],
        execution: { status: "partial", complete: false },
      });
      expect(await readFile(join(root, "drawing.excalidraw.md"), "utf8")).toBe("new drawing");
    });

    it("小上下文技能以原生游标分页，显式小页不改变版本和停用校验 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      options.catalogBudget = { contextWindow: 10000 };
      let status: "available" | "disabled" = "available";
      options.skills = () => [
        { name: "long", description: "long", body: "a".repeat(19000), status },
        { name: "other", description: "other", body: "other", status: "available" },
      ];
      const first = await execute("invoke_skill", { name: "long" });
      expect(first.details).toMatchObject({ truncated: true, nextCursor: expect.any(String) });
      const small = await execute("invoke_skill", { name: "long", max_characters: 100 });
      const continued = await execute("invoke_skill", {
        name: "long",
        max_characters: 100,
        cursor: (small.details as { nextCursor: string }).nextCursor,
      });
      expect(continued.details).toMatchObject({ truncated: true });
      status = "disabled";
      await expect(
        execute("invoke_skill", {
          name: "long",
          max_characters: 100,
          cursor: (continued.details as { nextCursor: string }).nextCursor,
        })
      ).rejects.toThrow(/disabled/i);
    });

    it("原有技能创作白名单和工具模式含义保持一致 https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
      options.reviewSkillDraft = async () => null;
      const tools = createNativeAdvancedTools(options);
      for (const name of ["fetch_url", "web_search"])
        expect(getNativeToolPolicy(tools.find((tool) => tool.name === name)!)).toMatchObject({
          kind: "fetch",
          skillAuthoring: false,
        });
      expect(
        getNativeToolPolicy(tools.find((tool) => tool.name === "propose_skill")!)
      ).toMatchObject({ kind: "think", skillAuthoring: true });
      expect(
        getNativeToolPolicy(tools.find((tool) => tool.name === "invoke_skill")!)
      ).toMatchObject({ kind: "read", skillAuthoring: true });
    });

    it("reads a manually restricted skill only within an explicit transferred run scope and still refuses a disabled skill (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
      let status: "manual-only" | "disabled" = "manual-only";
      options.skills = () => [
        { name: "visible", description: "Visible", body: "Visible", status: "available" },
        { name: "manual", description: "Manual", body: "Only this delegated task", status },
      ];
      options.transferredSkills = ["manual"];
      expect(JSON.stringify((await execute("invoke_skill", { name: "manual" })).content)).toContain(
        "Only this delegated task"
      );
      options.transferredSkills = [];
      await expect(execute("invoke_skill", { name: "manual" })).rejects.toThrow(
        "does not allow model invocation"
      );
      options.transferredSkills = ["manual"];
      status = "disabled";
      await expect(execute("invoke_skill", { name: "manual" })).rejects.toThrow("disabled");
    });

    it("reads supporting files for a transferred manual-only skill when no catalog was published (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
      options.skills = () => [
        { name: "manual", description: "Manual", body: "Instructions", status: "manual-only" },
      ];
      options.transferredSkills = ["manual"];
      options.readSkillFile = jest.fn(async () => "support content");
      const result = await execute("invoke_skill", { name: "manual", file: "guide.md" });
      expect(JSON.stringify(result.content)).toContain("support content");
      expect(options.readSkillFile).toHaveBeenCalledWith("manual", "guide.md", undefined);
    });

    it("loads only an explicitly registered skill without a network request", async () => {
      expect((await execute("invoke_skill", { name: "note-format" })).content).toEqual([
        { type: "text", text: "Keep frontmatter and use headings." },
      ]);
      await expect(execute("invoke_skill", { name: "unregistered" })).rejects.toThrow(
        "not registered"
      );
      expect(options.fetch).not.toHaveBeenCalled();
    });

    it("rejects skill instructions disabled while dependency checks were pending https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      const previous = options.skills;
      options.resolveSkillDependencies = async () => {
        options.skills = () => previous().map((skill) => ({ ...skill, status: "disabled" }));
        return [];
      };
      options.onSkillInvoked = jest.fn();
      await expect(execute("invoke_skill", { name: "note-format" })).rejects.toThrow(/disabled/i);
      expect(options.onSkillInvoked).not.toHaveBeenCalled();
    });

    it("rejects a supporting file read cancelled before delivery https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      const controller = new AbortController();
      options.readSkillFile = async () => {
        controller.abort();
        return "Not delivered";
      };
      await expect(
        execute(
          "invoke_skill",
          { name: "note-format", file: "guide.md" },
          "skill",
          controller.signal
        )
      ).rejects.toThrow(/abort/i);
    });

    it("rejects skill pages too small to advance past a whole emoji https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      options.skills = () => [
        { name: "emoji", description: "Emoji", body: "😀A", status: "available" },
      ];
      await expect(execute("invoke_skill", { name: "emoji", max_characters: 1 })).rejects.toThrow(
        /increase the page size/i
      );
      const first = await execute("invoke_skill", { name: "emoji", max_characters: 2 });
      const cursor = (first.details as { nextCursor: string }).nextCursor;
      expect(cursor).toMatch(/^2:/);
      const next = await execute("invoke_skill", { name: "emoji", max_characters: 1, cursor });
      expect(next.content).toEqual([{ type: "text", text: "A" }]);
    });

    it("shows the full proposed draft to the review callback and returns only the confirmed saved name", async () => {
      const draft = {
        name: "note-review",
        description: "Review notes",
        body: "Check every claim.",
      };
      const review = jest.fn(async () => ({ name: "reviewed-name" }));
      Object.assign(options, { reviewSkillDraft: review });
      const controller = new AbortController();
      const result = await execute("propose_skill", draft, "proposal-one", controller.signal);
      expect(review).toHaveBeenCalledWith(draft, controller.signal);
      expect(result.details).toEqual({ name: "reviewed-name", saved: true });
      expect(options.requestPermission).not.toHaveBeenCalled();
    });

    it("does not open draft review when the calling operation has already stopped", async () => {
      const review = jest.fn(async () => ({ name: "review" }));
      Object.assign(options, { reviewSkillDraft: review });
      const controller = new AbortController();
      controller.abort();
      await expect(
        execute(
          "propose_skill",
          { name: "review", description: "Review notes", body: "Read each note." },
          "stopped",
          controller.signal
        )
      ).rejects.toThrow();
      expect(review).not.toHaveBeenCalled();
    });

    it("reports a review failure without returning a successful save result", async () => {
      Object.assign(options, {
        reviewSkillDraft: jest.fn(async () => {
          throw new Error("Review unavailable");
        }),
      });
      await expect(
        execute("propose_skill", {
          name: "review",
          description: "Review notes",
          body: "Read each note.",
        })
      ).rejects.toThrow("Review unavailable");
    });

    it("returns cancellation without claiming a skill was saved", async () => {
      Object.assign(options, { reviewSkillDraft: jest.fn(async () => null) });
      const result = await execute("propose_skill", {
        name: "review",
        description: "Review notes",
        body: "Read the note.",
      });
      expect(result.details).toEqual({ saved: false });
    });

    it("includes the registered skill catalog and support-file directory in skill invocation", async () => {
      options.skills = () => [
        {
          name: "note-format",
          description: "Format notes",
          body: "Read references.",
          dirPath: root,
          status: "available" as const,
        },
      ];
      const tool = createNativeAdvancedTools(options).find(
        (entry) => entry.name === "invoke_skill"
      )!;
      expect(tool.description).toContain("note-format: Format notes");
      const result = await tool.execute("with-directory", { name: "note-format" });
      expect(result.content).toContainEqual({ type: "text", text: expect.stringContaining(root) });
      expect(result.details).toMatchObject({ name: "note-format", directory: root });
    });

    // 目录预算与生命周期 https://github.com/ItsDalk-Lane/Scribe/issues/40
    // https://github.com/ItsDalk-Lane/Scribe/issues/42
    it("prunes the catalog to the configured budget and reports the omitted skill names", () => {
      options.skills = () => [
        { name: "aaa", description: "a".repeat(400), body: "", status: "available" as const },
        { name: "bbb", description: "b".repeat(400), body: "", status: "available" as const },
        { name: "ccc", description: "Use tables", body: "", status: "available" as const },
      ];
      options.catalogBudget = { contextWindow: 0, percent: 2, maxTokens: 600 };
      const built = jest.fn();
      options.onCatalogBuilt = built;
      const tool = createNativeAdvancedTools(options).find(
        (entry) => entry.name === "invoke_skill"
      )!;
      expect(tool.description).not.toContain("a".repeat(50));
      expect(built).toHaveBeenCalledWith({
        mode: "pruned",
        includedNames: ["ccc"],
        omittedNames: ["aaa", "bbb"],
      });
    });

    it("does not register the skill tool when no skill is available and no catalog was ever published", () => {
      options.skills = () => [
        {
          name: "note-format",
          description: "Format notes",
          body: "Keep frontmatter and use headings.",
          status: "disabled" as const,
        },
      ];
      options.skillCatalogLifecycle = { everPublished: () => false, markPublished: jest.fn() };
      expect(
        createNativeAdvancedTools(options).some((entry) => entry.name === "invoke_skill")
      ).toBe(false);
    });

    it("publishes an empty catalog with do-not-guess discipline after a catalog was published before", () => {
      options.skills = () => [];
      options.skillCatalogLifecycle = { everPublished: () => true, markPublished: jest.fn() };
      const tool = createNativeAdvancedTools(options).find(
        (entry) => entry.name === "invoke_skill"
      )!;
      expect(tool.description).toContain("No skills are currently available");
      expect(tool.description).toContain("never call names remembered from earlier lists");
    });

    it("applies the configured limit to the replacement empty catalog https://github.com/ItsDalk-Lane/Scribe/issues/40", () => {
      options.skills = () => [];
      options.catalogBudget = { contextWindow: 0, percent: 2, maxTokens: 1 };
      options.skillCatalogLifecycle = { everPublished: () => true, markPublished: jest.fn() };
      const tool = createNativeAdvancedTools(options).find(
        (entry) => entry.name === "invoke_skill"
      )!;
      expect(estimateTextTokens(tool.description)).toBeLessThanOrEqual(1);
    });

    it("marks the catalog lifecycle as published once a non-empty catalog is built", () => {
      const markPublished = jest.fn();
      options.skillCatalogLifecycle = { everPublished: () => false, markPublished };
      createNativeAdvancedTools(options);
      expect(markPublished).toHaveBeenCalledTimes(1);
    });

    // 投递纪律与兜底列举 https://github.com/ItsDalk-Lane/Scribe/issues/41
    // https://github.com/ItsDalk-Lane/Scribe/issues/42
    it("lists every registered skill with its invocation status when called with no arguments", async () => {
      options.skills = () => [
        { name: "usable", description: "Ready", body: "b1", status: "available" as const },
        { name: "off", description: "Off", body: "b2", status: "disabled" as const },
        {
          name: "manual",
          description: "Manual only",
          body: "b3",
          status: "manual-only" as const,
        },
      ];
      const result = await execute("invoke_skill", {});
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringMatching(
          /- usable \(available\): Ready[\s\S]*- off \(disabled\): Off[\s\S]*- manual \(manual-only\): Manual only/
        ),
      });
      expect(result.details).toEqual({ listed: 3, truncated: false });
    });

    it("returns distinct redirecting errors for unknown, disabled and manual-only skills", async () => {
      options.skills = () => [
        {
          name: "off",
          description: "Off",
          body: "",
          status: "disabled" as const,
        },
        {
          name: "manual",
          description: "Manual",
          body: "",
          status: "manual-only" as const,
        },
      ];
      options.skillCatalogLifecycle = {
        everPublished: () => true,
        markPublished: jest.fn(),
      };
      await expect(execute("invoke_skill", { name: "ghost" })).rejects.toThrow(
        "Call invoke_skill with no arguments to list every registered skill"
      );
      await expect(execute("invoke_skill", { name: "off" })).rejects.toThrow(
        "disabled for this agent"
      );
      await expect(execute("invoke_skill", { name: "manual" })).rejects.toThrow(
        "does not allow model invocation"
      );
    });

    it("reads a supporting file through the anchored reader only", async () => {
      options.readSkillFile = jest.fn(async () => "reference body");
      const result = await execute("invoke_skill", { name: "note-format", file: "refs/a.md" });
      expect(options.readSkillFile).toHaveBeenCalledWith("note-format", "refs/a.md", undefined);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("reference body"),
      });
      expect(result.details).toMatchObject({ name: "note-format", file: "refs/a.md" });
    });

    it("rejects supporting-file reads when no anchored reader is available", async () => {
      await expect(
        execute("invoke_skill", { name: "note-format", file: "refs/a.md" })
      ).rejects.toThrow("support-file reading is unavailable");
    });

    it("continues long skill bodies without splitting emoji and rejects changed content (https://github.com/ItsDalk-Lane/Scribe/issues/68)", async () => {
      let body = "a".repeat(19999) + "😀end";
      options.skills = () => [{ name: "big", description: "Big", body, status: "available" }];
      const first = await execute("invoke_skill", { name: "big" });
      const cursor = (first.details as { nextCursor: string }).nextCursor;
      expect(cursor).toBeTruthy();
      const second = await execute("invoke_skill", { name: "big", cursor });
      expect((second.content[0] as { text: string }).text).toContain("😀end");
      body += "changed";
      await expect(execute("invoke_skill", { name: "big", cursor })).rejects.toThrow("changed");
    });

    it("continues a long supporting file and rejects a cursor from another resource (https://github.com/ItsDalk-Lane/Scribe/issues/68)", async () => {
      options.readSkillFile = async () => "x".repeat(20000) + "file end";
      const first = await execute("invoke_skill", { name: "note-format", file: "a.md" });
      const cursor = (first.details as { nextCursor: string }).nextCursor;
      const second = await execute("invoke_skill", { name: "note-format", file: "a.md", cursor });
      expect((second.content[0] as { text: string }).text).toContain("file end");
      await expect(
        execute("invoke_skill", { name: "note-format", file: "b.md", cursor })
      ).rejects.toThrow("cursor");
    });

    it("continues a long registered skill list (https://github.com/ItsDalk-Lane/Scribe/issues/68)", async () => {
      options.skills = () =>
        Array.from({ length: 400 }, (_, i) => ({
          name: `skill-${i}`,
          description: "d".repeat(80),
          body: "body",
          status: "available" as const,
        }));
      const first = await execute("invoke_skill", {});
      const cursor = (first.details as { nextCursor: string }).nextCursor;
      const second = await execute("invoke_skill", { cursor });
      const finalCursor = (second.details as { nextCursor: string }).nextCursor;
      const last = await execute("invoke_skill", { cursor: finalCursor });
      expect((last.content[0] as { text: string }).text).toContain("skill-399");
    });

    it("truncates an oversized skill body with a clear marker", async () => {
      options.skills = () => [
        {
          name: "big",
          description: "Big",
          body: "x".repeat(20001),
          status: "available" as const,
        },
      ];
      const result = await execute("invoke_skill", { name: "big" });
      const text = (result.content[0] as { type: string; text: string }).text;
      expect(text).toContain("[Output truncated]");
      expect(text).toContain("Continue with cursor:");
      expect(text.length).toBeLessThan(20001 + 150);
      expect(result.details).toMatchObject({ truncated: true });
    });

    // 内容级就绪注入：正文前置本机实际依赖状态。https://github.com/ItsDalk-Lane/Scribe/issues/46
    it("prepends resolved dependency readiness to the delivered skill body", async () => {
      options.resolveSkillDependencies = async () => [
        { type: "command", name: "ffmpeg", ready: true, detail: "/opt/homebrew/bin/ffmpeg" },
        {
          type: "python-package",
          name: "pandas",
          ready: false,
          detail: "python package not found",
        },
      ];
      const result = await execute("invoke_skill", { name: "note-format" });
      const text = (result.content[0] as { type: string; text: string }).text;
      expect(text).toContain("Skill dependencies on this computer:");
      expect(text).toContain("ffmpeg (command): ready — /opt/homebrew/bin/ffmpeg");
      expect(text).toContain(
        "pandas (python-package): not available on this computer — python package not found"
      );
      expect(text).toContain("Keep frontmatter and use headings.");
    });

    // 模型侧技能投递计入本地使用台账。https://github.com/ItsDalk-Lane/Scribe/issues/48
    it("reports each delivered skill body to the usage callback", async () => {
      const invoked = jest.fn();
      options.onSkillInvoked = invoked;
      await execute("invoke_skill", { name: "note-format" });
      await execute("invoke_skill", {});
      await execute("invoke_skill", { name: "unregistered" }).catch(() => undefined);
      expect(invoked).toHaveBeenCalledTimes(1);
      expect(invoked).toHaveBeenCalledWith("note-format");
    });

    it("does not advertise a feedback tool https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      expect(createNativeAdvancedTools(options).map((tool) => tool.name)).not.toContain(
        "send_feedback"
      );
    });

    it("rereads registered skills on each invocation instead of retaining a previous project's body", async () => {
      const tools = createNativeAdvancedTools(options);
      const invoke = tools.find((tool) => tool.name === "invoke_skill");
      if (!invoke) throw new Error("Expected skill tool");
      await invoke.execute("first", { name: "note-format" });
      options.skills = () => [];
      await expect(invoke.execute("second", { name: "note-format" })).rejects.toThrow(
        "not registered"
      );
    });

    it("fetches real response content with GET, retains source links and reports truncation", async () => {
      const reply = await execute("fetch_url", {
        url: "https://example.invalid/page",
        max_characters: 15,
      });
      expect(options.fetch).toHaveBeenCalledWith(
        "https://example.invalid/page",
        expect.objectContaining({ method: "GET" })
      );
      expect(reply.content[0]).toMatchObject({ text: expect.stringContaining("# Marker") });
      expect(reply.details).toMatchObject({ url: "https://example.invalid/page", truncated: true });
      const complete = await execute("fetch_url", { url: "https://example.invalid/page" });
      expect(complete.content[0]).toMatchObject({
        text: expect.stringContaining("https://example.invalid/source"),
      });
      expect(complete.content[0]).not.toMatchObject({ text: expect.stringContaining("hidden") });
    });

    it("网页显式长度上限可续读完整原文，改变后的网页拒绝旧游标 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      let body = "abcdefghijkl";
      options.fetch = jest.fn(
        async () => new Response(body, { headers: { "content-type": "text/plain" } })
      );
      const first = await execute("fetch_url", {
        url: "https://example.invalid/page",
        max_characters: 4,
      });
      expect(first.details).toMatchObject({ truncated: true, nextCursor: expect.any(String) });
      const next = await execute("fetch_url", {
        url: "https://example.invalid/page",
        max_characters: 20,
        cursor: (first.details as { nextCursor: string }).nextCursor,
      });
      expect(next.content[0]).toMatchObject({ text: "efghijkl" });
      body = "changed";
      await expect(
        execute("fetch_url", {
          url: "https://example.invalid/page",
          max_characters: 4,
          cursor: (first.details as { nextCursor: string }).nextCursor,
        })
      ).rejects.toThrow(/changed/i);
      const full = await execute("fetch_url", { url: "https://example.invalid/page" });
      expect(full.content[0]).toMatchObject({ text: "changed" });
      body = "z".repeat(25000);
      const canonical = await execute("fetch_url", { url: "https://example.invalid/page" });
      expect(canonical.content[0]).toMatchObject({ text: body });
      expect(canonical.details).toMatchObject({ complete: true, truncated: false });
    });

    it("executes an encoded search against the configured engine and refuses unsupported URLs", async () => {
      options.searchUrlTemplate = "https://search.invalid/?q={query}";
      await execute("web_search", { query: "Obsidian & drawings" });
      expect(options.fetch).toHaveBeenCalledWith(
        "https://search.invalid/?q=Obsidian%20%26%20drawings",
        expect.objectContaining({ method: "GET" })
      );
      await expect(execute("fetch_url", { url: "file:///private/note.md" })).rejects.toThrow(
        "HTTP"
      );
    });

    it("uses the selected DeepSeek search in an open chat and continues without charging for another request", async () => {
      const query = "Obsidian & drawings";
      const content = JSON.stringify({
        results: [{ title: "Drawings", url: "https://example.com" }],
      });
      const search = jest.fn(async () => ({ text: content }));
      let selected = false;
      options.getWebSearchRoutes = () => ({
        preferred: "builtin",
        routes: selected ? { builtin: search } : {},
      });
      const tool = createNativeAdvancedTools(options).find((entry) => entry.name === "web_search")!;

      await tool.execute("duck", { query });
      expect(options.fetch).toHaveBeenCalledWith(
        "https://html.duckduckgo.com/html/?q=Obsidian%20%26%20drawings",
        expect.objectContaining({ method: "GET" })
      );
      selected = true;
      const first = await tool.execute("deepseek", { query, max_characters: 12 });
      const cursor = (first.details as { nextCursor: string }).nextCursor;
      expect(first.content[0]).toMatchObject({ text: expect.stringContaining(cursor) });
      selected = false;
      const rest = await tool.execute("next", { query, cursor });
      expect(rest.content[0]).toEqual({ type: "text", text: content.slice(12) });
      expect(options.fetch).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith("deepseek", query, expect.any(AbortSignal));
    });

    it("switches to the configured MCP search only after DuckDuckGo returns a verification page https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      options.fetch = jest.fn(async () => new Response("verification", { status: 202 }));
      const mcp = jest.fn(async () => ({ text: "https://example.com/real-result" }));
      options.getWebSearchRoutes = () => ({ preferred: "builtin", routes: { mcp } });
      const result = await execute("web_search", { query: "Scribe" });
      expect(result.content[0]).toMatchObject({ text: "https://example.com/real-result" });
      expect(result.details).toMatchObject({
        searchSource: "mcp",
        failedSearches: [expect.stringContaining("HTTP 202")],
      });
      expect(mcp).toHaveBeenCalledWith("web_search", "Scribe", expect.any(AbortSignal));
    });

    it("reports an uncertain remote outcome without offering a safe retry or switching sources https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      options.getWebSearchRoutes = () => ({
        preferred: "mcp",
        routes: {
          mcp: async () => {
            throw new WebSearchOutcomeUnknown("Disconnected after dispatch");
          },
        },
      });
      const result = await execute("web_search", { query: "Scribe" });
      expect(result.details).toMatchObject({
        execution: { status: "outcome_unknown", retry: "verify_before_retry" },
      });
      expect(options.fetch).not.toHaveBeenCalled();
    });

    it("surfaces endpoint failures and stops local consumption of an uncancellable request", async () => {
      options.fetch = jest.fn(async () => new Response("Access denied", { status: 403 }));
      await expect(execute("web_search", { query: "Scribe" })).rejects.toThrow("403");
      let started!: () => void;
      let release!: (response: Response) => void;
      const requested = new Promise<void>((resolve) => {
        started = resolve;
      });
      const response = new Promise<Response>((resolve) => {
        release = resolve;
      });
      options.fetch = jest.fn(() => {
        started();
        return response;
      });
      const controller = new AbortController();
      const pending = execute(
        "fetch_url",
        { url: "https://example.invalid" },
        "stopped-fetch",
        controller.signal
      );
      await requested;
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      release(new Response("Late reply"));
      await response;
    });

    it("reuses actual drawing read and image rendering without requesting write permission", async () => {
      const read = await execute("excalidraw_read", {
        path: "drawing.excalidraw.md",
        ids: ["box-one"],
      });
      expect(read.content[0]).toMatchObject({ text: expect.stringContaining("box-one") });
      const render = await execute("excalidraw_render", { path: "drawing.excalidraw.md" });
      expect(render.content).toContainEqual({ type: "image", data: "AQID", mimeType: "image/png" });
      expect(options.requestPermission).not.toHaveBeenCalled();
      expect(await readFile(join(root, "drawing.excalidraw.md"), "utf8")).toBe("old drawing");
    });

    it("returns an unavailable drawing result without a network request", async () => {
      jest.mocked(getExcalidrawApi).mockReturnValue(null);
      const drawing = await execute("excalidraw_read", { path: "drawing.excalidraw.md" });
      expect(drawing.isError).toBe(true);
      expect(drawing.content[0]).toMatchObject({ text: expect.stringContaining("not available") });
      expect(options.fetch).not.toHaveBeenCalled();
    });

    it("routes labelled drawing connections through the existing drawing API after approval", async () => {
      await execute("excalidraw_read", { path: "drawing.excalidraw.md" });
      const result = await execute("excalidraw_write", {
        path: "drawing.excalidraw.md",
        operations: [{ op: "connect", from: "box-one", to: "box-two", label: "Linked" }],
      });
      expect(result.isError).toBe(false);
      expect(options.requestPermission).toHaveBeenCalledTimes(1);
      expect(api.connectLabelled).toHaveBeenCalledWith(
        "drawing.excalidraw.md",
        expect.objectContaining({ from: "box-one", to: "box-two", label: "Linked" })
      );
    });

    it("writes through the drawing plugin only after approval and publishes the real before and after file", async () => {
      await execute(
        "excalidraw_write",
        {
          path: "created.excalidraw.md",
          elements: [{ type: "rectangle", width: 100, height: 60 }],
        },
        "draw-one"
      );
      expect(options.requestPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "native-one",
          requester: "main",
          toolCall: expect.objectContaining({ toolCallId: "draw-one", kind: "edit" }),
        })
      );
      expect(await readFile(join(root, "created.excalidraw.md"), "utf8")).toBe("new drawing");
      expect(updates).toContainEqual(
        expect.objectContaining({
          toolCallId: "draw-one",
          originalFiles: { "created.excalidraw.md": null },
        })
      );
      expect(updates).toContainEqual(
        expect.objectContaining({
          toolCallId: "draw-one",
          content: [
            { type: "diff", path: "created.excalidraw.md", oldText: null, newText: "new drawing" },
          ],
        })
      );
    });

    it("prevents denied, plan-mode and outside-link drawing writes from reaching the plugin", async () => {
      const input = {
        path: "drawing.excalidraw.md",
        operations: [{ op: "delete", ids: ["box-one"] }],
      };
      options.requestPermission = jest.fn(
        async (): Promise<PermissionDecision> => ({ outcome: { outcome: "cancelled" } })
      );
      await expect(execute("excalidraw_write", input)).rejects.toThrow("Permission denied");
      mode = "plan";
      await expect(execute("excalidraw_write", input)).rejects.toThrow("Plan approval");
      mode = "auto";
      await symlink(outside, join(root, "outside"));
      await expect(
        execute("excalidraw_write", { ...input, path: "outside/secret.md" })
      ).rejects.toThrow("symbolic links");
      expect(api.execute).not.toHaveBeenCalled();
      expect(updates).toHaveLength(0);
    });

    it("preserves user changes made while drawing approval is pending", async () => {
      let approve!: (decision: PermissionDecision) => void;
      let requested!: () => void;
      const shown = new Promise<void>((resolve) => {
        requested = resolve;
      });
      options.requestPermission = () => {
        requested();
        return new Promise((resolve) => {
          approve = resolve;
        });
      };
      const pending = execute("excalidraw_write", {
        path: "drawing.excalidraw.md",
        operations: [{ op: "delete", ids: ["box-one"] }],
      });
      await shown;
      await writeFile(join(root, "drawing.excalidraw.md"), "user changed drawing");
      approve({ outcome: { outcome: "selected", optionId: "allow_once" } });
      await expect(pending).rejects.toThrow("changed while approval was pending");
      expect(api.execute).not.toHaveBeenCalled();
      expect(await readFile(join(root, "drawing.excalidraw.md"), "utf8")).toBe(
        "user changed drawing"
      );
      expect(updates).toHaveLength(0);
    });

    it("does not start drawing writes after their own pending approval is cancelled", async () => {
      let approve!: (decision: PermissionDecision) => void;
      let requested!: () => void;
      const shown = new Promise<void>((resolve) => {
        requested = resolve;
      });
      options.requestPermission = () => {
        requested();
        return new Promise((resolve) => {
          approve = resolve;
        });
      };
      const controller = new AbortController();
      const pending = execute(
        "excalidraw_write",
        { path: "drawing.excalidraw.md", operations: [{ op: "delete", ids: ["box-one"] }] },
        "cancelled-drawing",
        controller.signal
      );
      await shown;
      controller.abort();
      approve({ outcome: { outcome: "selected", optionId: "allow_once" } });
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(api.execute).not.toHaveBeenCalled();
      expect(updates).toHaveLength(0);
    });

    it("stops subsequent plugin operations when cancellation arrives during an existing drawing operation", async () => {
      let finishOpen!: () => void;
      let started!: () => void;
      const opened = new Promise<void>((resolve) => {
        started = resolve;
      });
      const release = new Promise<void>((resolve) => {
        finishOpen = resolve;
      });
      api.execute = jest.fn(async () => {
        started();
        await release;
        return { ok: true };
      });
      mode = "auto";
      const controller = new AbortController();
      const pending = execute(
        "excalidraw_write",
        { path: "drawing.excalidraw.md", operations: [{ op: "delete", ids: ["box-one"] }] },
        "stopped-operation",
        controller.signal
      );
      await opened;
      controller.abort();
      finishOpen();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(api.execute).toHaveBeenCalledTimes(1);
      expect(await readFile(join(root, "drawing.excalidraw.md"), "utf8")).toBe("old drawing");
      expect(
        updates.some((update) => update.sessionUpdate === "tool_call_update" && update.content)
      ).toBe(false);
    });

    it("records the actual file change when a later drawing grouping step fails", async () => {
      api.execute = jest.fn(async (request) => {
        if (request.command !== "create")
          return { ok: false, error: { message: "Grouping unavailable" } };
        await writeFile(join(root, String(request.path)), "new drawing");
        return { ok: true, data: { idMap: { box: "box-one" } } };
      });
      const result = await execute(
        "excalidraw_write",
        {
          path: "created.excalidraw.md",
          elements: [{ id: "box", type: "rectangle", width: 100, height: 60 }],
          groups: [["box"]],
        },
        "partial-write"
      );
      expect(result.isError).toBe(true);
      expect(await readFile(join(root, "created.excalidraw.md"), "utf8")).toBe("new drawing");
      expect(updates).toContainEqual(
        expect.objectContaining({
          toolCallId: "partial-write",
          content: [
            { type: "diff", path: "created.excalidraw.md", oldText: null, newText: "new drawing" },
          ],
        })
      );
    });
    it("rejects malformed parameters before requests or drawing side effects", async () => {
      await expect(
        execute("fetch_url", { url: "https://example.invalid", max_characters: 0 })
      ).rejects.toThrow("Invalid arguments");
      await expect(execute("excalidraw_write", { path: 4 })).rejects.toThrow("Invalid arguments");
      expect(options.fetch).not.toHaveBeenCalled();
      expect(api.execute).not.toHaveBeenCalled();
    });
  });
});
