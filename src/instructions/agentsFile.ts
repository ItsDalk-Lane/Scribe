import { logWarn } from "@/logger";
import { ensureFolderExists } from "@/utils";
import { hasCaseInsensitiveFilesystem } from "@/utils/vaultAdapterUtils";
import { validateProjectWorkspace } from "@/projects/projectWorkspace";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { t } from "@/lib/i18n";
import { App, FileSystemAdapter, Notice, normalizePath, TFile, TFolder } from "obsidian";

export const AGENTS_FILE_NAME = "AGENTS.md";
const GENERATED_MIRROR_HEADER =
  /^(\uFEFF?)<!-- scribe:generated-agents-mirror [^\r\n]* -->\r?\n\r?\n/;

export async function agentsFileIsUninitialized(app: App, folderPath: string): Promise<boolean> {
  const content = await readIfPresent(app, childPath(folderPath, AGENTS_FILE_NAME));
  return content === null || GENERATED_MIRROR_HEADER.test(content);
}

export async function readAgentsFile(app: App, folderPath: string): Promise<string> {
  const content = await readIfPresent(app, childPath(folderPath, AGENTS_FILE_NAME));
  return (content ?? "").replace(GENERATED_MIRROR_HEADER, "$1");
}

export async function writeAgentsFile(
  app: App,
  folderPath: string,
  content: string,
  expectedContent?: string
): Promise<void> {
  const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
  const existing = findCachedInstructionFile(app, agentsPath);
  const conflict = "项目说明已被其他窗口或同步更新，请核对后重试。";
  if (existing) {
    if (expectedContent !== undefined) {
      await app.vault.process(existing, (current) => {
        if (current.replace(GENERATED_MIRROR_HEADER, "$1") !== expectedContent)
          throw new Error(conflict);
        return content;
      });
    } else if ((await app.vault.read(existing)) !== content) {
      await app.vault.modify(existing, content);
    }
    return;
  }
  const previous = await readIfPresent(app, agentsPath);
  if (previous !== null) {
    await app.vault.adapter.process(agentsPath, (current) => {
      if (
        expectedContent !== undefined &&
        current.replace(GENERATED_MIRROR_HEADER, "$1") !== expectedContent
      )
        throw new Error(conflict);
      return content;
    });
    return;
  }
  if (expectedContent !== undefined && expectedContent !== "") throw new Error(conflict);
  if (!content.trim()) return;
  await ensureFile(app, agentsPath, content, true);
}

export interface InstructionFilesSnapshot {
  agents: string | null;
}

export async function captureInstructionFiles(
  app: App,
  folderPath: string
): Promise<InstructionFilesSnapshot> {
  return {
    agents: await readIfPresent(app, childPath(folderPath, AGENTS_FILE_NAME)),
  };
}

export async function restoreInstructionFiles(
  app: App,
  folderPath: string,
  snapshot: InstructionFilesSnapshot,
  writtenContent: string
): Promise<void> {
  if (snapshot.agents === null) return;
  const filePath = childPath(folderPath, AGENTS_FILE_NAME);
  const file = findCachedInstructionFile(app, filePath);
  const restore = (current: string): string => {
    if (current !== writtenContent)
      throw new Error("项目说明已被其他窗口或同步更新，已保留最新内容，请核对后重试。");
    return snapshot.agents ?? "";
  };
  if (file) await app.vault.process(file, restore);
  else if ((await readIfPresent(app, filePath)) !== null)
    await app.vault.adapter.process(filePath, restore);
}

async function readIfPresent(app: App, filePath: string): Promise<string | null> {
  const file = findCachedInstructionFile(app, filePath);
  if (file) return app.vault.read(file);
  if (!(await app.vault.adapter.exists(filePath))) return null;
  if (app.vault.adapter instanceof FileSystemAdapter) {
    const folderPath = filePath.split("/").slice(0, -1).join("/");
    await validateProjectWorkspace(app, folderPath);
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    const path = requireNodeModule<typeof import("node:path")>("path");
    const root = await fs.realpath(app.vault.adapter.getBasePath());
    const target = await fs.realpath(app.vault.adapter.getFullPath(filePath));
    const relative = path.relative(root, target);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`))
      throw new Error("项目说明文件不能通过链接指向库外。");
  }
  return app.vault.adapter.read(filePath);
}

export async function ensureAgentsFile(
  app: App,
  folderPath: string,
  initialContent: string
): Promise<TFile | null> {
  const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
  return ensureFile(app, agentsPath, initialContent);
}

export async function ensureAgentsFileForDiscovery(app: App, folderPath: string): Promise<void> {
  try {
    const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
    await readIfPresent(app, agentsPath);
  } catch (error) {
    logWarn(
      `[Instructions] Failed to ensure AGENTS.md for "${folderPath || "<vault root>"}"`,
      error
    );
  }
}

export async function openAgentsFile(app: App, folderPath: string): Promise<void> {
  const file = await ensureAgentsFile(app, folderPath, "");
  if (file) {
    await app.workspace.getLeaf(true).openFile(file);
  } else if (app.vault.adapter instanceof FileSystemAdapter) {
    await openWithSystemDefault(
      app.vault.adapter.getFullPath(childPath(folderPath, AGENTS_FILE_NAME))
    );
  } else {
    new Notice(
      t("Open this file manually: {path}", { path: childPath(folderPath, AGENTS_FILE_NAME) })
    );
  }
}

function childPath(folderPath: string, fileName: string): string {
  return normalizePath(folderPath ? `${folderPath}/${fileName}` : fileName);
}

export function findCachedInstructionFile(app: App, filePath: string): TFile | null {
  const cached = app.vault.getAbstractFileByPath(filePath);
  return cached instanceof TFile ? cached : findCasedSibling(app, filePath);
}

function findCasedSibling(app: App, filePath: string): TFile | null {
  if (!hasCaseInsensitiveFilesystem()) return null;
  const slash = filePath.lastIndexOf("/");
  const folderPath = slash === -1 ? "" : filePath.slice(0, slash);
  const name = (slash === -1 ? filePath : filePath.slice(slash + 1)).toLowerCase();
  const folder = folderPath ? app.vault.getAbstractFileByPath(folderPath) : app.vault.getRoot();
  if (!(folder instanceof TFolder)) return null;
  return (
    folder.children.find(
      (child): child is TFile => child instanceof TFile && child.name.toLowerCase() === name
    ) ?? null
  );
}

async function ensureFile(
  app: App,
  filePath: string,
  content: string,
  requireMissing = false
): Promise<TFile | null> {
  const existing = findCachedInstructionFile(app, filePath);
  const adapter = app.vault.adapter;
  if (existing || (await adapter.exists(filePath))) {
    if (requireMissing) throw new Error("项目说明已由其他操作创建，请重新打开后核对。");
    if (!existing) await readIfPresent(app, filePath);
    return existing;
  }
  const folderPath = filePath.split("/").slice(0, -1).join("/");
  if (adapter instanceof FileSystemAdapter) await validateProjectWorkspace(app, folderPath, true);
  if (folderPath) await ensureFolderExists(app.vault, folderPath);
  const hidden = folderPath.split("/").some((segment) => segment.startsWith("."));
  if (!hidden) return app.vault.create(filePath, content);
  if (adapter instanceof FileSystemAdapter) {
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    await fs.writeFile(adapter.getFullPath(filePath), content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } else {
    await adapter.write(filePath, content);
  }
  return null;
}
