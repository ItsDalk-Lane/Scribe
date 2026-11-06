import {
  ALLOWED_NOTE_CONTEXT_EXTENSIONS,
  ModelCapability,
  TEXT_READABLE_EXTENSIONS,
} from "@/constants";
import { logInfo, logWarn } from "@/logger";
import { DateTime } from "luxon";
import {
  App,
  MarkdownView,
  Notice,
  TFile,
  Vault,
  normalizePath,
  requestUrl,
  type WorkspaceLeaf,
} from "obsidian";
import { getChatInsertionTarget } from "@/editor/chatInsertionTarget";
import { CustomModel } from "./aiParams";
export { err2String } from "@/lib/errorFormat";

export function getDomainFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface APIError extends Error {
  json?: unknown;
}

const ERROR_MESSAGES = {
  REQUEST_FAILED: (status: number) => `Request failed, status ${status}`,
} as const;

export const getNotesFromPath = (vault: Vault, path: string): TFile[] => {
  const files = vault.getMarkdownFiles();

  if (path === "/") {
    return files;
  }

  const normalizedPath = path.toLowerCase().replace(/^\/|\/$/g, "");

  return files.filter((file) => {
    const normalizedFilePath = file.path.toLowerCase();
    const filePathParts = normalizedFilePath.split("/");
    const pathParts = normalizedPath.split("/");

    let filePathIndex = 0;
    for (const pathPart of pathParts) {
      while (filePathIndex < filePathParts.length) {
        if (filePathParts[filePathIndex] === pathPart) {
          break;
        }
        filePathIndex++;
      }
      if (filePathIndex >= filePathParts.length) {
        return false;
      }
    }

    return true;
  });
};

export function stripHash(tag: string): string {
  return tag.replace(/^#/, "").trim();
}

interface StripFrontmatterOptions {
  trimStart?: boolean;
}

export function stripFrontmatter(content: string, options: StripFrontmatterOptions = {}): string {
  const { trimStart = true } = options;

  if (content.startsWith("---")) {
    const end = content.indexOf("---", 3);
    if (end !== -1) {
      const body = content.slice(end + 3);

      if (trimStart) {
        return body.trimStart();
      }

      if (body.startsWith("\r\n")) {
        return body.slice(2);
      }
      if (body.startsWith("\n") || body.startsWith("\r")) {
        return body.slice(1);
      }
      return body;
    }
  }
  return content;
}

export function getTagsFromNote(app: App, file: TFile, frontmatterOnly = true): string[] {
  const metadata = app.metadataCache.getFileCache(file);
  const frontmatterTags = metadata?.frontmatter?.tags;
  const allTags = new Set<string>();

  if (!frontmatterOnly) {
    const inlineTags = metadata?.tags?.map((tag) => tag.tag);
    if (inlineTags) {
      inlineTags.forEach((tag) => allTags.add(stripHash(tag)));
    }
  }

  if (frontmatterTags) {
    if (Array.isArray(frontmatterTags)) {
      frontmatterTags.forEach((tag) => {
        if (typeof tag === "string") {
          allTags.add(stripHash(tag));
        }
      });
    } else if (typeof frontmatterTags === "string") {
      allTags.add(stripHash(frontmatterTags));
    }
  }

  return Array.from(allTags);
}

const EMPTY_PROPERTY_VALUES = Object.freeze([]) as unknown as string[];

export function getPropertyValuesFromNote(app: App, file: TFile, key: string): string[] {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter || !Object.hasOwn(frontmatter, key)) {
    return EMPTY_PROPERTY_VALUES;
  }
  const raw = (frontmatter as Record<string, unknown>)[key];
  const values: unknown[] = Array.isArray(raw) ? (raw as unknown[]) : [raw];
  const scalars = values.filter(isScalarPropertyValue);
  if (scalars.length === 0) {
    return EMPTY_PROPERTY_VALUES;
  }
  return scalars.map((value) => String(value));
}

function isScalarPropertyValue(value: unknown): value is string | number | boolean {
  const type = typeof value;
  return type === "string" || type === "number" || type === "boolean";
}

export function noteHasProperty(app: App, file: TFile, key: string): boolean {
  const frontmatter: Record<string, unknown> | undefined =
    app.metadataCache.getFileCache(file)?.frontmatter;
  return frontmatter != null && Object.hasOwn(frontmatter, key);
}

export function getNotesFromTags(app: App, tags: string[], noteFiles?: TFile[]): TFile[] {
  if (tags.length === 0) {
    return [];
  }

  tags = tags.map((tag) => stripHash(tag));

  const files = noteFiles && noteFiles.length > 0 ? noteFiles : getNotesFromPath(app.vault, "/");
  const filesWithTag = [];

  for (const file of files) {
    const noteTags = getTagsFromNote(app, file);
    if (tags.some((tag) => noteTags.includes(tag))) {
      filesWithTag.push(file);
    }
  }

  return filesWithTag;
}

export interface FormattedDateTime {
  fileName: string;
  display: string;
  epoch: number;
}

export const formatDateTime = (
  now: Date,
  timezone: "local" | "utc" = "local"
): FormattedDateTime => {
  const dt = timezone === "utc" ? DateTime.fromJSDate(now).toUTC() : DateTime.fromJSDate(now);

  return {
    fileName: dt.toFormat("yyyyMMdd_HHmmss"),
    display: dt.toFormat("yyyy/MM/dd HH:mm:ss"),
    epoch: dt.toMillis(),
  };
};

export async function ensureFolderExists(vault: Vault, folderPath: string): Promise<void> {
  const path = normalizePath(folderPath).replace(/^\/+/, "").replace(/\/+$/, "");
  if (!path) return;

  const parts = path.split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;

    const existing = await vault.adapter.stat(current);
    if (existing) {
      if (existing.type !== "folder") {
        throw new Error(`Path conflict: "${current}" exists as a file, expected folder.`);
      }
      continue;
    }

    await vault.adapter.mkdir(current);
  }
}

export function isTextReadableFile(file: TFile | null): boolean {
  if (!file) return false;
  return TEXT_READABLE_EXTENSIONS.includes(file.extension);
}

export async function getFileContent(file: TFile, vault: Vault): Promise<string | null> {
  if (!isTextReadableFile(file)) return null;
  return await vault.read(file);
}

export function getFileName(file: TFile): string {
  return file.basename;
}

export function isAllowedFileForNoteContext(file: TFile | null): boolean {
  if (!file) return false;
  return ALLOWED_NOTE_CONTEXT_EXTENSIONS.includes(file.extension);
}

function resolveNoteFilesFromTitles(noteTitles: string[], vault: Vault): TFile[] {
  const uniqueFiles = new Map<string, TFile>();

  noteTitles.forEach((noteTitle) => {
    const file = vault.getAbstractFileByPath(noteTitle);

    if (file instanceof TFile) {
      uniqueFiles.set(file.path, file);
    } else {
      const files = vault.getMarkdownFiles();
      const matchingFiles = files.filter((f) => f.basename === noteTitle);

      if (matchingFiles.length > 0) {
        if (isNoteTitleUnique(noteTitle, vault)) {
          uniqueFiles.set(matchingFiles[0].path, matchingFiles[0]);
        } else {
          logWarn(
            `Found multiple files with title "${noteTitle}". Expected a full path for duplicate titles.`
          );
        }
      }
    }
  });

  return Array.from(uniqueFiles.values());
}

export function extractTemplateNoteFiles(query: string, vault: Vault): TFile[] {
  const regex = /\{\[\[(.*?)\]\]\}/g;
  const matches = query.match(regex);

  if (!matches) {
    return [];
  }

  const noteTitles = matches.map((match) => match.slice(3, -3));
  return resolveNoteFilesFromTitles(noteTitles, vault);
}

function isNoteTitleUnique(title: string, vault: Vault): boolean {
  const files = vault.getMarkdownFiles();
  return files.filter((f) => f.basename === title).length === 1;
}

export function processVariableNameForNotePath(variableName: string): string {
  variableName = variableName.trim();
  if (variableName.startsWith("[[") && variableName.endsWith("]]")) {
    return `${variableName.slice(2, -2).trim()}.md`;
  }
  return variableName;
}

export function extractYoutubeVideoId(url: string): string | null {
  try {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function safeFetch(
  url: string,
  options: RequestInit & { throwOnHttpError?: boolean } = {}
): Promise<Response> {
  const { throwOnHttpError = true } = options;
  const normalizedHeaders = new Headers(options.headers);
  const headers = Object.fromEntries(normalizedHeaders.entries());

  delete (headers as Record<string, string>)["content-length"];

  logInfo("safeFetch request");

  const method = options.method?.toUpperCase() || "POST";
  const methodsWithBody = ["POST", "PUT", "PATCH"];

  const response = await requestUrl({
    url,
    contentType: headers["content-type"] ?? "application/json",
    headers: headers,
    method: method,
    ...(methodsWithBody.includes(method) &&
      typeof options.body === "string" && { body: options.body }),
    throw: false,
  });

  if (throwOnHttpError && response.status >= 400) {
    type ErrorJson = {
      detail?: { reason?: string; message?: string } | string;
      reason?: string;
      message?: string;
    };
    let errorJson: ErrorJson | null = null;
    try {
      errorJson = (
        typeof response.json === "string" ? JSON.parse(response.json) : response.json
      ) as ErrorJson;
    } catch {
      try {
        errorJson = (
          typeof response.text === "string" ? JSON.parse(response.text) : response.text
        ) as ErrorJson;
      } catch {
        errorJson = null;
      }
    }

    const error = new Error(ERROR_MESSAGES.REQUEST_FAILED(response.status)) as APIError;
    error.json = errorJson;

    const detail = errorJson && typeof errorJson.detail === "object" ? errorJson.detail : undefined;
    if (detail?.message || errorJson?.message) {
      const message = detail?.message || errorJson?.message;
      const reason = detail?.reason || errorJson?.reason;
      error.message = reason ? `${message}: ${reason}` : (message ?? "");
    } else if (errorJson?.detail) {
      error.message = JSON.stringify(errorJson.detail);
    } else if (errorJson) {
      error.message += ". " + JSON.stringify(errorJson);
    }

    throw error;
  }

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: response.status.toString(),
    headers: new Headers(response.headers),
    url: url,
    type: "basic" as ResponseType,
    redirected: false,
    bytes: () => Promise.resolve(new Uint8Array(0)),
    body: createReadableStreamFromString(response.text),
    bodyUsed: true,
    json: (): Promise<unknown> => Promise.resolve(response.json as unknown),
    text: async () => response.text,
    arrayBuffer: () => Promise.resolve(response.arrayBuffer),
    blob: () => {
      throw new Error("not implemented");
    },
    formData: () => {
      throw new Error("not implemented");
    },
    clone: () => {
      throw new Error("not implemented");
    },
  };
}

export function safeFetchNoThrow(url: string, options: RequestInit = {}): Promise<Response> {
  return safeFetch(url, { ...options, throwOnHttpError: false });
}

function createReadableStreamFromString(input: string) {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const uint8Array = encoder.encode(input);

      controller.enqueue(uint8Array);

      controller.close();
    },
  });
}

export function modelSupportsVision(model: CustomModel): boolean {
  return !!model.capabilities?.includes(ModelCapability.VISION);
}

export function cleanMessageForCopy(message: string): string {
  let cleanedMessage = message;

  cleanedMessage = removeThinkTags(cleanedMessage);

  cleanedMessage = cleanedMessage.replace(/\n{3,}/g, "\n\n");

  cleanedMessage = cleanedMessage.trim();

  return cleanedMessage;
}

export async function insertAtCursor(app: App, text: string) {
  const active = app.workspace.getActiveViewOfType(MarkdownView);
  const leaf = active?.file ? active.leaf : getChatInsertionTarget(app);
  if (!leaf || !(leaf.view instanceof MarkdownView) || !leaf.view.file) {
    app.workspace.setActiveLeaf(app.workspace.getLeaf("tab"), { focus: true });
    return;
  }
  const hasSelection = leaf.view.editor.getSelection().length > 0;
  app.workspace.revealLeaf(leaf);
  app.workspace.setActiveLeaf(leaf, { focus: true });
  await insertIntoEditor(app, text, hasSelection, leaf);
}

export async function insertIntoEditor(
  app: App,
  message: string,
  replace: boolean = false,
  targetLeaf?: WorkspaceLeaf
) {
  let leaf = targetLeaf ?? app.workspace.getMostRecentLeaf();
  if (!leaf) {
    new Notice("No active leaf found.");
    return;
  }

  if (!(leaf.view instanceof MarkdownView)) {
    leaf = app.workspace.getLeaf(false);
    await leaf.setViewState({ type: "markdown", state: leaf.view.getState() });
  }

  if (!(leaf.view instanceof MarkdownView)) {
    new Notice("Failed to open a markdown view.");
    return;
  }

  const editor = leaf.view.editor;
  const cursorFrom = editor.getCursor("from");
  const cursorTo = editor.getCursor("to");

  const cleanedMessage = cleanMessageForCopy(message);
  const cleanedLines = cleanedMessage.split("\n");

  const getEndPosition = (
    start: { line: number; ch: number },
    textLines: string[]
  ): { line: number; ch: number } => {
    const lineDelta = textLines.length - 1;
    if (lineDelta === 0) {
      return { line: start.line, ch: start.ch + (textLines[0]?.length ?? 0) };
    }
    return { line: start.line + lineDelta, ch: textLines[textLines.length - 1]?.length ?? 0 };
  };

  const insertWithEditorAPI = (): void => {
    const changeFrom = replace ? cursorFrom : cursorTo;
    editor.replaceRange(cleanedMessage, changeFrom, cursorTo);
    editor.setSelection(changeFrom, getEndPosition(changeFrom, cleanedLines));
  };

  const finalizeInsertion = (): void => {
    editor.focus();
    new Notice("Message inserted into the active note.");
  };

  const view = editor.cm;
  const isCM6View = view?.state?.doc && typeof view.dispatch === "function";

  if (!isCM6View) {
    insertWithEditorAPI();
    finalizeInsertion();
    return;
  }

  const { from, to } = view.state.selection.main;
  const changeFrom = replace ? from : to;

  const insertText = view.state.toText(cleanedMessage);
  const endOffset = changeFrom + insertText.length;

  try {
    view.dispatch({
      changes: { from: changeFrom, to, insert: insertText },
      selection: { anchor: changeFrom, head: endOffset },
    });
  } catch (e) {
    logWarn("CM6 dispatch failed, falling back to Obsidian API", e);
    insertWithEditorAPI();
  }

  finalizeInsertion();
}

export function extractTextFromChunk(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("");
  }
  return "";
}

export function removeThinkTags(text: unknown): string {
  const plainText = extractTextFromChunk(text);
  let cleanedText = plainText.replace(/<think>[\s\S]*?<\/think>/g, "");
  cleanedText = cleanedText.replace(/<think>[\s\S]*$/g, "");
  return cleanedText.trim();
}

export function randomUUID() {
  return crypto.randomUUID();
}

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  operationName: string = "Operation"
): Promise<T> {
  const { TimeoutError } = await import("@/error");

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new TimeoutError(operationName, timeoutMs));
        });
      }),
    ]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function isSourceModeOn(app: App): boolean {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view) return true;

  const state = view.getState() as { source?: boolean };
  return state.source === true;
}

export function getUtf8ByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

export function truncateToByteLimit(str: string, byteLimit: number): string {
  if (byteLimit <= 0) {
    return "";
  }

  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  if (bytes.length <= byteLimit) {
    return str;
  }

  let low = 0;
  let high = str.length;
  let result = "";

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = str.substring(0, mid);
    const candidateBytes = encoder.encode(candidate);

    if (candidateBytes.length <= byteLimit) {
      result = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}
