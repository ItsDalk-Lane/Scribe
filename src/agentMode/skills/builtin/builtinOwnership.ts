import { parseDocument } from "yaml";

// 命名重置把标记从 copilot- 前缀改为 scribe- 前缀；旧前缀是此前版本写下的
// 受管标记，双读让已安装用户的内置技能仍被识别为受管并继续更新。
// https://github.com/ItsDalk-Lane/Scribe/issues/29
function readMarker(doc: ReturnType<typeof parseDocument>, keys: string[]): unknown {
  for (const key of keys) {
    const value = doc.getIn(["metadata", key]);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

export function getBuiltinSkillVersion(content: string): number | null {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!frontmatter) return null;
  const doc = parseDocument(frontmatter[1]);
  if (doc.errors.length > 0) return null;
  const marker = readMarker(doc, ["scribe-builtin-version", "copilot-builtin-version"]);
  if ((typeof marker !== "string" && typeof marker !== "number") || !/^\d+$/.test(String(marker)))
    return null;
  const version = Number(marker);
  return Number.isSafeInteger(version) ? version : null;
}

// 更新内置技能前先比对正文指纹，本地有编辑就跳过覆盖，不再静默丢弃用户修改。
// https://github.com/ItsDalk-Lane/Scribe/issues/19
export function getBuiltinSkillContentHash(content: string): string | null {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!frontmatter) return null;
  const doc = parseDocument(frontmatter[1]);
  if (doc.errors.length > 0) return null;
  const hash = readMarker(doc, ["scribe-content-hash", "copilot-content-hash"]);
  return typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}
