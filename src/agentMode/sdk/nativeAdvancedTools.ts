import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { int, obj, opt, str } from "@earendil-works/pi-schema";
import { raceWithAbortSignal } from "@earendil-works/pi-ai/utils/abort";
import { App, FileSystemAdapter } from "obsidian";
import type { NativeToolContext } from "@/agentMode/sdk/NativeBackendProcess";
import { defineNativeTool, NATIVE_PERMISSION_OPTIONS } from "@/agentMode/sdk/nativeToolDefinition";
import { resolveNativeVaultPath, withNativeWriteLock } from "@/agentMode/sdk/nativeVaultPath";
import {
  SEND_FEEDBACK_TOOL,
  type FeedbackDraft,
  type FeedbackOfferResult,
} from "@/agentMode/session/scribeToolDefinitions";
import {
  createExcalidrawTools,
  EXCALIDRAW_READ_TOOL,
  EXCALIDRAW_RENDER_TOOL,
  EXCALIDRAW_WRITE_TOOL,
  type ExcalidrawApi,
} from "@/excalidraw/excalidrawTools";
import { getExcalidrawApi } from "@/excalidraw/excalidrawApi";
import { htmlToMarkdown } from "@/services/webViewerService/webViewerServiceHelpers";
import { isRecord } from "@/utils/obsidianInternals";
import { safeFetchNoThrow } from "@/utils";

export interface NativeAdvancedToolsOptions extends NativeToolContext {
  app: App;
  skills(): readonly { name: string; description: string; body: string }[];
  offerFeedback(draft: FeedbackDraft): FeedbackOfferResult;
  fetch?: typeof safeFetchNoThrow;
  searchUrlTemplate?: string;
}

export function createNativeAdvancedTools(options: NativeAdvancedToolsOptions): AgentTool[] {
  const candidate = options.app.vault.adapter;
  if (!(candidate instanceof FileSystemAdapter))
    throw new Error("Native drawing tools require a desktop vault.");
  const adapter = candidate;

  async function readPage(
    requested: string,
    maxCharacters: number,
    signal?: AbortSignal
  ): Promise<AgentToolResult> {
    const url = new URL(requested);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error("Only HTTP and HTTPS URLs are supported.");
    const operationSignal = signal ?? new AbortController().signal;
    operationSignal.throwIfAborted();
    const response = await raceWithAbortSignal(
      (options.fetch ?? safeFetchNoThrow)(url.href, { method: "GET", signal: operationSignal }),
      operationSignal
    );
    if (!response.ok) throw new Error(`Web request failed (${response.status}): ${url.href}`);
    const original = await raceWithAbortSignal(response.text(), operationSignal);
    const finalUrl = response.url || url.href;
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/^(text\/|application\/(?:json|xml|xhtml\+xml))/i.test(contentType))
      throw new Error(`Unsupported web content type: ${contentType}`);
    const content = /html/i.test(contentType) ? htmlToMarkdown(original, finalUrl) : original;
    const truncated = content.length > maxCharacters;
    return {
      content: [
        {
          type: "text",
          text: content.slice(0, maxCharacters) + (truncated ? "\n\n[Output truncated]" : ""),
        },
      ],
      details: { url: finalUrl, status: response.status, truncated, characters: content.length },
    };
  }

  const tools: AgentTool[] = [
    defineNativeTool(
      "invoke_skill",
      "Use skill",
      "Read the instructions of a registered Scribe skill for the current project and user.",
      obj({ name: str({ minLength: 1 }) }),
      async (_id, args) => {
        const skill = options.skills().find((entry) => entry.name === args.name);
        if (!skill) throw new Error(`The skill is not registered in this session: ${args.name}`);
        return { content: [{ type: "text", text: skill.body }], details: { name: skill.name } };
      }
    ),
    defineNativeTool(
      SEND_FEEDBACK_TOOL.name,
      "Draft feedback",
      SEND_FEEDBACK_TOOL.description,
      SEND_FEEDBACK_TOOL.inputSchema,
      async (_id, args) => {
        if (
          !isRecord(args) ||
          typeof args.title !== "string" ||
          typeof args.what_happened !== "string" ||
          typeof args.repro !== "string"
        )
          throw new Error("Invalid feedback draft.");
        const status = options.offerFeedback({
          title: args.title,
          whatHappened: args.what_happened,
          userSaid: typeof args.user_said === "string" ? args.user_said : "",
          repro: args.repro,
        });
        return {
          content: [{ type: "text", text: `Feedback draft: ${status}.` }],
          details: { status },
        };
      }
    ),
    defineNativeTool(
      "fetch_url",
      "Fetch web page",
      "Fetch actual content from an HTTP or HTTPS URL. HTML is returned as Markdown with source links.",
      obj({
        url: str({ minLength: 1 }),
        max_characters: opt(int({ minimum: 1, maximum: 200000 })),
      }),
      (_id, args, signal) => readPage(args.url, args.max_characters ?? 20000, signal)
    ),
    defineNativeTool(
      "web_search",
      "Search web",
      "Search the configured web search engine and return its actual results and links.",
      obj({
        query: str({ minLength: 1 }),
        max_characters: opt(int({ minimum: 1, maximum: 200000 })),
      }),
      (_id, args, signal) => {
        const template = options.searchUrlTemplate ?? "https://html.duckduckgo.com/html/?q={query}";
        if (!template.includes("{query}"))
          throw new Error("The search URL template must contain {query}.");
        return readPage(
          template.replaceAll("{query}", encodeURIComponent(args.query)),
          args.max_characters ?? 20000,
          signal
        );
      }
    ),
  ];

  for (const definition of [EXCALIDRAW_READ_TOOL, EXCALIDRAW_RENDER_TOOL, EXCALIDRAW_WRITE_TOOL]) {
    const writes = definition.name === EXCALIDRAW_WRITE_TOOL.name;
    tools.push(
      defineNativeTool(
        definition.name,
        writes
          ? "Edit drawing"
          : definition.name === EXCALIDRAW_READ_TOOL.name
            ? "Read drawing"
            : "Render drawing",
        definition.description,
        definition.inputSchema,
        async (toolCallId, args, signal) => {
          if (!isRecord(args) || typeof args.path !== "string" || !args.path.trim())
            throw new Error("A drawing path is required.");
          const path = await resolveNativeVaultPath(adapter, args.path, writes);
          const input = { ...args, path };

          async function run(): Promise<AgentToolResult> {
            signal?.throwIfAborted();
            const before = writes && (await adapter.exists(path)) ? await adapter.read(path) : null;
            if (writes) {
              if (options.getMode() === "plan")
                throw new Error("Plan approval is required before changing drawings.");
              if (options.getMode() !== "auto") {
                const decision = await options.requestPermission({
                  sessionId: options.sessionId,
                  requester: options.requester,
                  toolCall: {
                    toolCallId,
                    title: `Edit ${path}`,
                    kind: "edit",
                    rawInput: input,
                    locations: [{ path }],
                  },
                  options: [...NATIVE_PERMISSION_OPTIONS],
                  signal,
                });
                if (
                  decision.outcome.outcome !== "selected" ||
                  decision.outcome.optionId !== "allow_once"
                )
                  throw new Error(decision.denyMessage || "Permission denied.");
              }
              signal?.throwIfAborted();
              if (options.getMode() === "plan")
                throw new Error("Plan approval is required before changing drawings.");
              await resolveNativeVaultPath(adapter, path, true);
              const current = (await adapter.exists(path)) ? await adapter.read(path) : null;
              if (current !== before)
                throw new Error(
                  "The drawing changed while approval was pending; read it and request approval again."
                );
              options.emit({
                sessionUpdate: "tool_call_update",
                toolCallId,
                originalFiles: { [path]: before },
                locations: [{ path }],
              });
            }

            const api = getExcalidrawApi(options.app);
            const guardedApi: ExcalidrawApi | null = api
              ? {
                  sceneElements: (requested) => {
                    signal?.throwIfAborted();
                    return api.sceneElements(requested);
                  },
                  renderPng: (requested) => {
                    signal?.throwIfAborted();
                    return api.renderPng(requested);
                  },
                  execute: (request) => {
                    signal?.throwIfAborted();
                    return api.execute(request);
                  },
                  connectLabelled: (requested, connection) => {
                    signal?.throwIfAborted();
                    return api.connectLabelled(requested, connection);
                  },
                }
              : null;
            const hosted = createExcalidrawTools(() => guardedApi).find(
              (tool) => tool.definition.name === definition.name
            );
            if (!hosted) throw new Error(`The drawing tool is not registered: ${definition.name}`);
            const operation = hosted.call(input);
            const result = writes
              ? await operation
              : await raceWithAbortSignal(operation, signal ?? new AbortController().signal);
            if (writes) {
              const after = (await adapter.exists(path)) ? await adapter.read(path) : null;
              if (before !== after)
                options.emit({
                  sessionUpdate: "tool_call_update",
                  toolCallId,
                  locations: [{ path }],
                  content: [{ type: "diff", path, oldText: before, newText: after ?? "" }],
                });
            }
            signal?.throwIfAborted();
            const content: AgentToolResult["content"] = [{ type: "text", text: result.text }];
            if (result.image) content.push({ type: "image", ...result.image });
            return { content, details: { path }, isError: result.isError };
          }

          return writes ? withNativeWriteLock(`${adapter.getBasePath()}/${path}`, run) : run();
        }
      )
    );
  }
  return tools;
}
