import { parseSkillFile } from "@/agentMode/skills/skillFormat";
import type { SkillImportRepairChange } from "@/agentMode/skills/types";

export interface RepairedSkillImport {
  content: string;
  changes: SkillImportRepairChange[];
}

const LENIENT_BOOLEANS: Record<string, boolean> = {
  true: true,
  yes: true,
  on: true,
  "1": true,
  false: false,
  no: false,
  off: false,
  "0": false,
};

// 描述值含 “: ” 且未加引号：与严格校验器同源的判定，补双引号即消除歧义。
// https://github.com/ItsDalk-Lane/Scribe/issues/44
function repairUnquotedDescription(yaml: string, changes: SkillImportRepairChange[]): string {
  const lines = yaml.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^(description[ \t]*:[ \t]*)([^'"\r\n]*: [^\r\n]*)$/);
    if (!match) continue;
    const next = `${match[1]}${JSON.stringify(match[2])}`;
    changes.push({ before: lines[index], after: next });
    lines[index] = next;
  }
  return lines.join("\n");
}

// 开关字段以 yes/no/on/off/1/0 或字符串布尔书写：归一为 YAML 布尔标量；
// 已是裸布尔的行直接跳过，避免把合法行记成假变更。
// https://github.com/ItsDalk-Lane/Scribe/issues/44
function repairLenientBooleans(yaml: string, changes: SkillImportRepairChange[]): string {
  const lines = yaml.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(
      /^((?:disable-model-invocation|user-invocable)[ \t]*:[ \t]*)(.+)$/
    );
    if (!match) continue;
    const raw = match[2].trim();
    if (raw === "true" || raw === "false") continue;
    const unquoted = raw.replace(/^['"]|['"]$/g, "");
    const normalized = LENIENT_BOOLEANS[unquoted.toLowerCase()];
    if (normalized === undefined) continue;
    const next = `${match[1]}${normalized}`;
    changes.push({ before: lines[index], after: next });
    lines[index] = next;
  }
  return lines.join("\n");
}

// 仅处理公认安全的两类格式瑕疵；修复副本必须通过严格校验，否则维持拒收。
// https://github.com/ItsDalk-Lane/Scribe/issues/44
export function attemptSkillImportRepair(content: string): RepairedSkillImport | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!match) return null;
  const changes: SkillImportRepairChange[] = [];
  let yaml = match[1] ?? "";
  yaml = repairUnquotedDescription(yaml, changes);
  yaml = repairLenientBooleans(yaml, changes);
  if (!changes.length) return null;
  const body = match[2] ?? "";
  const repaired = `---\n${yaml.replace(/\n+$/, "")}\n---\n${body}`;
  try {
    parseSkillFile(repaired);
  } catch {
    return null;
  }
  return { content: repaired, changes };
}
