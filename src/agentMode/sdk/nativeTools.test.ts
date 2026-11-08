import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { App, FileSystemAdapter } from "obsidian";
import { createNativeTools } from "@/agentMode/sdk/nativeTools";
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
        text: "A random marker: penguin-42\nold paragraph",
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
      expect(result.content[0]).toEqual(
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
