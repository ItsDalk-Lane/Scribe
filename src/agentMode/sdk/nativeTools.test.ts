import {
  access,
  mkdir,
  link,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { App, FileSystemAdapter, TFile } from "obsidian";
import { createNativeTools } from "@/agentMode/sdk/nativeTools";
import { projectToolResult } from "@/utils/toolResultProjection";
import { getNativeToolPolicy } from "@/agentMode/sdk/nativeToolDefinition";
import type { NativeToolsOptions } from "@/agentMode/sdk/nativeTools";
import { NativeCommandTasks } from "@/agentMode/sdk/nativeCommandTasks";
import type { ScribeMode, PermissionDecision, SessionUpdate } from "@/agentMode/session/types";

describe("nativeTools", () => {
  describe("createNativeTools", () => {
    let root: string;
    let outside: string;
    let options: NativeToolsOptions;
    let events: SessionUpdate[];
    let mode: ScribeMode;
    let tasks: NativeCommandTasks;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "scribe-native-tools-"));
      outside = await mkdtemp(join(tmpdir(), "scribe-native-outside-"));
      await mkdir(join(root, "notes"));
      await writeFile(
        join(root, "notes", "source.md"),
        "A random marker: penguin-42\nold paragraph"
      );
      const adapter = new FileSystemAdapter();
      adapter.getBasePath = () => root;
      adapter.read = (path: string) => readFile(join(root, path), "utf8");
      adapter.write = (path: string, content: string) => writeFile(join(root, path), content);
      adapter.exists = async (path: string) => {
        try {
          await access(join(root, path));
          return true;
        } catch {
          return false;
        }
      };
      adapter.list = async (path: string) => {
        const children = await readdir(join(root, path), { withFileTypes: true });
        return {
          files: children
            .filter((child) => child.isFile())
            .map((child) =>
              relative(root, join(root, path, child.name))
                .split(sep)
                .join("/")
            ),
          folders: children
            .filter((child) => child.isDirectory() || child.isSymbolicLink())
            .map((child) =>
              relative(root, join(root, path, child.name))
                .split(sep)
                .join("/")
            ),
        };
      };
      events = [];
      mode = "default";
      tasks = new NativeCommandTasks({
        cwd: root,
        sessionId: "native-session",
        outputDirectory: join(outside, "outputs"),
        emit: (event) => events.push(event),
      });
      options = {
        app: { vault: { adapter } } as unknown as App,
        cwd: root,
        sessionId: "native-session",
        emit: (event) => events.push(event),
        getMode: () => mode,
        requestPermission: jest.fn(
          async (): Promise<PermissionDecision> => ({
            outcome: { outcome: "selected", optionId: "allow_once" },
          })
        ),
        askUser: jest.fn(async () => ({ choice: "chosen answer" })),
        commandTasks: tasks,
        observedFileVersions: new Map(),
        onPlanApproved: () => {
          mode = "default";
        },
      };
    });

    afterEach(async () => {
      await tasks.shutdown();
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    });

    it("整文件覆盖拒绝未读和过期版本，局部编辑保留无关改动 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      await expect(
        execute("write_note", { path: "notes/source.md", content: "replacement" })
      ).rejects.toThrow(/read/i);
      await execute("read_note", { path: "notes/source.md" });
      await writeFile(join(root, "notes/source.md"), "User addition\nold paragraph");
      await expect(
        execute("write_note", { path: "notes/source.md", content: "replacement" })
      ).rejects.toThrow(/changed|read/i);
      await execute("edit_note", {
        path: "notes/source.md",
        old_text: "old paragraph",
        new_text: "new paragraph",
      });
      expect(await readFile(join(root, "notes/source.md"), "utf8")).toBe(
        "User addition\nnew paragraph"
      );
    });

    it("does not authorize replacement from a file read cancelled before delivery https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      const controller = new AbortController();
      const read = options.app.vault.adapter.read.bind(options.app.vault.adapter);
      options.app.vault.adapter.read = async (path) => {
        const content = await read(path);
        controller.abort();
        return content;
      };
      await expect(
        execute("read_note", { path: "notes/source.md" }, "cancelled-read", controller.signal)
      ).rejects.toThrow(/abort/i);
      expect(options.observedFileVersions!.size).toBe(0);
    });

    it("does not create a missing parent after plan mode takes effect during directory preparation https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      const adapter = options.app.vault.adapter;
      const exists = adapter.exists.bind(adapter);
      adapter.exists = async (path) => {
        if (path === "new") mode = "plan";
        return exists(path);
      };
      adapter.mkdir = async (path) => {
        await mkdir(join(root, path));
      };
      await expect(
        execute("write_note", { path: "new/created.md", content: "draft" })
      ).rejects.toThrow(/plan approval/i);
      await expect(access(join(root, "new"))).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("hands a complete read to the delivery owner without granting replacement early https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      options.observeFileVersion = jest.fn();
      const result = await execute("read_note", { path: "notes/source.md" }, "pending-read");
      expect(options.observeFileVersion).toHaveBeenCalledWith(
        result,
        "notes/source.md",
        expect.objectContaining({ kind: "text", complete: true })
      );
      await expect(
        execute("write_note", { path: "notes/source.md", content: "replacement" })
      ).rejects.toThrow(/complete current/i);
    });

    it("分页读取未完成不能覆盖，续读完整后允许，其他执行主体没有此凭据 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      await writeFile(join(root, "long.md"), "x".repeat(21000));
      const first = await execute("read_note", { path: "long.md" });
      expect(first.details).toMatchObject({ complete: false, truncated: true, end: 20000 });
      await expect(execute("write_note", { path: "long.md", content: "new" })).rejects.toThrow(
        /complete current/i
      );
      const next = await execute("read_note", {
        path: "long.md",
        cursor: (first.details as { nextCursor: string }).nextCursor,
      });
      expect(next.details).toMatchObject({ complete: true, truncated: false });
      const isolated = createNativeTools({ ...options, observedFileVersions: new Map() }).find(
        (tool) => tool.name === "write_note"
      )!;
      await expect(
        isolated.execute("other", { path: "long.md", content: "other" })
      ).rejects.toThrow(/complete current/i);
      await execute("write_note", { path: "long.md", content: "new" });
      expect(await readFile(join(root, "long.md"), "utf8")).toBe("new");
    });

    it("读取范围和失效游标不能冒充全文，目录和搜索正文有明确上限 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      await writeFile(join(root, "long.md"), "needle".repeat(6000));
      const ranged = await execute("read_note", {
        path: "notes/source.md",
        startLine: 2,
        lineCount: 1,
      });
      expect(ranged.details).toMatchObject({ complete: false });
      const first = await execute("read_note", { path: "long.md" });
      await writeFile(join(root, "long.md"), "changed");
      await expect(
        execute("read_note", {
          path: "long.md",
          cursor: (first.details as { nextCursor: string }).nextCursor,
        })
      ).rejects.toThrow(/changed/i);
      await writeFile(join(root, "long.md"), "needle".repeat(6000));
      const search = await execute("search_content", { query: "needle" });
      expect(search.content[0].type === "text" && search.content[0].text.length).toBeLessThan(
        20500
      );
      expect(search.details).toMatchObject({
        complete: false,
        truncated: true,
        nextCursor: expect.any(String),
      });
      const remainder = await execute("search_content", {
        query: "needle",
        cursor: (search.details as { nextCursor: string }).nextCursor,
      });
      expect(remainder.details).toMatchObject({ complete: true, truncated: false });
      const directory = await execute("list_directory", { limit: 1 });
      expect(directory.details).toMatchObject({ complete: false, truncated: true });
    });

    it("已索引笔记在原子处理回调复核，未保存的编辑器内容保持原样 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      const file = new TFile();
      file.path = "notes/source.md";
      options.app.vault.getAbstractFileByPath = () => file;
      const process = jest.fn(async (_file: TFile, callback: (value: string) => string) => {
        const before = await readFile(join(root, file.path), "utf8");
        const after = callback(before);
        await writeFile(join(root, file.path), after);
        return after;
      });
      options.app.vault.process = process;
      options.app.workspace = {
        getLeavesOfType: () => [
          { view: { file, editor: { getValue: () => "unsaved user text" } } },
        ],
      } as unknown as App["workspace"];
      await execute("read_note", { path: file.path });
      await expect(
        execute("write_note", { path: file.path, content: "replacement" })
      ).rejects.toThrow(/unsaved/i);
      expect(await readFile(join(root, file.path), "utf8")).toContain("old paragraph");
      options.app.workspace = { getLeavesOfType: () => [] } as unknown as App["workspace"];
      await execute("write_note", { path: file.path, content: "replacement" });
      expect(process).toHaveBeenCalledTimes(2);
      expect(await readFile(join(root, file.path), "utf8")).toBe("replacement");
    });

    it("preserves both notes when an indexed file shares its contents with another entry https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      const file = Object.assign(new TFile(), { path: "notes/source.md" });
      const original = await readFile(join(root, file.path), "utf8");
      await link(join(root, file.path), join(root, "notes/other.md"));
      options.app.vault.getAbstractFileByPath = () => file;
      options.app.vault.process = async (_file, callback) => {
        const after = callback(original);
        await writeFile(join(root, file.path), after);
        return after;
      };
      await expect(
        execute("edit_note", {
          path: file.path,
          old_text: "old paragraph",
          new_text: "new paragraph",
        })
      ).rejects.toThrow(/hard link/i);
      expect(await readFile(join(root, file.path), "utf8")).toBe(original);
      expect(await readFile(join(root, "notes/other.md"), "utf8")).toBe(original);
    });

    it("preserves invalid UTF-8 bytes instead of re-encoding unrelated content on edit https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      const original = new Uint8Array([...new TextEncoder().encode("change this\n"), 0xff, 0xfe]);
      await writeFile(join(root, "mixed.txt"), original);
      await expect(
        execute("edit_note", { path: "mixed.txt", old_text: "change this", new_text: "updated" })
      ).rejects.toThrow(/utf-8/i);
      expect(Array.from(await readFile(join(root, "mixed.txt")))).toEqual(Array.from(original));
    });

    it("原子处理读取期间替换为链接也不能改动库外目标 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      const file = Object.assign(new TFile(), { path: "notes/source.md" });
      const target = join(outside, "linked.md");
      const original = await readFile(join(root, file.path), "utf8");
      await writeFile(target, original);
      await execute("read_note", { path: file.path });
      options.app.vault.getAbstractFileByPath = () => file;
      options.app.vault.process = async (_file, callback) => {
        await rm(join(root, file.path));
        await symlink(target, join(root, file.path));
        const after = callback(original);
        await writeFile(join(root, file.path), after);
        return after;
      };
      await expect(
        execute("write_note", { path: file.path, content: "replacement" })
      ).rejects.toThrow(/symbolic link/i);
      expect(await readFile(target, "utf8")).toBe(original);
    });

    it("目录准备期间外部改动在最终提交前被拒绝 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      await execute("read_note", { path: "notes/source.md" });
      const exists = options.app.vault.adapter.exists.bind(options.app.vault.adapter);
      options.app.vault.adapter.exists = async (path) => {
        if (path === "notes")
          await writeFile(join(root, "notes/source.md"), "external change during preparation");
        return exists(path);
      };
      await expect(
        execute("write_note", { path: "notes/source.md", content: "replacement" })
      ).rejects.toThrow(/changed/i);
      expect(await readFile(join(root, "notes/source.md"), "utf8")).toBe(
        "external change during preparation"
      );
    });

    it("全部内置工具声明执行策略，作用域结果读取仅注册一次并转交原始分页参数 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      options.readToolResult = jest.fn(async () => ({
        content: [{ type: "text" as const, text: "saved page" }],
        details: { scope: "main" },
      }));
      options.executeSubagent = jest.fn(async () => ({
        content: [{ type: "text" as const, text: "child" }],
        details: undefined,
      }));
      const tools = createNativeTools(options);
      expect(tools.find((tool) => tool.name === "delegate_task")?.executionMode).toBe("parallel");
      expect(tools.every((tool) => getNativeToolPolicy(tool) !== undefined)).toBe(true);
      expect(tools.filter((tool) => tool.name === "read_tool_result")).toHaveLength(1);
      const reader = tools.find((tool) => tool.name === "read_tool_result")!;
      expect(getNativeToolPolicy(reader)).toMatchObject({ kind: "read", skillAuthoring: true });
      expect(reader.executionMode).toBe("parallel");
      expect(getNativeToolPolicy(tools.find((tool) => tool.name === "ask_user")!)).toMatchObject({
        kind: "think",
        skillAuthoring: true,
      });
      expect(
        getNativeToolPolicy(tools.find((tool) => tool.name === "list_directory")!)
      ).toMatchObject({ kind: "read", skillAuthoring: true });
      expect(
        getNativeToolPolicy(tools.find((tool) => tool.name === "delegate_task")!)
      ).toMatchObject({ kind: "think", skillAuthoring: false });
      expect(
        (await reader.execute("r", { tool_call_id: "old", cursor: "cursor", max_characters: 12 }))
          .content
      ).toEqual([{ type: "text", text: "saved page" }]);
      expect(options.readToolResult).toHaveBeenCalledWith({
        toolCallId: "old",
        cursor: "cursor",
        maxCharacters: 12,
      });
    });

    it("命令结构化执行事实与实际后台、退出和停止状态一致 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      for (const status of ["running", "completed", "failed", "stopped"] as const) {
        const run = jest.spyOn(options.commandTasks, "run").mockResolvedValueOnce({
          taskId: "task",
          outputFile: ".scribe/task.log",
          output: "actual stdout",
          exitCode: status === "completed" ? 0 : null,
          status,
          truncated: status === "failed",
          complete: status === "completed",
        });
        const result = await execute("run_command", { command: "synthetic command" });
        expect(result.details).toMatchObject({
          status,
          output: "actual stdout",
          execution: {
            status: status === "stopped" ? "outcome_unknown" : status,
            complete: status === "completed",
            truncated: status === "failed",
            retry: status === "running" || status === "completed" ? "never" : "verify_before_retry",
          },
        });
        run.mockRestore();
      }
    });

    it("照通用截断提示调用结果读取即可通过公开参数校验 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      options.readToolResult = jest.fn(async () => ({
        content: [{ type: "text" as const, text: "saved continuation" }],
        details: undefined,
      }));
      const result = projectToolResult(
        { content: [{ type: "text", text: "long original ".repeat(2000) }], details: undefined },
        { scope: "main", toolCallId: "original-id" },
        { maxTokens: 200, remainingTokens: 200 }
      );
      const text = result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      const payload = JSON.parse(text.match(/Continue with read_tool_result (\{[^\n]+\})/)![1]);
      await execute("read_tool_result", payload);
      expect(options.readToolResult).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: "original-id", cursor: expect.any(String) })
      );
    });

    it("目录、路径和搜索超过单页条数仍可完整续读，结果变化拒旧游标 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      for (let index = 0; index < 3; index++)
        await writeFile(join(root, `page-${index}.md`), `paging marker ${index}`);
      for (const [name, args] of [
        ["list_directory", {}],
        ["find_paths", { query: "page-" }],
        ["search_content", { query: "paging marker" }],
      ] as const) {
        let cursor: string | undefined;
        const chunks: string[] = [];
        let pages = 0;
        do {
          const result = await execute(name, { ...args, limit: 1, cursor });
          const page = result.details as {
            offset: number;
            end: number;
            truncated: boolean;
            nextCursor?: string;
          };
          const part = result.content[0];
          chunks.push(part.type === "text" ? part.text.slice(0, page.end - page.offset) : "");
          if (page.truncated) expect(page.nextCursor).toEqual(expect.any(String));
          cursor = page.nextCursor;
          pages++;
          expect(pages).toBeLessThan(10);
        } while (cursor);
        expect(chunks.join("")).toContain("page-0.md");
        expect(chunks.join("")).toContain("page-2.md");
        expect(pages).toBeGreaterThan(1);
        const initial = await execute(name, { ...args, limit: 1 });
        await writeFile(join(root, `page-added-${name}.md`), "paging marker additional");
        await expect(
          execute(name, {
            ...args,
            limit: 1,
            cursor: (initial.details as { nextCursor: string }).nextCursor,
          })
        ).rejects.toThrow(/changed/i);
      }
      const first = await execute("find_paths", { query: "page-", limit: 1 });
      await writeFile(join(root, "page-3.md"), "new result");
      await expect(
        execute("find_paths", {
          query: "page-",
          limit: 1,
          cursor: (first.details as { nextCursor: string }).nextCursor,
        })
      ).rejects.toThrow(/changed/i);
    });

    function execute(name: string, args: unknown, id = name, signal?: AbortSignal) {
      const tool = createNativeTools(options).find((entry) => entry.name === name);
      if (!tool) throw new Error(`Missing native tool ${name}`);
      return tool.execute(id, args, signal);
    }

    it("passes explicitly selected skills with a retained child wake instruction (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
      options.sendSubagentMessage = jest.fn(async () => ({
        subagentId: "child",
        runId: "run",
        status: "queued" as const,
      }));
      await execute("send_subagent_message", {
        subagentId: "child",
        text: "continue",
        mode: "wake",
        skills: ["manual-review"],
      });
      expect(options.sendSubagentMessage).toHaveBeenCalledWith({
        subagentId: "child",
        text: "continue",
        mode: "wake",
        skills: ["manual-review"],
      });
    });

    it("lists child message metadata without exposing text or attachments to the parent model https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
      const message = {
        id: "msg-1",
        sequence: 1,
        subagentId: "child",
        taskGenerationId: "task",
        direction: "to_child" as const,
        sender: "user" as const,
        kind: "instruction" as const,
        text: "private user instruction",
        payload: {
          content: [
            { type: "text" as const, text: "private selected content" },
            { type: "image" as const, data: "cHJpdmF0ZS1pbWFnZQ==", mimeType: "image/png" },
          ],
        },
        state: "delivered" as const,
        acceptedAt: 1,
      };
      options.listSubagentSessions = () => [
        {
          id: "child",
          parentSessionId: "parent",
          name: "Child",
          modelId: "model",
          cwd: root,
          retention: "retained",
          createdAt: 1,
          updatedAt: 2,
          runs: [],
          messages: [message],
        },
      ];

      const result = await execute("list_subagent_sessions", {});
      const body = JSON.stringify(result);
      expect(body).not.toContain("private user instruction");
      expect(body).not.toContain("private selected content");
      expect(body).not.toContain("cHJpdmF0ZS1pbWFnZQ==");
      expect(body).not.toContain("payload");
      expect(body).toContain("msg-1");
      expect(message.payload.content).toHaveLength(2);
    });

    it("reads a real note and finds its path and matching line from actual contents", async () => {
      const read = await execute("read_note", { path: "notes/source.md" });
      const paths = await execute("find_paths", { query: "source" });
      const search = await execute("search_content", { query: "penguin-42" });
      const list = await execute("list_directory", { path: "notes" });
      expect(read.content).toContainEqual({
        type: "text",
        text: expect.stringContaining("A random marker: penguin-42\nold paragraph"),
      });
      expect(paths.content[0]).toEqual(
        expect.objectContaining({ text: expect.stringContaining("notes/source.md") })
      );
      expect(search.content[0]).toEqual(
        expect.objectContaining({ text: expect.stringContaining("notes/source.md:1:") })
      );
      expect(list.content[0]).toEqual(
        expect.objectContaining({ text: expect.stringContaining("notes/source.md") })
      );
      expect(options.requestPermission).not.toHaveBeenCalled();
    });

    it("writes and edits real files after permission and publishes exact before and after contents", async () => {
      await execute("write_note", { path: "new.md", content: "A new note" });
      await execute("edit_note", {
        path: "notes/source.md",
        old_text: "old paragraph",
        new_text: "new paragraph",
      });
      expect(await readFile(join(root, "new.md"), "utf8")).toBe("A new note");
      expect(await readFile(join(root, "notes/source.md"), "utf8")).toContain("new paragraph");
      expect(events).toContainEqual(
        expect.objectContaining({
          sessionUpdate: "tool_call_update",
          toolCallId: "write_note",
          content: [{ type: "diff", path: "new.md", oldText: null, newText: "A new note" }],
        })
      );
      expect(options.requestPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "native-session",
          toolCall: expect.objectContaining({ toolCallId: "write_note", kind: "edit" }),
        })
      );
    });

    it("leaves a denied edit unchanged and returns no completed file diff", async () => {
      options.requestPermission = async () => ({
        outcome: { outcome: "selected", optionId: "reject_once" },
      });
      await expect(
        execute("edit_note", {
          path: "notes/source.md",
          old_text: "old paragraph",
          new_text: "forbidden",
        })
      ).rejects.toThrow(/denied/i);
      expect(await readFile(join(root, "notes/source.md"), "utf8")).toContain("old paragraph");
      expect(events).not.toContainEqual(
        expect.objectContaining({ status: "completed", content: expect.anything() })
      );
    });

    it("does not write when cancellation arrives while its own permission is pending", async () => {
      const controller = new AbortController();
      options.requestPermission = async () => {
        controller.abort();
        return { outcome: { outcome: "selected", optionId: "allow_once" } };
      };
      await expect(
        execute(
          "write_note",
          { path: "blocked.md", content: "blocked" },
          "call-1",
          controller.signal
        )
      ).rejects.toThrow(/abort/i);
      await expect(access(join(root, "blocked.md"))).rejects.toThrow();
    });

    it("rejects both traversal and symlink paths that leave the current vault", async () => {
      await writeFile(join(outside, "secret.md"), "outside secret");
      await symlink(outside, join(root, "escape"), "dir");
      await expect(execute("read_note", { path: "../outside.md" })).rejects.toThrow(/vault/i);
      await expect(execute("read_note", { path: "escape/secret.md" })).rejects.toThrow(/vault/i);
      await expect(
        execute("write_note", { path: "escape/new.md", content: "forbidden" })
      ).rejects.toThrow(/vault/i);
      expect(options.requestPermission).not.toHaveBeenCalled();
    });

    it.each([
      { name: "write_note", args: { path: "plan-blocked.md", content: "forbidden" } },
      { name: "run_command", args: { command: "echo forbidden > plan-blocked.md" } },
    ])(
      "blocks $name when plan mode is entered while its permission is pending",
      async ({ name, args }) => {
        options.requestPermission = async () => {
          mode = "plan";
          return { outcome: { outcome: "selected", optionId: "allow_once" } };
        };
        await expect(execute(name, args)).rejects.toThrow(/plan/i);
        await expect(access(join(root, "plan-blocked.md"))).rejects.toThrow();
      }
    );

    it("does not launch a command when plan mode starts while the system environment is loading", async () => {
      tasks = new NativeCommandTasks({
        cwd: root,
        sessionId: "native-session",
        outputDirectory: join(outside, "outputs"),
        emit: (event) => events.push(event),
        getEnv: async () => {
          mode = "plan";
          return {};
        },
      });
      options.commandTasks = tasks;
      await expect(
        execute("run_command", { command: "echo forbidden > plan-blocked.md" })
      ).rejects.toThrow(/plan/i);
      await expect(access(join(root, "plan-blocked.md"))).rejects.toThrow();
    });

    it("requires a plan decision before writes and passes feedback back to the requesting tool", async () => {
      mode = "plan";
      await expect(
        execute("write_note", { path: "plan.md", content: "premature" })
      ).rejects.toThrow(/plan/i);
      options.requestPermission = async () => ({
        outcome: { outcome: "selected", optionId: "reject_once" },
        denyMessage: "Include a rollback step",
      });
      const rejected = await execute(
        "propose_plan",
        { plan: "# Plan\nChange one note" },
        "plan-call"
      );
      expect(rejected.isError).toBe(true);
      expect(rejected.content).toContainEqual({ type: "text", text: "Include a rollback step" });
      expect(mode).toBe("plan");
      options.requestPermission = async () => ({
        outcome: { outcome: "selected", optionId: "allow_once" },
      });
      await execute(
        "propose_plan",
        { plan: "# Plan\nChange one note and keep rollback" },
        "plan-call-2"
      );
      expect(mode).toBe("default");
      await execute("write_note", { path: "plan.md", content: "approved" });
      expect(await readFile(join(root, "plan.md"), "utf8")).toBe("approved");
    });

    it("routes questions by the requesting tool ID and only returns the actual user answer", async () => {
      const result = await execute(
        "ask_user",
        {
          questions: [
            { question: "Choose", answerKey: "choice", options: [{ label: "A" }, { label: "B" }] },
          ],
        },
        "question-7"
      );
      expect(options.askUser).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "question-7", sessionId: "native-session" })
      );
      expect(result.content).toContainEqual({
        type: "text",
        text: JSON.stringify({ choice: "chosen answer" }),
      });
    });

    it("updates todo progress without publishing a plan proposal or launching a task", async () => {
      await execute("update_todos", {
        entries: [{ content: "Read note", priority: "high", status: "completed" }],
      });
      expect(events).toEqual([
        {
          sessionUpdate: "plan",
          entries: [{ content: "Read note", priority: "high", status: "completed" }],
        },
      ]);
      expect(options.requestPermission).not.toHaveBeenCalled();
    });

    it("executes approved real commands and attaches the originating child task to permission prompts", async () => {
      options.requester = { taskId: "child-3" };
      const result = await execute("run_command", { command: `"${process.execPath}" -p "6 * 7"` });
      expect(result.content).toContainEqual(
        expect.objectContaining({ text: expect.stringContaining("42") })
      );
      expect(options.requestPermission).toHaveBeenCalledWith(
        expect.objectContaining({ requester: { taskId: "child-3" } })
      );
    });

    it("preserves a user's edits made while permission was pending", async () => {
      options.requestPermission = async () => {
        await writeFile(join(root, "notes/source.md"), "Changed by the user");
        return { outcome: { outcome: "selected", optionId: "allow_once" } };
      };
      await expect(
        execute("edit_note", {
          path: "notes/source.md",
          old_text: "old paragraph",
          new_text: "agent edit",
        })
      ).rejects.toThrow(/changed while approval/i);
      expect(await readFile(join(root, "notes/source.md"), "utf8")).toBe("Changed by the user");
    });

    it("detects an approved command changing a note outside the note write lock while its edit approval is pending (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
      await writeFile(
        join(root, "external-edit.cjs"),
        "require('node:fs').writeFileSync('notes/source.md', 'Changed by approved command')"
      );
      options.requestPermission = async (request) => {
        if (request.toolCall.kind === "edit")
          await execute("run_command", {
            command: `"${process.execPath}" external-edit.cjs`,
          });
        return { outcome: { outcome: "selected", optionId: "allow_once" } };
      };
      await expect(
        execute("edit_note", {
          path: "notes/source.md",
          old_text: "old paragraph",
          new_text: "agent edit",
        })
      ).rejects.toThrow(/changed while approval/i);
      expect(await readFile(join(root, "notes/source.md"), "utf8")).toBe(
        "Changed by approved command"
      );
    });

    it("serializes two writes to the same file so each approved diff uses the latest content", async () => {
      let permissionStarted!: () => void;
      let approve!: (decision: PermissionDecision) => void;
      const started = new Promise<void>((resolve) => {
        permissionStarted = resolve;
      });
      options.requestPermission = jest.fn(
        () =>
          new Promise((resolve) => {
            approve = resolve;
            permissionStarted();
          })
      );
      const first = execute(
        "edit_note",
        { path: "notes/source.md", old_text: "old paragraph", new_text: "first edit" },
        "first-edit"
      );
      await started;
      const second = execute(
        "edit_note",
        { path: "notes/source.md", old_text: "first edit", new_text: "second edit" },
        "second-edit"
      );
      options.requestPermission = async () => ({
        outcome: { outcome: "selected", optionId: "allow_once" },
      });
      approve({ outcome: { outcome: "selected", optionId: "allow_once" } });
      await Promise.all([first, second]);
      expect(await readFile(join(root, "notes/source.md"), "utf8")).toContain("second edit");
    });

    it("routes auto-mode file edits through the shared permission decision while commands still request approval", async () => {
      mode = "auto";
      await execute("write_note", { path: "auto.md", content: "Approved by selected mode" });
      expect(options.requestPermission).toHaveBeenCalledTimes(1);
      await execute("run_command", { command: `"${process.execPath}" -p "42"` });
      expect(options.requestPermission).toHaveBeenCalledTimes(2);
    });

    it("routes full-mode edits and commands through the shared permission decision so the backend decides the allow-all (https://github.com/ItsDalk-Lane/Scribe/issues/38)", async () => {
      mode = "full";
      await execute("write_note", { path: "full.md", content: "Approved by full mode" });
      expect(options.requestPermission).toHaveBeenCalledTimes(1);
      await execute("run_command", { command: `"${process.execPath}" -p "43"` });
      expect(options.requestPermission).toHaveBeenCalledTimes(2);
    });

    const posix = process.platform === "win32" ? it.skip : it;
    posix(
      "refuses to write through a dangling symbolic link and leaves the outside target uncreated (https://github.com/ItsDalk-Lane/Scribe/issues/11)",
      async () => {
        const outsideFile = join(outside, "never-created.md");
        await symlink(outsideFile, join(root, "looks-safe.md"));
        await expect(
          execute("write_note", { path: "looks-safe.md", content: "OUTSIDE_MARKER" })
        ).rejects.toThrow(/symbolic link/i);
        await expect(access(outsideFile)).rejects.toMatchObject({ code: "ENOENT" });
        expect(options.requestPermission).not.toHaveBeenCalled();
      }
    );
    posix(
      "keeps the write bound to the approved target when the path is replaced while approval is pending (https://github.com/ItsDalk-Lane/Scribe/issues/11)",
      async () => {
        const outsideFile = join(outside, "stolen.md");
        await writeFile(outsideFile, "ORIGINAL-OUTSIDE");
        await writeFile(join(root, "target.md"), "ORIGINAL-INSIDE");
        await execute("read_note", { path: "target.md" });
        options.requestPermission = async () => {
          await rm(join(root, "target.md"));
          await symlink(outsideFile, join(root, "target.md"));
          return { outcome: { outcome: "selected", optionId: "allow_once" } };
        };
        await expect(
          execute("write_note", { path: "target.md", content: "REPLACEMENT" })
        ).rejects.toThrow(/symbolic link|vault/i);
        expect(await readFile(outsideFile, "utf8")).toBe("ORIGINAL-OUTSIDE");
      }
    );

    it("requires an unambiguous replacement unless replacing every occurrence was requested", async () => {
      await writeFile(join(root, "repeated.md"), "same / same");
      await expect(
        execute("edit_note", { path: "repeated.md", old_text: "same", new_text: "new" })
      ).rejects.toThrow(/more than once/i);
      await execute("edit_note", {
        path: "repeated.md",
        old_text: "same",
        new_text: "$&",
        replace_all: true,
      });
      expect(await readFile(join(root, "repeated.md"), "utf8")).toBe("$& / $&");
    });

    it("delegates only to the registered native child executor with its original ID and cancellation signal", async () => {
      const controller = new AbortController();
      options.executeSubagent = jest.fn(async () => ({
        content: [{ type: "text" as const, text: "Child result" }],
        details: undefined,
      }));
      options.subagents = [{ id: "reviewer", name: "Reviewer", description: "Check sources" }];
      const result = await execute(
        "delegate_task",
        { prompt: "Inspect the notes", description: "Inspect", agent: "reviewer" },
        "child-tool",
        controller.signal
      );
      expect(result.content).toContainEqual({ type: "text" as const, text: "Child result" });
      expect(options.executeSubagent).toHaveBeenCalledWith(
        "child-tool",
        { prompt: "Inspect the notes", description: "Inspect", agent: "reviewer" },
        controller.signal
      );
    });

    it("passes the optional child name through to the native executor", async () => {
      const controller = new AbortController();
      options.executeSubagent = jest.fn(async () => ({
        content: [{ type: "text" as const, text: "Child result" }],
        details: undefined,
      }));
      const result = await execute(
        "delegate_task",
        { prompt: "Inspect the notes", description: "Inspect", name: "Source audit" },
        "child-tool",
        controller.signal
      );
      expect(result.content).toContainEqual({ type: "text" as const, text: "Child result" });
      expect(options.executeSubagent).toHaveBeenCalledWith(
        "child-tool",
        { prompt: "Inspect the notes", description: "Inspect", name: "Source audit" },
        controller.signal
      );
    });

    it("rejects an empty child name before asking permission or starting the child", async () => {
      options.executeSubagent = jest.fn();
      await expect(
        execute("delegate_task", { prompt: "Inspect", description: "Inspect", name: "" })
      ).rejects.toThrow(/argument/i);
      expect(options.executeSubagent).not.toHaveBeenCalled();
    });

    it("rejects malformed parameters before asking permission or touching files", async () => {
      await expect(execute("write_note", { path: "invalid.md", content: 42 })).rejects.toThrow(
        /argument/i
      );
      expect(options.requestPermission).not.toHaveBeenCalled();
      await expect(access(join(root, "invalid.md"))).rejects.toThrow();
    });
  });
});
