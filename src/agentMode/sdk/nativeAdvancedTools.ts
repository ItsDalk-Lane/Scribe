import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { int, obj, opt, str } from "@earendil-works/pi-schema";
import { raceWithAbortSignal } from "@earendil-works/pi-ai/utils/abort";
import { App, FileSystemAdapter } from "obsidian";
import type { NativeToolContext } from "@/agentMode/sdk/NativeBackendProcess";
import { defineNativeTool, NATIVE_PERMISSION_OPTIONS } from "@/agentMode/sdk/nativeToolDefinition";
import {
  resolveNativeVaultPath,
  withNativeWriteLock,
  getNativeVaultIdentity,
} from "@/agentMode/sdk/nativeVaultPath";
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
import {
  routeWebSearch,
  WebSearchOutcomeUnknown,
  type WebSearchRoute,
} from "@/agentMode/sdk/webSearchRouter";
import type { WebSearchSource } from "@/settings/webSearchProvider";
import type { SceneElement } from "@/excalidraw/excalidrawOutline";
import type { NativeObservedFileVersion } from "@/agentMode/sdk/nativeFileVersions";
import { pageToolText, withToolExecution } from "@/utils/toolResultProjection";

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
  getWebSearchRoutes?: () => {
    preferred: WebSearchSource;
    routes: Partial<Record<WebSearchSource, WebSearchRoute>>;
  };
}

export function createNativeAdvancedTools(options: NativeAdvancedToolsOptions): AgentTool[] {
  const candidate = options.app.vault.adapter;
  if (!(candidate instanceof FileSystemAdapter))
    throw new Error("Native drawing tools require a desktop vault.");
  const adapter = candidate;
  const vaultBase = getNativeVaultIdentity(adapter);
  const observed = options.observedFileVersions ?? new Map<string, NativeObservedFileVersion>();

  const searchPages = new Map<
    string,
    { text: string; source: WebSearchSource; failures: string[] }
  >();

  async function fetchPage(requested: string, operationSignal: AbortSignal) {
    const url = new URL(requested);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error("Only HTTP and HTTPS URLs are supported.");
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
    return { content, finalUrl, status: response.status };
  }

  async function readPage(
    requested: string,
    maxCharacters: number | undefined,
    signal?: AbortSignal,
    cursor?: string
  ): Promise<AgentToolResult> {
    const { content, finalUrl, status } = await fetchPage(
      requested,
      signal ?? new AbortController().signal
    );
    const page = pageToolText(
      content,
      finalUrl,
      cursor,
      maxCharacters ?? Math.max(1, content.length)
    );
    const { text: pageText, ...pageDetails } = page;
    return {
      content: [{ type: "text", text: pageText }],
      details: {
        url: finalUrl,
        status,
        ...pageDetails,
        characters: content.length,
        complete: !page.truncated,
      },
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

  function confirmSkillDelivery(entry: SkillToolEntry, signal?: AbortSignal): void {
    // 依赖与支撑文件读取期间，停用、修改或取消都可能撤销旧正文的投递资格。https://github.com/ItsDalk-Lane/Scribe/issues/71
    signal?.throwIfAborted();
    const current = requireInvocableSkill(entry.name);
    if (current.body !== entry.body || current.dirPath !== entry.dirPath)
      throw new Error("Skill content changed while preparing its delivery; start again.");
    options.assertCanExecute?.("invoke_skill");
  }

  // 续读绑定内容和资源，避免文件变化后拼接不同版本。https://github.com/ItsDalk-Lane/Scribe/issues/68
  function pageSkillText(text: string, identity: string, cursor?: string, maxCharacters?: number) {
    const window = options.catalogBudget?.contextWindow;
    // 小窗口先用技能自身的可校验分页，避免通用裁剪切断技能交付。https://github.com/ItsDalk-Lane/Scribe/issues/70
    const defaultPageSize =
      window !== undefined && Number.isFinite(window) && window > 0
        ? Math.min(SKILL_DELIVERY_MAX_CHARS, Math.max(256, Math.floor(window / 2) * 3 - 512))
        : SKILL_DELIVERY_MAX_CHARS;
    return pageToolText(
      text,
      identity,
      cursor,
      Math.min(defaultPageSize, maxCharacters ?? defaultPageSize)
    );
  }

  function listSkillsResult(cursor?: string, maxCharacters?: number): AgentToolResult {
    const lines = options
      .skills()
      .map((skill) => `- ${skill.name} (${skill.status}): ${skill.description}`);
    const delivered = pageSkillText(
      lines.length
        ? `Registered skills:\n${lines.join("\n")}`
        : "No skills are registered in this session.",
      "list",
      cursor,
      maxCharacters
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
              max_characters: opt(int({ minimum: 1, maximum: 20000 })),
            }),
            async (_id, args, signal) => {
              if (args.name === undefined)
                return listSkillsResult(args.cursor, args.max_characters);
              const entry = requireInvocableSkill(args.name);
              if (args.file !== undefined) {
                // 支撑文件读取以技能名为锚点并复用管理器的路径防护与二进制判定。https://github.com/ItsDalk-Lane/Scribe/issues/41
                if (!options.readSkillFile)
                  throw new Error("Skill support-file reading is unavailable in this session.");
                const content = await options.readSkillFile(entry.name, args.file, signal);
                confirmSkillDelivery(entry, signal);
                const delivered = pageSkillText(
                  `Skill file ${entry.name}/${args.file}:\n\n${content}`,
                  JSON.stringify([entry.name, args.file]),
                  args.cursor,
                  args.max_characters
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
              confirmSkillDelivery(entry, signal);
              const delivered = pageSkillText(
                buildSkillDependencyBlock(dependencyReadings) + skillInvocationText(entry),
                JSON.stringify([entry.name, null]),
                args.cursor,
                args.max_characters
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
            },
            { kind: "read", skillAuthoring: true }
          ),
        ]
      : []),
    defineNativeTool(
      "fetch_url",
      "Fetch web page",
      "Fetch actual HTTP or HTTPS content, with HTML converted to Markdown and source links. Optional max_characters caps one page; continue with cursor for the unchanged page. Without an explicit cap, the canonical result retains the whole response for read_tool_result after generic output trimming.",
      obj({
        url: str({ minLength: 1 }),
        max_characters: opt(int({ minimum: 1, maximum: 200000 })),
        cursor: opt(str()),
      }),
      (_id, args, signal) => readPage(args.url, args.max_characters, signal, args.cursor),
      { kind: "fetch", skillAuthoring: false }
    ),
    defineNativeTool(
      "web_search",
      "Search web",
      "Search the configured web search engine and return its actual results and links.",
      obj({
        query: str({ minLength: 1 }),
        max_characters: opt(int({ minimum: 1, maximum: 200000 })),
        cursor: opt(str()),
      }),
      async (id, args, signal) => {
        const operationSignal = signal ?? new AbortController().signal;
        const search = options.getWebSearchRoutes?.();
        const result = args.cursor
          ? searchPages.get(args.cursor.split(":")[1] ?? "")
          : await routeWebSearch(
              search?.preferred ?? "builtin",
              {
                builtin: async (_id, query, requestSignal) => {
                  const template =
                    options.searchUrlTemplate ?? "https://html.duckduckgo.com/html/?q={query}";
                  if (!template.includes("{query}"))
                    throw new Error("The search URL template must contain {query}.");
                  try {
                    const page = await fetchPage(
                      template.replaceAll("{query}", encodeURIComponent(query)),
                      requestSignal
                    );
                    return page.status === 202
                      ? { failure: "The search engine returned a verification page (HTTP 202)." }
                      : { text: page.content };
                  } catch (error) {
                    requestSignal.throwIfAborted();
                    return { failure: error instanceof Error ? error.message : String(error) };
                  }
                },
                ...search?.routes,
              },
              id,
              args.query,
              operationSignal,
              () => options.assertCanExecute?.("web_search")
            ).catch((error: unknown) => {
              if (error instanceof WebSearchOutcomeUnknown) return error;
              throw error;
            });
        if (result instanceof WebSearchOutcomeUnknown)
          return withToolExecution(
            { content: [{ type: "text", text: result.message }], details: undefined },
            { status: "outcome_unknown", retry: "verify_before_retry", complete: false }
          );
        // 续读只读取原有结果，避免重复派发远程调用。https://github.com/ItsDalk-Lane/Scribe/issues/70
        if (!result) throw new Error("This search continuation has expired.");
        const page = pageToolText(
          result.text,
          args.query,
          args.cursor,
          args.max_characters ?? Math.max(1, result.text.length)
        );
        if (page.nextCursor) {
          searchPages.set(page.fingerprint, result);
          if (searchPages.size > 8) {
            const oldest = searchPages.keys().next();
            if (!oldest.done) searchPages.delete(oldest.value);
          }
        }
        return {
          content: [{ type: "text", text: page.text }],
          details: {
            searchSource: result.source,
            failedSearches: result.failures,
            truncated: page.truncated,
            complete: !page.truncated,
            nextCursor: page.nextCursor,
          },
        };
      },
      { kind: "fetch", skillAuthoring: false }
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
        },
        { kind: "think", skillAuthoring: true }
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
          let dispatched = 0;
          const confirmedOperations: string[] = [];
          let outcomeUnknown = false;
          const finishWrite = (result: AgentToolResult): AgentToolResult => {
            const failed = result.isError === true || signal?.aborted === true;
            const status = outcomeUnknown
              ? "outcome_unknown"
              : failed
                ? confirmedOperations.length
                  ? "partial"
                  : dispatched
                    ? "failed"
                    : "not_started"
                : "completed";
            return withToolExecution(
              {
                ...result,
                isError: failed || outcomeUnknown,
                content: [
                  ...(confirmedOperations.length
                    ? [
                        {
                          type: "text" as const,
                          text: `Confirmed drawing operations: ${JSON.stringify(confirmedOperations)}. Do not repeat these operations.`,
                        },
                      ]
                    : []),
                  ...result.content,
                ],
                details: {
                  path,
                  dispatchedOperations: dispatched,
                  confirmedOperations: [...confirmedOperations],
                },
              },
              {
                status,
                retry: status === "completed" ? "never" : "verify_before_retry",
                complete: status === "completed",
                truncated: false,
              }
            );
          };

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
            let readRevision: string | number | undefined;
            let expectedRevision =
              observed.get(path)?.kind === "drawing"
                ? (observed.get(path) as Extract<NativeObservedFileVersion, { kind: "drawing" }>)
                    .revision
                : undefined;
            const guardWrite = () => {
              signal?.throwIfAborted();
              if (options.getMode() === "plan")
                throw new Error("Plan approval is required before changing drawings.");
              options.assertCanExecute?.("excalidraw_write");
            };
            const checkRevision = (revision: unknown) => {
              if (
                (typeof revision !== "string" && typeof revision !== "number") ||
                expectedRevision === undefined ||
                revision !== expectedRevision
              )
                throw new Error(
                  "The drawing changed or has not been read in this execution scope; read the current drawing before editing."
                );
            };
            const guardedApi: ExcalidrawApi | null = api
              ? {
                  sceneElements: async (requested) => {
                    signal?.throwIfAborted();
                    const opened = await guardedApi!.execute({
                      apiVersion: 1,
                      command: "open",
                      path: requested,
                    });
                    if (!opened.ok) throw new Error("Could not open the drawing for a live read.");
                    const elements: SceneElement[] = [];
                    let offset = 0;
                    let revision: string | number | undefined;
                    do {
                      const reply = await guardedApi!.execute({
                        apiVersion: 1,
                        command: "read",
                        path: requested,
                        source: "live",
                        detail: "elements",
                        limit: 200,
                        offset,
                        ...(revision === undefined ? {} : { revision }),
                      });
                      const data = reply.data;
                      if (
                        !reply.ok ||
                        !Array.isArray(data?.elements) ||
                        (typeof data.revision !== "string" && typeof data.revision !== "number")
                      )
                        throw new Error(
                          "The drawing plugin did not return a versioned live scene; update the plugin and read again."
                        );
                      if (revision !== undefined && data.revision !== revision)
                        throw new Error("The drawing changed during its read; read again.");
                      revision = data.revision;
                      elements.push(...(data.elements as SceneElement[]));
                      if (data.nextOffset === null || data.nextOffset === undefined) break;
                      if (
                        typeof data.nextOffset !== "number" ||
                        !Number.isSafeInteger(data.nextOffset) ||
                        data.nextOffset <= offset
                      )
                        throw new Error("The drawing plugin returned an invalid page offset.");
                      offset = data.nextOffset;
                    } while (offset > 0);
                    readRevision = revision;
                    return elements;
                  },
                  renderPng: (requested) => {
                    signal?.throwIfAborted();
                    return api.renderPng(requested);
                  },
                  execute: async (request) => {
                    signal?.throwIfAborted();
                    if (writes) guardWrite();
                    const mutating = request.command === "apply" || request.command === "create";
                    if (writes && mutating) {
                      if (request.command === "apply") {
                        checkRevision(request.expectedRevision);
                        request = { ...request, expectedRevision };
                      }
                    }
                    if (writes && mutating) {
                      dispatched++;
                      observed.delete(path);
                    }
                    let reply: Awaited<ReturnType<ExcalidrawApi["execute"]>>;
                    try {
                      reply = await api.execute(request);
                    } catch (error) {
                      if (writes && mutating) outcomeUnknown = true;
                      throw error;
                    }
                    // 取消不能抹掉插件已经明确确认的真实修改。https://github.com/ItsDalk-Lane/Scribe/issues/70
                    if (writes && mutating) {
                      if (reply.ok) confirmedOperations.push(String(request.command));
                      else if (reply.mutation === "applied" || reply.mutation === "unknown")
                        outcomeUnknown = true;
                    }
                    signal?.throwIfAborted();
                    if (writes && request.command === "read") checkRevision(reply.data?.revision);
                    if (writes && mutating) {
                      const revision =
                        reply.data?.acceptedRevision ?? reply.revision ?? reply.data?.revision;
                      expectedRevision =
                        reply.ok && (typeof revision === "string" || typeof revision === "number")
                          ? revision
                          : undefined;
                      observed.delete(path);
                    }
                    return reply;
                  },
                  connectLabelled: async (requested, connection) => {
                    guardWrite();
                    const live = await api.execute({
                      apiVersion: 1,
                      command: "read",
                      path: requested,
                      source: "live",
                    });
                    if (!live.ok)
                      throw new Error("Could not read the live drawing before connecting.");
                    checkRevision(live.data?.revision);
                    guardWrite();
                    // 旧连接接口没有提交版本凭据，不能把后续外部修改当作自己的新基线。https://github.com/ItsDalk-Lane/Scribe/issues/70
                    expectedRevision = undefined;
                    observed.delete(path);
                    dispatched++;
                    let confirmed = false;
                    try {
                      const result = await api.connectLabelled(requested, connection);
                      confirmedOperations.push("connectLabelled");
                      confirmed = true;
                      signal?.throwIfAborted();
                      return result;
                    } catch (error) {
                      if (!confirmed) outcomeUnknown = true;
                      throw error;
                    }
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
            if (!writes || dispatched === 0) signal?.throwIfAborted();
            const content: AgentToolResult["content"] = [{ type: "text", text: result.text }];
            if (result.image) content.push({ type: "image", ...result.image });
            const delivered = { content, details: { path }, isError: result.isError };
            // 只有成功生成的绘图读取结果能排队登记，运行时负责确认已交付模型。https://github.com/ItsDalk-Lane/Scribe/issues/71
            if (
              definition.name === EXCALIDRAW_READ_TOOL.name &&
              !result.isError &&
              readRevision !== undefined
            ) {
              const version = { kind: "drawing" as const, revision: readRevision };
              if (options.observeFileVersion) options.observeFileVersion(delivered, path, version);
              else observed.set(path, version);
            }
            return writes ? finishWrite(delivered) : delivered;
          }

          return writes
            ? withNativeWriteLock(
                `${vaultBase}/${path}`,
                async () => {
                  try {
                    return await run();
                  } catch (error) {
                    if (dispatched === 0) throw error;
                    return finishWrite({
                      content: [
                        {
                          type: "text",
                          text: `Drawing operation interrupted: ${error instanceof Error ? error.message : String(error)}. Inspect the drawing before retrying.`,
                        },
                      ],
                      details: { path },
                      isError: true,
                    });
                  }
                },
                signal
              )
            : run();
        },
        { kind: writes ? "edit" : "read", skillAuthoring: false, executionMode: "sequential" }
      )
    );
  }
  return tools;
}
