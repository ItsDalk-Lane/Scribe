import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { arr, bool, obj, oneOf, opt, str, int } from "@earendil-works/pi-schema";
import { App, FileSystemAdapter } from "obsidian";
import type {
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  ScribeMode,
  PermissionDecision,
  PermissionPrompt,
  PermissionRequester,
  SessionUpdate,
  ToolCallSnapshot,
} from "@/agentMode/session/types";
import { NativeCommandTasks } from "@/agentMode/sdk/nativeCommandTasks";
import type { NativeToolContext } from "@/agentMode/sdk/NativeBackendProcess";
import { defineNativeTool, NATIVE_PERMISSION_OPTIONS } from "@/agentMode/sdk/nativeToolDefinition";
import {
  resolveNativeVaultPath,
  withNativeWriteLock,
  writeNativeVaultTarget,
} from "@/agentMode/sdk/nativeVaultPath";

export interface NativeToolsOptions extends Pick<
  NativeToolContext,
  | "assertCanExecute"
  | "sendSubagentMessage"
  | "listSubagentSessions"
  | "readSubagentResult"
  | "waitSubagents"
  | "stopSubagent"
  | "sendParentMessage"
> {
  app: App;
  cwd: string;
  sessionId: string;
  emit(update: SessionUpdate): void;
  requestPermission(prompt: PermissionPrompt): Promise<PermissionDecision>;
  askUser(prompt: AskUserQuestionPrompt): Promise<AgentQuestionAnswers>;
  getMode(): ScribeMode;
  requester?: PermissionRequester;
  onPlanApproved?(): void;
  commandTasks: NativeCommandTasks;
  subagents?: readonly { id: string; name: string; description: string }[];
  executeSubagent?(
    toolCallId: string,
    input: {
      prompt: string;
      description: string;
      name?: string;
      agent?: string;
      background?: boolean;
      skills?: string[];
      allowedTools?: string[];
    },
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
    signal?: AbortSignal,
    operationName = "write_note"
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
      options.assertCanExecute?.(operationName);
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
          signal,
          "edit_note"
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
            options.assertCanExecute?.("run_command");
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
        [
          "Run an independent Scribe child agent for a specific task and return its actual result.",
          ...(options.subagents ?? []).map(
            (entry) => `Custom agent ${entry.id}: ${entry.name} — ${entry.description}`
          ),
        ].join("\n"),
        obj({
          prompt: str({ minLength: 1 }),
          description: str({ minLength: 1 }),
          name: opt(
            str({
              minLength: 1,
              description:
                "Short stable name for this child instance, shown in the parent chat's child agent list. Use a distinct descriptive name for every new child.",
            })
          ),
          background: opt(bool()),
          skills: opt(arr(str({ minLength: 1 }))),
          allowedTools: opt(arr(str({ minLength: 1 }))),
          agent: opt(
            str({
              minLength: 1,
              description:
                "Optional custom agent ID from the list above; omit for general delegation.",
            })
          ),
        }),
        (toolCallId, args, signal) => options.executeSubagent!(toolCallId, args, signal)
      )
    );
  }
  if (options.sendSubagentMessage)
    tools.push(
      defineNativeTool(
        "send_subagent_message",
        "Send subagent message",
        "Send a scoped instruction to a retained child session. enqueue only queues; wake starts an idle session; interrupt stops the old run before continuing. For an idle wake, skills may name skills explicitly selected by the user in this task; this grants them only to the new run.",
        obj({
          subagentId: str({ minLength: 1 }),
          text: str({ minLength: 1 }),
          mode: oneOf(["enqueue", "wake", "interrupt"]),
          messageId: opt(str({ minLength: 1 })),
          skills: opt(arr(str({ minLength: 1 }))),
        }),
        async (_id, input) => textResult(JSON.stringify(await options.sendSubagentMessage!(input)))
      )
    );
  if (options.listSubagentSessions)
    tools.push(
      defineNativeTool(
        "list_subagent_sessions",
        "List child sessions",
        "Read this chat's retained child sessions, runs, messages and saved results without starting a model.",
        obj({}),
        async () =>
          textResult(
            JSON.stringify(
              options.listSubagentSessions!().map((state) => ({
                ...state,
                runs: state.runs.map(({ result: _result, ...run }) => run),
                // 列表仅供定位消息，不能把子聊天附件和选区发送给主模型。https://github.com/ItsDalk-Lane/Scribe/issues/50
                messages: state.messages.map(
                  ({ text: _text, payload: _payload, ...message }) => message
                ),
              }))
            )
          )
      )
    );
  if (options.readSubagentResult)
    tools.push(
      defineNativeTool(
        "read_subagent_result",
        "Read saved child result",
        "Deliver the selected canonical saved result once. An already delivered result returns its identity without repeating its body.",
        obj({ subagentId: str({ minLength: 1 }), runId: opt(str({ minLength: 1 })) }),
        async (_id, input) => options.readSubagentResult!(input.subagentId, input.runId)
      )
    );
  if (options.waitSubagents)
    tools.push(
      defineNativeTool(
        options.sendParentMessage ? "wait_for_message" : "wait_subagents",
        "Wait for collaboration",
        "Wait for a new message, result, user input, cancellation or timeout. Use the returned sequence as after for the next wait.",
        obj({
          subagentIds: opt(arr(str({ minLength: 1 }))),
          after: opt(int({ minimum: 0 })),
          timeoutMs: opt(int({ minimum: 0, maximum: 60000 })),
        }),
        async (_id, input, signal) => {
          const event = await options.waitSubagents!({
            ...input,
            timeoutMs: input.timeoutMs ?? 30000,
            signal,
          });
          return textResult(
            JSON.stringify({
              ...event,
              ...(event.message
                ? {
                    message: {
                      id: event.message.id,
                      kind: event.message.kind,
                      subagentId: event.message.subagentId,
                      runId: event.message.runId,
                    },
                  }
                : {}),
            })
          );
        }
      )
    );
  if (options.stopSubagent)
    tools.push(
      defineNativeTool(
        "stop_subagent",
        "Stop child run",
        "Stop only the selected child run, preserving its retained context.",
        obj({ subagentId: str({ minLength: 1 }) }),
        async (_id, input) => {
          await options.stopSubagent!(input.subagentId);
          return textResult("Child run stopped.");
        }
      )
    );
  if (options.sendParentMessage)
    tools.push(
      defineNativeTool(
        "send_parent_message",
        "Send parent message",
        "Reliably send a progress report, discovery, question or blocker to the owning parent chat without waiting for an answer.",
        obj({
          text: str({ minLength: 1 }),
          kind: oneOf(["progress", "discovery", "question", "blocked"]),
          messageId: opt(str({ minLength: 1 })),
        }),
        async (_id, input) => textResult(JSON.stringify(await options.sendParentMessage!(input)))
      )
    );
  return tools;
}
