import type { SkillPackage, SkillPackageFile } from "@/agentMode/skills/types";
import { NAME_MAX, parseSkillFile, serializeSkillFile } from "@/agentMode/skills/skillFormat";
import { t } from "@/lib/i18n";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { isMap, parseDocument } from "yaml";

export const SKILL_IMPORT_MAX_BYTES = 50 * 1024 * 1024;
export const SKILL_IMPORT_MAX_FILES = 2000;
const MAX_IMPORT_DIRECTORIES = 10000;

interface ImportEntry {
  path: string;
  size: number;
  read: () => Promise<Uint8Array>;
}

export interface PreparedSkillDescription {
  name: string;
  description: string;
  content: string;
  renamedFrom?: string;
}

export function normalizeSkillImportName(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, NAME_MAX)
    .replace(/-+$/, "");
  if (!normalized) throw new Error(t("The skill name must contain English letters or numbers."));
  return normalized;
}

export function prepareSkillImportDescription(
  content: string,
  folderName?: string
): PreparedSkillDescription {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/.exec(content);
  if (!match) throw new Error(t("SKILL.md must start with a metadata block."));
  const doc = parseDocument(match[1], { keepSourceTokens: true, intAsBigInt: true });
  const originalName = isMap(doc.contents) ? doc.get("name") : undefined;
  if (doc.errors.length || typeof originalName !== "string" || !originalName.trim()) {
    throw new Error(t("Skill metadata is invalid or its name is missing."));
  }
  const name = normalizeSkillImportName(folderName ?? originalName);
  if (normalizeSkillImportName(originalName) !== name) {
    throw new Error(t("The skill name does not match its folder."));
  }
  const normalized = serializeSkillFile({ doc, yaml: match[1], body: match[2] ?? "" }, { name });
  let parsed;
  try {
    parsed = parseSkillFile(normalized, name);
  } catch (error) {
    throw new Error(
      t("The imported skill is invalid: {reason}", {
        reason: error instanceof Error ? error.message : String(error),
      })
    );
  }
  return {
    name,
    description: parsed.frontmatter.description,
    content: normalized,
    ...(name !== (folderName ?? originalName) ? { renamedFrom: folderName ?? originalName } : {}),
  };
}

function assertSafeImportPath(path: string): void {
  if (
    !path ||
    path.startsWith("/") ||
    /[\\:]/.test(path) ||
    path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(t("The skill contains an unsafe file path: {path}", { path }));
  }
}

function checkImportLimits(count: number, bytes: number): void {
  if (count > SKILL_IMPORT_MAX_FILES || bytes > SKILL_IMPORT_MAX_BYTES) {
    throw new Error(t("A skill can contain at most 2000 files and 50 MB."));
  }
}

function locateSkillDescription(entries: readonly ImportEntry[]): ImportEntry {
  const descriptions = entries.filter(
    (entry) => entry.path.split("/").pop()?.toLowerCase() === "skill.md"
  );
  const direct = descriptions.filter((entry) => !entry.path.includes("/"));
  const nested = descriptions.filter((entry) => entry.path.split("/").length === 2);
  const matches = direct.length ? direct : nested;
  if (matches.length !== 1) {
    throw new Error(
      t("Choose a folder or ZIP containing exactly one SKILL.md, directly or one folder below.")
    );
  }
  return matches[0];
}

async function buildSkillPackage(
  entries: ImportEntry[],
  source: SkillPackage["source"],
  rootFolderName: string | undefined,
  signal?: AbortSignal
): Promise<SkillPackage> {
  const description = locateSkillDescription(entries);
  const prefix = description.path.slice(0, description.path.lastIndexOf("/") + 1);
  const folderName = prefix ? prefix.slice(0, -1) : rootFolderName;
  const raw = await description.read();
  if (raw.byteLength !== description.size)
    throw new Error(t("The source skill changed while it was being read. Try importing it again."));
  signal?.throwIfAborted();
  const prepared = prepareSkillImportDescription(
    new TextDecoder("utf-8", { fatal: true }).decode(raw),
    folderName
  );
  const files: SkillPackageFile[] = [
    { path: "SKILL.md", data: new TextEncoder().encode(prepared.content) },
  ];
  let bytes = files[0].data.byteLength;
  checkImportLimits(1, bytes);
  for (const entry of entries
    .filter((item) => item !== description && item.path.startsWith(prefix))
    .sort((a, b) => a.path.localeCompare(b.path))) {
    signal?.throwIfAborted();
    const data = await entry.read();
    if (data.byteLength !== entry.size)
      throw new Error(
        t("The source skill changed while it was being read. Try importing it again.")
      );
    bytes += data.byteLength;
    checkImportLimits(files.length + 1, bytes);
    files.push({ path: entry.path.slice(prefix.length), data });
  }
  return { name: prepared.name, files, source };
}

async function readBoundedFile(path: string, signal?: AbortSignal): Promise<Uint8Array> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const handle = await fs.promises.open(
    path,
    fs.constants.O_RDONLY | (process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW)
  );
  try {
    const original = await handle.stat();
    if (!original.isFile()) throw new Error(t("Skill links and special files cannot be imported."));
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      signal?.throwIfAborted();
      const chunk = new Uint8Array(64 * 1024);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      checkImportLimits(1, bytes);
      chunks.push(chunk.slice(0, bytesRead));
    }
    const current = await handle.stat();
    if (current.size !== original.size || current.mtimeMs !== original.mtimeMs)
      throw new Error(
        t("The source skill changed while it was being read. Try importing it again.")
      );
    return new Uint8Array(Buffer.concat(chunks));
  } finally {
    await handle.close();
  }
}

async function readFolderEntries(root: string, signal?: AbortSignal): Promise<ImportEntry[]> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const nodePath = requireNodeModule<typeof import("node:path")>("path");
  const entries: ImportEntry[] = [];
  let bytes = 0;
  let directories = 0;
  const seen = new Set<string>();
  const visit = async (directory: string, prefix: string): Promise<void> => {
    signal?.throwIfAborted();
    if (++directories > MAX_IMPORT_DIRECTORIES)
      throw new Error(t("The skill contains too many folders."));
    for (const name of (await fs.promises.readdir(directory)).sort()) {
      const relative = `${prefix}${name}`;
      assertSafeImportPath(relative);
      const key = relative.toLowerCase();
      if (seen.has(key)) throw new Error(t("The skill contains duplicate file paths."));
      seen.add(key);
      const absolute = nodePath.join(directory, name);
      const stat = await fs.promises.lstat(absolute);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        throw new Error(t("Skill links and special files cannot be imported."));
      }
      if (stat.isDirectory()) await visit(absolute, `${relative}/`);
      else {
        bytes += stat.size;
        checkImportLimits(entries.length + 1, bytes);
        entries.push({
          path: relative,
          size: stat.size,
          read: async () => {
            const real = await fs.promises.realpath(absolute);
            const rel = nodePath.relative(root, real);
            if (rel.startsWith(`..${nodePath.sep}`) || rel === ".." || nodePath.isAbsolute(rel)) {
              throw new Error(t("Skill links and special files cannot be imported."));
            }
            const current = await fs.promises.lstat(absolute);
            if (
              current.isSymbolicLink() ||
              current.dev !== stat.dev ||
              current.ino !== stat.ino ||
              current.size !== stat.size ||
              current.mtimeMs !== stat.mtimeMs
            )
              throw new Error(
                t("The source skill changed while it was being read. Try importing it again.")
              );
            return readBoundedFile(real, signal);
          },
        });
      }
    }
  };
  await visit(root, "");
  return entries;
}

async function readZipPackage(
  path: string,
  source: SkillPackage["source"],
  signal?: AbortSignal
): Promise<SkillPackage> {
  const yauzl = await import("yauzl");
  const archive = await yauzl.openPromise(path, {
    autoClose: false,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  const entries: ImportEntry[] = [];
  const seen = new Set<string>();
  const directories = new Set<string>();
  let bytes = 0;
  try {
    if (archive.entryCount > SKILL_IMPORT_MAX_FILES + MAX_IMPORT_DIRECTORIES)
      throw new Error(t("The skill contains too many folders."));
    for await (const entry of archive.eachEntry()) {
      signal?.throwIfAborted();
      const directory = entry.fileName.endsWith("/");
      const relative = directory ? entry.fileName.slice(0, -1) : entry.fileName;
      assertSafeImportPath(relative);
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (
        (mode && mode !== (directory ? 0o040000 : 0o100000)) ||
        (entry.externalFileAttributes & 0x400) !== 0 ||
        entry.isEncrypted() ||
        !entry.canDecodeFileData()
      ) {
        throw new Error(
          t("ZIP links, special files, encryption or unsupported compression cannot be imported.")
        );
      }
      const key = relative.toLowerCase();
      if (seen.has(key)) throw new Error(t("The skill contains duplicate file paths."));
      seen.add(key);
      if (directory) {
        directories.add(key);
        if (directories.size > MAX_IMPORT_DIRECTORIES)
          throw new Error(t("The skill contains too many folders."));
      } else {
        bytes += entry.uncompressedSize;
        checkImportLimits(entries.length + 1, bytes);
        entries.push({
          path: relative,
          size: entry.uncompressedSize,
          read: async () => {
            const stream = await archive.openReadStreamPromise(entry);
            const chunks: Uint8Array[] = [];
            let actualBytes = 0;
            const abort = (): void => {
              stream.destroy(new Error(t("Skill import was cancelled.")));
            };
            signal?.addEventListener("abort", abort, { once: true });
            try {
              for await (const chunk of stream as AsyncIterable<Uint8Array>) {
                signal?.throwIfAborted();
                actualBytes += chunk.length;
                checkImportLimits(1, actualBytes);
                chunks.push(chunk);
              }
              return new Uint8Array(Buffer.concat(chunks));
            } finally {
              signal?.removeEventListener("abort", abort);
              stream.destroy();
            }
          },
        });
      }
    }
    for (const entry of entries) {
      const parts = entry.path.toLowerCase().split("/");
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i).join("/");
        if (seen.has(parent) && !directories.has(parent))
          throw new Error(t("The skill contains duplicate file paths."));
      }
    }
    return await buildSkillPackage(entries, source, undefined, signal);
  } finally {
    archive.close();
  }
}

export async function readSkillPackage(
  path: string,
  kind: "local" | "system",
  signal?: AbortSignal
): Promise<SkillPackage> {
  signal?.throwIfAborted();
  try {
    const fs = requireNodeModule<typeof import("node:fs")>("fs");
    const nodePath = requireNodeModule<typeof import("node:path")>("path");
    const origin = await fs.promises.realpath(path);
    const source = { kind, origin, displayPath: path };
    const stat = await fs.promises.stat(origin);
    if (stat.isDirectory()) {
      const entries = await readFolderEntries(origin, signal);
      return await buildSkillPackage(entries, source, nodePath.basename(origin), signal);
    }
    if (kind === "local" && stat.isFile() && nodePath.extname(origin).toLowerCase() === ".zip") {
      return await readZipPackage(origin, source, signal);
    }
    throw new Error(t("Choose a skill folder or a ZIP file."));
  } catch (error) {
    signal?.throwIfAborted();
    throw new Error(
      t("Could not import this skill: {reason}", {
        reason: error instanceof Error ? error.message : String(error),
      })
    );
  }
}
