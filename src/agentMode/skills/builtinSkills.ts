import builtinSkillAssets from "@/agentMode/skills/builtinSkillAssets";
import type { SkillPackage } from "@/agentMode/skills/types";

export const SKILL_CREATOR_SKILL_NAME = "skill-creator";

export const BUILTIN_SKILL_PROVENANCE = Object.freeze(
  builtinSkillAssets.map(({ name, repository, revision, upstreamPath, license, adaptedFiles }) =>
    Object.freeze({
      name,
      repository,
      revision,
      upstreamPath,
      license,
      adaptedFiles: Object.freeze([...adaptedFiles]),
      sourceUrl: `${repository}/tree/${revision}/${upstreamPath}`,
    })
  )
);

export function getBuiltinSkillPackages(): SkillPackage[] {
  const encoder = new TextEncoder();
  return builtinSkillAssets.map((asset) => ({
    name: asset.name,
    source: {
      kind: "builtin",
      origin: `${asset.repository}/tree/main/${asset.upstreamPath}`,
      version: asset.revision,
    },
    files: asset.files.map((file) => ({ path: file.path, data: encoder.encode(file.content) })),
  }));
}
