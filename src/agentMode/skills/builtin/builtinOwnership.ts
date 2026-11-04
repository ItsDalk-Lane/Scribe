import { parseDocument } from "yaml";

export function getBuiltinSkillVersion(content: string): number | null {
  // Only frontmatter counts: a marker in a user skill's body must never authorize replacement or deletion.
  // https://github.com/logancyang/obsidian-copilot/issues/3022
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!frontmatter) return null;
  const doc = parseDocument(frontmatter[1]);
  if (doc.errors.length > 0) return null;
  const marker = doc.getIn(["metadata", "copilot-builtin-version"]);
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
  const hash = doc.getIn(["metadata", "copilot-content-hash"]);
  return typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}
