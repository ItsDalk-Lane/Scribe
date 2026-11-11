import type { ProjectConfig } from "@/aiParams";
import { logWarn } from "@/logger";
import {
  PROJECT_CONFIG_FILE_NAME,
  SCRIBE_PROJECT_CREATED,
  SCRIBE_PROJECT_DESCRIPTION,
  SCRIBE_PROJECT_EXCLUSIONS,
  SCRIBE_PROJECT_ID,
  SCRIBE_PROJECT_INCLUSIONS,
  SCRIBE_PROJECT_LAST_USED,
  SCRIBE_PROJECT_NAME,
  SCRIBE_PROJECT_WEB_URLS,
  SCRIBE_PROJECT_YOUTUBE_URLS,
  SCRIBE_PROJECT_WORKSPACE,
} from "@/projects/constants";
import {
  getProjectFolderNameFromConfigPath,
  getProjectsFolder,
  splitUrlsStringToArray,
} from "@/projects/projectPaths";
import { normalizeProjectWorkspace } from "@/projects/projectWorkspace";
import { updateCachedProjectRecords } from "@/projects/state";
import type { ProjectFileRecord } from "@/projects/type";
import { parseYaml, type App } from "obsidian";
import { assertScribePath } from "@/utils/vaultFileStore";
import { parseDocument, stringify } from "yaml";

export {
  getProjectAnchorFromConfigPath,
  getProjectsFolder,
  getProjectsUnsupportedFolder,
  getProjectFolderPath,
  getProjectConfigFilePath,
  isProjectConfigFile,
  sanitizeVaultPathSegment,
  readFrontmatterFieldFromFile,
} from "@/projects/projectPaths";

export function serializeProjectConfig(project: ProjectConfig, previous?: string): string {
  const metadata = {
    [SCRIBE_PROJECT_ID]: project.id,
    [SCRIBE_PROJECT_NAME]: project.name,
    [SCRIBE_PROJECT_WORKSPACE]: project.workspacePath,
    [SCRIBE_PROJECT_DESCRIPTION]: project.description || "",
    [SCRIBE_PROJECT_INCLUSIONS]: project.contextSource.inclusions || "",
    [SCRIBE_PROJECT_EXCLUSIONS]: project.contextSource.exclusions || "",
    [SCRIBE_PROJECT_WEB_URLS]: splitUrlsStringToArray(project.contextSource.webUrls || ""),
    [SCRIBE_PROJECT_YOUTUBE_URLS]: splitUrlsStringToArray(project.contextSource.youtubeUrls || ""),
    [SCRIBE_PROJECT_CREATED]: project.created,
    [SCRIBE_PROJECT_LAST_USED]: project.UsageTimestamps,
  };
  let header = stringify(metadata);
  if (previous !== undefined) {
    const frontmatter = previous
      .replace(/^\uFEFF/, "")
      .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!frontmatter) throw new Error("项目配置已被其他操作更改，请刷新后重试。");
    const document = parseDocument(frontmatter[1]);
    if (document.errors.length > 0) throw new Error("项目配置无法读取，未覆盖现有内容。");
    for (const [key, value] of Object.entries(metadata)) document.set(key, value);
    header = document.toString();
  }
  return `---\n${header}---\n${project.systemPrompt || ""}`;
}

export async function parseProjectConfigFile(
  app: App,
  file: string | { path: string },
  contents?: string
): Promise<ProjectFileRecord | null> {
  const filePath = typeof file === "string" ? file : file.path;
  const folderName = getProjectFolderNameFromConfigPath(filePath);
  if (!folderName) return null;
  await assertScribePath(app.vault, filePath);
  const raw = contents ?? (await app.vault.adapter.read(filePath));
  const match = raw.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const data = parseYaml(match[1]) as Record<string, unknown> | null;
  if (
    !data ||
    typeof data !== "object" ||
    data[SCRIBE_PROJECT_ID] !== folderName ||
    typeof data[SCRIBE_PROJECT_NAME] !== "string" ||
    typeof data[SCRIBE_PROJECT_WORKSPACE] !== "string"
  )
    return null;
  const text = (key: string): string => (typeof data[key] === "string" ? data[key] : "");
  const urls = (key: string): string =>
    Array.isArray(data[key])
      ? (data[key] as unknown[])
          .filter((value): value is string => typeof value === "string")
          .join("\n")
      : text(key);
  const timestamp = (key: string): number =>
    typeof data[key] === "number" && Number.isFinite(data[key]) && data[key] > 0 ? data[key] : 0;
  return {
    project: {
      id: folderName,
      name: text(SCRIBE_PROJECT_NAME),
      workspacePath: normalizeProjectWorkspace(text(SCRIBE_PROJECT_WORKSPACE), app.vault.configDir),
      description: text(SCRIBE_PROJECT_DESCRIPTION),
      systemPrompt: raw.slice(match[0].length),
      contextSource: {
        inclusions: text(SCRIBE_PROJECT_INCLUSIONS),
        exclusions: text(SCRIBE_PROJECT_EXCLUSIONS),
        webUrls: urls(SCRIBE_PROJECT_WEB_URLS),
        youtubeUrls: urls(SCRIBE_PROJECT_YOUTUBE_URLS),
      },
      created: timestamp(SCRIBE_PROJECT_CREATED),
      UsageTimestamps: timestamp(SCRIBE_PROJECT_LAST_USED),
    },
    filePath,
    folderName,
  };
}

export async function scanAllProjectConfigFiles(app: App): Promise<ProjectFileRecord[]> {
  const adapter = app.vault.adapter;
  const root = getProjectsFolder();
  await assertScribePath(app.vault, root);
  if (!(await adapter.exists(root))) return [];
  const records: ProjectFileRecord[] = [];
  const { folders } = await adapter.list(root);
  for (const folder of folders.sort()) {
    const filePath = `${folder}/${PROJECT_CONFIG_FILE_NAME}`;
    if (!(await adapter.exists(filePath))) continue;
    try {
      const record = await parseProjectConfigFile(app, filePath);
      if (record) records.push(record);
    } catch (error) {
      logWarn(`无法读取项目配置：${filePath}`, error);
    }
  }
  return records;
}

export async function loadAllProjects(app: App): Promise<ProjectFileRecord[]> {
  const records = await scanAllProjectConfigFiles(app);
  updateCachedProjectRecords(records);
  return records;
}
