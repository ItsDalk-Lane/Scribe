import { isMap, isSeq, isScalar } from "yaml";
import { sha256 } from "@/utils/hash";
import { logWarn } from "@/logger";
import { basename, joinPosix } from "@/utils/pathUtils";
import { mapWithConcurrency } from "./concurrency";
import { parseSkillFile, SkillFormatError } from "./skillFormat";
import type { RejectedSkill, Skill, SkillDiscoveryResult } from "./types";

const DISCOVERY_CONCURRENCY = 16;

export interface SkillsFsAdapter {
  exists(relPath: string): Promise<boolean>;
  list(relPath: string): Promise<{ files: string[]; folders: string[] }>;
  read(relPath: string): Promise<string>;
}

export interface DiscoverManagedSkillsOptions {
  skillsFolderRelPath: string;
  skillsFolderAbsPath: string | null;
  adapter: SkillsFsAdapter;
}

export async function discoverManagedSkills(
  options: DiscoverManagedSkillsOptions
): Promise<SkillDiscoveryResult<Skill>> {
  const { skillsFolderRelPath, skillsFolderAbsPath, adapter } = options;

  if (!(await adapter.exists(skillsFolderRelPath))) {
    return { accepted: [], rejected: [] };
  }

  const listing = await adapter.list(skillsFolderRelPath);

  const results = await mapWithConcurrency(
    [...listing.folders].filter((folder) => !basename(folder).startsWith(".")).sort(),
    DISCOVERY_CONCURRENCY,
    async (folderPath): Promise<Skill | RejectedSkill | null> => {
      const dirName = basename(folderPath);
      const childListing = await adapter.list(folderPath).catch(() => ({ files: [], folders: [] }));
      const documents = childListing.files.filter(
        (path) => basename(path).toLowerCase() === "skill.md"
      );
      const skillMdRelPath = documents[0] ?? joinPosix(folderPath, "SKILL.md");
      const absDir =
        skillsFolderAbsPath !== null ? joinPosix(skillsFolderAbsPath, dirName) : folderPath;
      const absFile = joinPosix(absDir, basename(skillMdRelPath));
      if (documents.length > 1)
        return {
          name: dirName,
          filePath: absFile,
          dirPath: absDir,
          reason: "Multiple SKILL.md files were found. Keep a single description file.",
        };

      let content: string;
      try {
        content = await adapter.read(skillMdRelPath);
      } catch {
        return null;
      }

      let parsed;
      try {
        parsed = parseSkillFile(content, dirName);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logWarn(`[skills] Skipping ${skillMdRelPath}: ${reason}`);
        if (err instanceof SkillFormatError) {
          return {
            name: dirName,
            filePath: absFile,
            dirPath: absDir,
            reason,
            offendingText: err.offendingText,
          };
        }
        return null;
      }

      const fm = parsed.frontmatter;
      const metadata = parsed.doc.get("metadata");
      const metaValue = (key: string) =>
        parsed.doc.get(key) ?? (isMap(metadata) ? metadata.get(key) : undefined);
      const author = metaValue("author");
      const version = metaValue("version");
      const rawTags = metaValue("tags");
      const tags = isSeq(rawTags)
        ? rawTags.items.map((item) => (isScalar(item) ? item.value : item))
        : rawTags;

      return {
        name: fm.name,
        description: fm.description,
        filePath: absFile,
        dirPath: absDir,
        body: parsed.body,
        contentHash: sha256(content),
        author: typeof author === "string" ? author : undefined,
        version:
          typeof version === "string" || typeof version === "number" || typeof version === "bigint"
            ? String(version)
            : undefined,
        tags:
          typeof tags === "string"
            ? tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean)
            : Array.isArray(tags)
              ? tags.filter((tag): tag is string => typeof tag === "string")
              : undefined,
        license: fm.license,
        compatibility: fm.compatibility,
        allowedTools: fm.allowedTools,
        model: fm.model,
        disableModelInvocation: fm.disableModelInvocation,
        userInvocable: fm.userInvocable,
        enabledAgents: fm.enabledAgents,
        location: { kind: "canonical" },
      };
    }
  );

  const accepted: Skill[] = [];
  const rejected: RejectedSkill[] = [];
  for (const result of results) {
    if (result === null) continue;
    if ("reason" in result) rejected.push(result);
    else accepted.push(result);
  }
  return { accepted, rejected };
}
