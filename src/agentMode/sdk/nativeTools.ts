import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { arr, bool, obj, oneOf, opt, str, int } from "@earendil-works/pi-schema";
import { App, FileSystemAdapter } from "obsidian";
import type {
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  CopilotMode,
  PermissionDecision,
  PermissionPrompt,
  PermissionRequester,
  SessionUpdate,
  ToolCallSnapshot,
} from "@/agentMode/session/types";
import { NativeCommandTasks } from "@/agentMode/sdk/nativeCommandTasks";
import { defineNativeTool, NATIVE_PERMISSION_OPTIONS } from "@/agentMode/sdk/nativeToolDefinition";
import {
  resolveNativeVaultPath,
  withNativeWriteLock,
  writeNativeVaultTarget,
} from "@/agentMode/sdk/nativeVaultPath";

export interface NativeToolsOptions {
  app: App;
  cwd: string;
  sessionId: string;
  emit(update: SessionUpdate): void;
  requestPermission(prompt: PermissionPrompt): Promise<PermissionDecision>;
  askUser(prompt: AskUserQuestionPrompt): Promise<AgentQuestionAnswers>;
  getMode(): CopilotMode;
  requester?: PermissionRequester;
  onPlanApproved?(): void;
  commandTasks: NativeCommandTasks;
  executeSubagent?(
    toolCallId: string,
    input: { prompt: string; description: string },
    signal?: AbortSignal
  ): Promise<AgentToolResult>;
}

function textResult<T>(text: string, details?: T): AgentToolResult<T | undefined> {
  return { content: [{ type: "text", text }], details };
}

export function createNativeTools(options: NativeToolsOptions): AgentTool[] {
  const adapter = options.app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) {
    throw new Error("Native file tools require a desktop vault.");
  }
  const vaultBase = adapter.getBasePath();

  const resolvePath = (requested: string, allowMissing = false) =>
    resolveNativeVaultPath(adapter, requested, allowMissing);

  async function walk(start: string, signal?: AbortSignal): Promise<string[]> {
    const pending = [await resolvePath(start)];
    const visited = new Set<string>();
    const files: string[] = [];
    while (pending.length > 0) {
      signal?.throwIfAborted();
      const directory = await resolvePath(pending.pop()!);
      if (visited.has(directory)) continue;
      visited.add(directory);
      const listed = await adapter.list(directory);
      for (const file of listed.files) files.push(await resolvePath(file));
      pending.push(...listed.folders);
    }
    return files.sort();
  }

  async function requirePermission(
    toolCall: ToolCallSnapshot,
    signal?: AbortSignal,
    proposal = false
  ): Promise<PermissionDecision> {
    signal?.throwIfAborted();
    if (!proposal && options.getMode() === "plan") {
      throw new Error("Plan approval is required before changing files or running commands.");
    }
    // Auto 的自动放行与已保存的拒绝由共享的权限判定统一决定，工具侧不再短路。
    // https://github.com/ItsDalk-Lane/Scribe/issues/12
    const decision = await options.requestPermission({
      sessionId: options.sessionId,
      requester: options.requester,
      toolCall,
      options: [...NATIVE_PERMISSION_OPTIONS],
      signal,
    });
    signal?.throwIfAborted();
    if (!proposal && options.getMode() === "plan")
      throw new Error("Plan approval is required before changing files or running commands.");
    return decision;
  }

  function allowed(decision: PermissionDecision): boolean {
    return decision.outcome.outcome === "selected" && decision.outcome.optionId === "allow_once";
  }

  async function changeFile(
    toolCallId: string,
    requested: string,
    transform: (before: string | null) => string,
    signal?: AbortSignal
  ): Promise<AgentToolResult> {
    const path = await resolvePath(requested, true);
    return withNativeWriteLock(`${vaultBase}/${path}`, async () => {
      signal?.throwIfAborted();
      const before = (await adapter.exists(path)) ? await adapter.read(path) : null;
      const after = transform(before);
      const content = [{ type: "diff" as const, path, oldText: before, newText: after }];
      const toolCall: ToolCallSnapshot = {
        toolCallId,
        title: `Edit ${path}`,
        kind: "edit",
        rawInput: { path },
        content,
        locations: [{ path }],
      };
      const decision = await requirePermission(toolCall, signal);
      if (!allowed(decision)) throw new Error(decision.denyMessage || "Permission denied.");
      signal?.throwIfAborted();
      await resolvePath(path, true);
      const current = (await adapter.exists(path)) ? await adapter.read(path) : null;
      if (current !== before)
        throw new Error(
          "The file changed while approval was pending; read it and request approval again."
        );
      options.emit({
        sessionUpdate: "tool_call_update",
        toolCallId,
        originalFiles: { [path]: before },
        locations: [{ path }],
      });
      const segments = path.split("/");
      for (let index = 1; index < segments.length; index++) {
        const directory = segments.slice(0, index).join("/");
        if (!(await adapter.exists(directory))) {
          signal?.throwIfAborted();
          await adapter.mkdir(directory);
        }
      }
      signal?.throwIfAborted();
      if (options.getMode() === "plan")
        throw new Error("Plan approval is required before changing files or running commands.");
      await writeNativeVaultTarget(vaultBase, path, after, before === null);
      options.emit({ sessionUpdate: "tool_call_update", toolCallId, status: "completed", content });
      return textResult(`Saved ${path}`, { path, before, after });
    });
  }

  const tools: AgentTool[] = [
    defineNativeTool(
      "read_note",
      "Read note",
      "Read the actual text of a file in the current Obsidian vault.",
      obj({ path: str({ minLength: 1 }) }),
      async (_toolCallId, args, signal) => {
        const path = await resolvePath(args.path);
        signal?.throwIfAborted();
        return textResult(await adapter.read(path), { path });
      }
    ),
    defineNativeTool(
      "list_directory",
      "List directory",
      "List immediate file and folder paths in a vault directory.",
      obj({ path: opt(str()) }),
      async (_toolCallId, args, signal) => {
        const path = await resolvePath(args.path ?? "");
        signal?.throwIfAborted();
        const listed = await adapter.list(path);
        return textResult(JSON.stringify(listed), { path, ...listed });
      }
    ),
    defineNativeTool(
      "find_paths",
      "Find paths",
      "Find vault files whose path contains the query. Results are vault-relative paths.",
      obj({ query: str(), path: opt(str()), limit: opt(int({ minimum: 1, maximum: 1000 })) }),
      async (_toolCallId, args, signal) => {
        const files = await walk(args.path ?? "", signal);
        const matches = files.filter((path) =>
          path.toLowerCase().includes(args.query.toLowerCase())
        );
        return textResult(matches.slice(0, args.limit ?? 100).join("\n"), {
          total: matches.length,
        });
      }
    ),
    defineNativeTool(
      "search_content",
      "Search content",
      "Search literal text in vault files and return matching paths, line numbers, and actual lines.",
      obj({
        query: str({ minLength: 1 }),
        path: opt(str()),
        case_sensitive: opt(bool()),
        limit: opt(int({ minimum: 1, maximum: 1000 })),
      }),
      async (_toolCallId, args, signal) => {
        const files = await walk(args.path ?? "", signal);
        const matches: string[] = [];
        const query = args.case_sensitive ? args.query : args.query.toLowerCase();
        for (const path of files) {
          signal?.throwIfAborted();
          const text = await adapter.read(path);
          for (const [index, line] of text.split("\n").entries()) {
            if ((args.case_sensitive ? line : line.toLowerCase()).includes(query)) {
              matches.push(`${path}:${index + 1}: ${line}`);
              if (matches.length >= (args.limit ?? 100)) return textResult(matches.join("\n"));
            }
          }
        }
        return textResult(matches.join("\n"));
      }
    ),
    defineNativeTool(
      "write_note",
      "Write note",
      "Create or replace a text file in the vault after the required permission decision.",
      obj({ path: str({ minLength: 1 }), content: str() }),
      (toolCallId, args, signal) => changeFile(toolCallId, args.path, () => args.content, signal)
    ),
    defineNativeTool(
      "edit_note",
      "Edit note",
      "Replace exact text in an existing vault file. Multiple matches require replace_all.",
      obj({
        path: str({ minLength: 1 }),
        old_text: str({ minLength: 1 }),
        new_text: str(),
        replace_all: opt(bool()),
      }),
      (toolCallId, args, signal) =>
        changeFile(
          toolCallId,
          args.path,
          (before) => {
            if (before === null) throw new Error("The file does not exist.");
            const pieces = before.split(args.old_text);
            if (pieces.length === 1)
              throw new Error("The exact text was not found; read the current file first.");
            if (!args.replace_all && pieces.length !== 2)
              throw new Error(
                "The text occurs more than once; provide a unique match or replace_all."
              );
            return args.replace_all
              ? pieces.join(args.new_text)
              : before.replace(args.old_text, () => args.new_text);
          },
          signal
        )
    ),
    defineNativeTool(
      "ask_user",
      "Ask user",
      "Ask one or more questions in the existing question card and wait for the actual answers.",
      obj({
        questions: arr(
          obj({
            question: str({ minLength: 1 }),
            header: opt(str()),
            answerKey: opt(str()),
            multiSelect: opt(bool()),
            allowOther: opt(bool()),
            options: arr(obj({ label: str(), description: opt(str()) })),
          }),
          { minItems: 1 }
        ),
      }),
      async (toolCallId, args, signal) => {
        const answers = await options.askUser({
          sessionId: options.sessionId,
          requestId: toolCallId,
          questions: args.questions,
          signal,
        });
        signal?.throwIfAborted();
        return textResult(JSON.stringify(answers));
      }
    ),
    defineNativeTool(
      "propose_plan",
      "Propose plan",
      "Present a plan for approval, rejection, or feedback. Approval is required before leaving plan mode.",
      obj({ plan: str({ minLength: 1 }) }),
      async (toolCallId, args, signal) => {
        const toolCall: ToolCallSnapshot = {
          toolCallId,
          title: "Plan proposal",
          kind: "switch_mode",
          rawInput: { plan: args.plan },
          isPlanProposal: true,
        };
        options.emit({ sessionUpdate: "tool_call_update", ...toolCall });
        const decision = await requirePermission(toolCall, signal, true);
        if (!allowed(decision))
          return { ...textResult(decision.denyMessage || "Plan rejected."), isError: true };
        options.onPlanApproved?.();
        return textResult("Plan approved.");
      }
    ),
    defineNativeTool(
      "update_todos",
      "Update todo progress",
      "Replace the current todo progress list without requesting plan approval or launching tasks.",
      obj({
        entries: arr(
          obj({
            content: str(),
            priority: oneOf(["high", "medium", "low"]),
            status: oneOf(["pending", "in_progress", "completed"]),
          })
        ),
      }),
      async (_toolCallId, args) => {
        options.emit({ sessionUpdate: "plan", entries: args.entries });
        return textResult(JSON.stringify(args.entries));
      }
    ),
    defineNativeTool(
      "run_command",
      "Run command",
      "Execute a real system command in the session working directory after permission. Background commands have independent task IDs and can be stopped separately.",
      obj({ command: str({ minLength: 1 }), background: opt(bool()) }),
      async (toolCallId, args, signal, onUpdate) => {
        await resolvePath(options.cwd);
        const decision = await requirePermission(
          {
            toolCallId,
            title: args.command,
            kind: "execute",
            rawInput: { command: args.command, cwd: options.cwd },
          },
          signal
        );
        if (!allowed(decision)) throw new Error(decision.denyMessage || "Permission denied.");
        const result = await options.commandTasks.run({
          toolCallId,
          command: args.command,
          background: args.background,
          signal,
          checkPermission: () => {
            if (options.getMode() === "plan")
              throw new Error(
                "Plan approval is required before changing files or running commands."
              );
          },
          onUpdate: (output) => onUpdate?.(textResult(output)),
        });
        return {
          ...textResult(result.output || JSON.stringify(result), result),
          isError: result.status === "failed" || result.status === "stopped",
        };
      }
    ),
  ];
  if (options.executeSubagent) {
    tools.push(
      defineNativeTool(
        "delegate_task",
        "Delegate task",
        "Run an independent Scribe child agent for a specific task and return its actual result.",
        obj({ prompt: str({ minLength: 1 }), description: str({ minLength: 1 }) }),
        (toolCallId, args, signal) => options.executeSubagent!(toolCallId, args, signal)
      )
    );
  }
  return tools;
}
