import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { int, obj, opt, str } from "@earendil-works/pi-schema";
import { raceWithAbortSignal } from "@earendil-works/pi-ai/utils/abort";
import { App, FileSystemAdapter } from "obsidian";
import type { NativeToolContext } from "@/agentMode/sdk/NativeBackendProcess";
import { defineNativeTool, NATIVE_PERMISSION_OPTIONS } from "@/agentMode/sdk/nativeToolDefinition";
import { resolveNativeVaultPath, withNativeWriteLock } from "@/agentMode/sdk/nativeVaultPath";
import {
  buildEmptySkillCatalog,
  buildSkillCatalog,
  buildSkillDependencyBlock,
  SKILL_DELIVERY_MAX_CHARS,
  resolveSkillCatalogBudget,
  type SkillCatalogBuildStatus,
  type SkillDependencyDeliveryReading,
} from "@/agentMode/sdk/skillCatalog";
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
import { sha256 } from "@/utils/hash";

export interface SkillDraftProposal {
  name: string;
  description: string;
  body: string;
}

// 模型可见目录按调用资格标注每个技能，供目录过滤与可改道错误共用。
// https://github.com/ItsDalk-Lane/Scribe/issues/41
export type SkillInvocationStatus = "available" | "disabled" | "manual-only";

export interface SkillToolEntry {
  name: string;
  description: string;
  body: string;
  dirPath?: string;
  status: SkillInvocationStatus;
  builtin?: boolean;
}

export interface NativeAdvancedToolsOptions extends Omit<
  NativeToolContext,
  "mcpToolSelections" | "registerTool"
> {
  reviewSkillDraft?: (
    draft: SkillDraftProposal,
    signal?: AbortSignal
  ) => Promise<{ name: string } | null>;
  app: App;
  skills(): readonly SkillToolEntry[];
  readSkillFile?: (name: string, relativePath: string, signal?: AbortSignal) => Promise<string>;
  catalogBudget?: { contextWindow?: number; percent?: number; maxTokens?: number };
  skillCatalogLifecycle?: { everPublished(): boolean; markPublished(): void };
  onCatalogBuilt?: (status: SkillCatalogBuildStatus) => void;
  resolveSkillDependencies?: (name: string) => Promise<readonly SkillDependencyDeliveryReading[]>;
  onSkillInvoked?: (name: string) => void;
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

  function findSkillEntry(name: string) {
    return options.skills().find((entry) => entry.name === name);
  }

  function requireInvocableSkill(name: string): SkillToolEntry {
    const entry = findSkillEntry(name);
    if (!entry)
      throw new Error(
        `The skill is not registered in this session: ${name}. Call invoke_skill with no arguments to list every registered skill.`
      );
    // 调用不可用状态的技能必须得到可区分、可指导改道的错误。https://github.com/ItsDalk-Lane/Scribe/issues/41
    if (entry.status === "disabled")
      throw new Error(
        `Skill "${name}" is disabled for this agent. Ask the user to enable it in Settings → Skills, or use another skill.`
      );
    // 明确转交仅对本次子运行开放技能读取，不能改变技能的长期调用资格。https://github.com/ItsDalk-Lane/Scribe/issues/50
    if (entry.status === "manual-only" && !options.transferredSkills?.includes(name))
      throw new Error(
        `Skill "${name}" does not allow model invocation. Ask the user to run it manually, or use another skill.`
      );
    return entry;
  }

  function skillInvocationText(entry: SkillToolEntry): string {
    return entry.dirPath
      ? `Skill directory: ${entry.dirPath}\nResolve supporting files relative to this directory.\n\n${entry.body}`
      : entry.body;
  }

  // 续读绑定内容和资源，避免文件变化后拼接不同版本。https://github.com/ItsDalk-Lane/Scribe/issues/68
  function pageSkillText(text: string, identity: string, cursor?: string) {
    const fingerprint = sha256(JSON.stringify([identity, text]));
    const match = cursor?.match(/^(\d+):([a-f0-9]{64})$/);
    if (cursor && (!match || match[2] !== fingerprint))
      throw new Error("Skill content changed or the continuation cursor is invalid; start again.");
    const offset = match ? Number(match[1]) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || (cursor && offset >= text.length))
      throw new Error("Invalid skill continuation cursor; start again.");
    let end = Math.min(offset + SKILL_DELIVERY_MAX_CHARS, text.length);
    if (
      end < text.length &&
      /[\uD800-\uDBFF]/.test(text[end - 1]) &&
      /[\uDC00-\uDFFF]/.test(text[end])
    )
      end--;
    const truncated = end < text.length;
    const nextCursor = truncated ? `${end}:${fingerprint}` : undefined;
    return {
      text:
        text.slice(offset, end) +
        (nextCursor ? `\n\n[Output truncated]\nContinue with cursor: ${nextCursor}` : ""),
      truncated,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  function listSkillsResult(cursor?: string): AgentToolResult {
    const lines = options
      .skills()
      .map((skill) => `- ${skill.name} (${skill.status}): ${skill.description}`);
    const delivered = pageSkillText(
      lines.length
        ? `Registered skills:\n${lines.join("\n")}`
        : "No skills are registered in this session.",
      "list",
      cursor
    );
    return {
      content: [{ type: "text", text: delivered.text }],
      details: {
        listed: lines.length,
        truncated: delivered.truncated,
        ...(delivered.nextCursor ? { nextCursor: delivered.nextCursor } : {}),
      },
    };
  }

  // 目录随每轮工具重建发布；从未发布过且无可用技能时不注册该工具，发布过之后
  // 技能集变空则发布空目录纪律。https://github.com/ItsDalk-Lane/Scribe/issues/42
  const availableCatalogEntries = () =>
    options
      .skills()
      // 转交的手动技能也必须能读取支持文件，即使没有自动技能目录。https://github.com/ItsDalk-Lane/Scribe/issues/50
      .filter(
        (skill) =>
          skill.status === "available" ||
          (skill.status === "manual-only" && options.transferredSkills?.includes(skill.name))
      )
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        builtin: skill.builtin === true,
      }));
  const catalog =
    availableCatalogEntries().length > 0
      ? buildSkillCatalog({
          available: availableCatalogEntries(),
          budget: resolveSkillCatalogBudget(options.catalogBudget ?? {}),
        })
      : options.skillCatalogLifecycle?.everPublished()
        ? buildEmptySkillCatalog(resolveSkillCatalogBudget(options.catalogBudget ?? {}))
        : null;
  if (catalog) {
    if (catalog.status.includedNames.length > 0) options.skillCatalogLifecycle?.markPublished();
    options.onCatalogBuilt?.(catalog.status);
  }

  const tools: AgentTool[] = [
    ...(catalog
      ? [
          defineNativeTool(
            "invoke_skill",
            "Use skill",
            catalog.description,
            obj({
              name: opt(str({ minLength: 1 })),
              file: opt(str({ minLength: 1 })),
              cursor: opt(str({ minLength: 1 })),
            }),
            async (_id, args, signal) => {
              if (args.name === undefined) return listSkillsResult(args.cursor);
              const entry = requireInvocableSkill(args.name);
              if (args.file !== undefined) {
                // 支撑文件读取以技能名为锚点并复用管理器的路径防护与二进制判定。https://github.com/ItsDalk-Lane/Scribe/issues/41
                if (!options.readSkillFile)
                  throw new Error("Skill support-file reading is unavailable in this session.");
                const content = await options.readSkillFile(entry.name, args.file, signal);
                const delivered = pageSkillText(
                  `Skill file ${entry.name}/${args.file}:\n\n${content}`,
                  JSON.stringify([entry.name, args.file]),
                  args.cursor
                );
                return {
                  content: [{ type: "text", text: delivered.text }],
                  details: {
                    name: entry.name,
                    file: args.file,
                    truncated: delivered.truncated,
                    ...(delivered.nextCursor ? { nextCursor: delivered.nextCursor } : {}),
                  },
                };
              }
              // 正文投递前置本机实际依赖状态（内容级就绪注入）。https://github.com/ItsDalk-Lane/Scribe/issues/46
              const dependencyReadings = options.resolveSkillDependencies
                ? await options.resolveSkillDependencies(entry.name)
                : [];
              const delivered = pageSkillText(
                buildSkillDependencyBlock(dependencyReadings) + skillInvocationText(entry),
                JSON.stringify([entry.name, null]),
                args.cursor
              );
              // 模型侧技能投递计入本地使用台账。https://github.com/ItsDalk-Lane/Scribe/issues/48
              if (!args.cursor) options.onSkillInvoked?.(entry.name);
              return {
                content: [{ type: "text", text: delivered.text }],
                details: {
                  name: entry.name,
                  ...(entry.dirPath ? { directory: entry.dirPath } : {}),
                  truncated: delivered.truncated,
                  ...(delivered.nextCursor ? { nextCursor: delivered.nextCursor } : {}),
                },
              };
            }
          ),
        ]
      : []),
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

  if (options.reviewSkillDraft) {
    tools.push(
      defineNativeTool(
        "propose_skill",
        "Review skill draft",
        "Show the complete skill draft to the user for editing and explicit confirmation. Only the confirmation interface can save it; cancellation never installs a skill.",
        obj({
          name: str({ minLength: 1 }),
          description: str({ minLength: 1 }),
          body: str({ minLength: 1 }),
        }),
        async (_id, draft, signal) => {
          signal?.throwIfAborted();
          const saved = await options.reviewSkillDraft!(draft, signal);
          if (!saved)
            return {
              content: [
                { type: "text", text: "The user cancelled the draft. No skill was saved." },
              ],
              details: { saved: false },
            };
          return {
            content: [
              { type: "text", text: `Skill saved after explicit confirmation: ${saved.name}` },
            ],
            details: { name: saved.name, saved: true },
          };
        }
      )
    );
  }

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
