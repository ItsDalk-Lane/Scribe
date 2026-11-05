import { logError, logInfo, logWarn } from "@/logger";
import { joinPosix, parentDir } from "@/utils/pathUtils";
import { sha256 } from "@/utils/hash";
import { getBuiltinSkillContentHash, getBuiltinSkillVersion } from "./builtinOwnership";
import { BUILTIN_SKILLS, type BuiltinSkill } from "@/builtinSkills/builtinSkills";

export interface BuiltinSeedFs {
  exists(relPath: string): Promise<boolean>;
  read(relPath: string): Promise<string>;
  write(relPath: string, content: string): Promise<void>;
  mkdir(relPath: string): Promise<void>;
  removeDir(relPath: string): Promise<void>;
}

export interface SeedBuiltinSkillsOptions {
  skillsFolderRelPath: string;
  fs: BuiltinSeedFs;
  skills?: readonly BuiltinSkill[];
  enabledAgents?: Readonly<Record<string, readonly string[]>>;
}

export type BuiltinDiskState = "seeded" | "stale" | "collision" | "absent" | "failed";

export async function inspectBuiltinSkill(
  skillsFolderRelPath: string,
  name: string,
  fs: BuiltinSeedFs,
  expectedVersion?: number
): Promise<BuiltinDiskState> {
  const skillMdPath = joinPosix(joinPosix(skillsFolderRelPath, name), "SKILL.md");
  try {
    if (!(await fs.exists(skillMdPath))) return "absent";
    const version = getBuiltinSkillVersion(await fs.read(skillMdPath));
    if (version === null) return "collision";
    if (expectedVersion !== undefined && version < expectedVersion) return "stale";
    return "seeded";
  } catch {
    return "failed";
  }
}

const ENABLED_AGENTS_RE = /^([ \t]*scribe-enabled-agents:[ \t]*)(.*)$/m;
const CONTENT_HASH_RE = /^[ \t]*scribe-content-hash:[ \t]*.*$\n?/m;
const BUILTIN_VERSION_RE = /^([ \t]*scribe-builtin-version:[ \t]*.*\n)/m;

// 指纹覆盖 SKILL.md 全文但排除两处易变行（启用行、哈希行自身），
// 使"改启用开关"不算用户编辑，改其余任何内容都算。
// https://github.com/ItsDalk-Lane/Scribe/issues/19
function skillFingerprint(content: string): string {
  return sha256(content.replace(CONTENT_HASH_RE, "").replace(ENABLED_AGENTS_RE, ""));
}

function withContentHashLine(content: string): string {
  const withoutHash = content.replace(CONTENT_HASH_RE, "");
  const anchor = BUILTIN_VERSION_RE.exec(withoutHash);
  if (!anchor) return content;
  const indent = anchor[1].match(/^[ \t]*/)?.[0] ?? "";
  return withoutHash.replace(
    BUILTIN_VERSION_RE,
    `${anchor[1]}${indent}scribe-content-hash: "${skillFingerprint(withoutHash)}"\n`
  );
}

function preserveEnabledAgents(existingMd: string, bundledMd: string): string {
  const existing = existingMd.match(ENABLED_AGENTS_RE);
  if (!existing) return bundledMd;
  return bundledMd.replace(ENABLED_AGENTS_RE, `$1${existing[2]}`);
}

async function ensureDir(fs: BuiltinSeedFs, relPath: string): Promise<void> {
  const segments = relPath
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!(await fs.exists(current))) {
      await fs.mkdir(current);
    }
  }
}

export async function seedBuiltinSkills(
  options: SeedBuiltinSkillsOptions
): Promise<{ seeded: string[] }> {
  const { skillsFolderRelPath, fs } = options;
  const skills = options.skills ?? BUILTIN_SKILLS;
  const seeded: string[] = [];

  for (const skill of skills) {
    const dir = joinPosix(skillsFolderRelPath, skill.name);
    const skillMdPath = joinPosix(dir, "SKILL.md");

    let existingContent: string | null = null;
    let current = false;
    if (await fs.exists(skillMdPath)) {
      try {
        existingContent = await fs.read(skillMdPath);
        const existing = getBuiltinSkillVersion(existingContent);
        if (existing === null) continue;
        if (existing >= skill.version) {
          current = await Promise.all(
            skill.files.map((f) => fs.exists(joinPosix(dir, f.path)))
          ).then((results) => results.every(Boolean));
          // 版本已最新但缺基线（更早版本装下的）：补写基线，不动其他内容。
          // https://github.com/ItsDalk-Lane/Scribe/issues/19
          if (current && existingContent !== null && !getBuiltinSkillContentHash(existingContent)) {
            const withHash = withContentHashLine(existingContent);
            if (withHash !== existingContent) await fs.write(skillMdPath, withHash);
          }
        }
      } catch (e) {
        logError(`[Skills] could not read builtin skill ${skill.name} for version check`, e);
        continue;
      }
    }

    const effectiveAgents = options.enabledAgents?.[skill.name];
    if (current && existingContent !== null && effectiveAgents !== undefined) {
      const next = existingContent.replace(
        ENABLED_AGENTS_RE,
        `$1${effectiveAgents.join(", ") || '""'}`
      );
      if (next !== existingContent) await fs.write(skillMdPath, next);
    }
    if (!current) {
      try {
        if (existingContent !== null) {
          const baseline = getBuiltinSkillContentHash(existingContent);
          if (baseline === null) {
            // 缺少可靠基线时跳过版本更新，避免整目录重建。
            // https://github.com/ItsDalk-Lane/Scribe/issues/19
            const withHash = withContentHashLine(existingContent);
            if (withHash !== existingContent) await fs.write(skillMdPath, withHash);
            logWarn(
              `[Skills] builtin skill ${skill.name} lacked a verifiable content baseline, so the v${skill.version} update was skipped`
            );
            continue;
          }
          if (skillFingerprint(existingContent) !== baseline) {
            logWarn(
              `[Skills] builtin skill ${skill.name} has local edits; keeping them and skipping the v${skill.version} update`
            );
            continue;
          }
        }
        if (existingContent !== null) await fs.removeDir(dir);
        await ensureDir(fs, dir);
        const skillMd =
          effectiveAgents !== undefined
            ? skill.skillMd.replace(ENABLED_AGENTS_RE, `$1${effectiveAgents.join(", ") || '""'}`)
            : existingContent
              ? preserveEnabledAgents(existingContent, skill.skillMd)
              : skill.skillMd;
        for (const file of skill.files) {
          const filePath = joinPosix(dir, file.path);
          await ensureDir(fs, parentDir(filePath));
          await fs.write(filePath, file.content);
        }
        await fs.write(skillMdPath, withContentHashLine(skillMd));
        seeded.push(skill.name);
      } catch (e) {
        logError(`[Skills] failed to seed builtin skill ${skill.name}`, e);
        continue;
      }
    }
  }

  if (seeded.length > 0) {
    logInfo(`[Skills] seeded builtin skills: ${seeded.join(", ")}`);
  }
  return { seeded };
}
