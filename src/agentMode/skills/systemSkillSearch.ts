import type { Skill, SkillImportCandidate } from "@/agentMode/skills/types";
import {
  normalizeSkillImportName,
  prepareSkillImportDescription,
  repairSkillImportPreparation,
  SKILL_IMPORT_MAX_BYTES,
  type PreparedSkillDescription,
} from "@/agentMode/skills/skillImport";
import { t } from "@/lib/i18n";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { resolvesInto } from "@/utils/pathUtils";

export interface SystemSkillRoot {
  name: string;
  path: string;
}
export interface SystemSkillSearchOptions {
  skillsDirectory: string;
  installed: readonly Pick<Skill, "name" | "source">[];
  signal?: AbortSignal;
}

export const SYSTEM_SKILL_SOURCE_VERSION = 1;
export const SYSTEM_SKILL_SEARCH_MAX_DIRECTORIES = 10000;
const MAX_DEPTH = 10;
const ROOT_HIDDEN_ALLOWLIST = new Set([".agents", ".claude", ".gemini"]);
const ENVIRONMENT_KEYS = ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME"] as const;

export function resolveSystemSkillRoots(
  homeDirectory: string,
  environment: NodeJS.ProcessEnv
): SystemSkillRoot[] {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const nodePath = /^[a-z]:[\\/]|^\\\\/i.test(homeDirectory) ? path.win32 : path.posix;
  const resolve = (value: string | undefined, fallback: string): string => {
    const location = value?.trim() || fallback;
    return nodePath.resolve(
      homeDirectory,
      location.startsWith("~/") ? location.slice(2) : location
    );
  };
  const xdg = resolve(environment.XDG_CONFIG_HOME, ".config");
  return [
    { name: "Agent Skills", path: nodePath.join(homeDirectory, ".agents", "skills") },
    { name: "Agent Skills (XDG)", path: nodePath.join(xdg, "agents", "skills") },
    {
      name: "Claude Code",
      path: nodePath.join(resolve(environment.CLAUDE_CONFIG_DIR, ".claude"), "skills"),
    },
    { name: "Codex", path: nodePath.join(resolve(environment.CODEX_HOME, ".codex"), "skills") },
    ...[
      ["Cursor", ".cursor"],
      ["Gemini CLI", ".gemini"],
      ["GitHub Copilot", ".copilot"],
      ["OpenCode", nodePath.join(xdg, "opencode")],
      ["OpenClaw", ".openclaw"],
      ["ClawdBot", ".clawdbot"],
      ["MoltBot", ".moltbot"],
      ["Qoder", ".qoder"],
      ["Qoder CN", ".qoder-cn"],
      ["Qwen Code", ".qwen"],
      ["MiniMax Code", ".minimax"],
    ].map(([name, directory]) => ({
      name,
      path: nodePath.resolve(homeDirectory, directory, "skills"),
    })),
  ];
}

export function parseLoginSkillEnvironment(output: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const part of output.split("\0").flatMap((line) => line.split(/\r?\n/))) {
    const separator = part.indexOf("=");
    const key = part.slice(0, separator);
    if (ENVIRONMENT_KEYS.some((allowed) => allowed === key))
      environment[key] = part.slice(separator + 1);
  }
  return environment;
}

async function readLoginSkillEnvironment(signal?: AbortSignal): Promise<NodeJS.ProcessEnv> {
  const childProcess = requireNodeModule<typeof import("node:child_process")>("child_process");
  const os = requireNodeModule<typeof import("node:os")>("os");
  let shell = process.env.SHELL;
  if (!shell && process.platform !== "win32") {
    try {
      shell = os.userInfo().shell ?? undefined;
    } catch {
      shell = undefined;
    }
  }
  const windows = process.platform === "win32";
  const command = windows ? "powershell.exe" : shell || "/bin/sh";
  const args = windows
    ? [
        "-NoLogo",
        "-NonInteractive",
        "-Command",
        "Get-ChildItem Env:CLAUDE_CONFIG_DIR,Env:CODEX_HOME,Env:XDG_CONFIG_HOME -ErrorAction SilentlyContinue | ForEach-Object { [Console]::Write($_.Name + '=' + $_.Value + [char]0) }",
      ]
    : ["-ilc", "/usr/bin/env -0"];
  try {
    const output = await new Promise<string>((resolve, reject) => {
      childProcess.execFile(
        command,
        args,
        { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true, signal },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        }
      );
    });
    signal?.throwIfAborted();
    return { ...process.env, ...parseLoginSkillEnvironment(output) };
  } catch {
    signal?.throwIfAborted();
    return { ...process.env };
  }
}

// 扫描完整性契约：部分失败显式标记，结果仅含已确认候选且可重试。
// https://github.com/ItsDalk-Lane/Scribe/issues/49
export interface SystemSkillSearchFailure {
  root: string;
  reason: string;
}

export interface SystemSkillSearchResult {
  candidates: SkillImportCandidate[];
  warnings: string[];
  incomplete: boolean;
  failures: SystemSkillSearchFailure[];
}

export async function searchSystemSkills(
  options: SystemSkillSearchOptions
): Promise<SystemSkillSearchResult> {
  const { installed, signal } = options;
  signal?.throwIfAborted();
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const os = requireNodeModule<typeof import("node:os")>("os");
  const home = os.homedir();
  if (!home || !path.isAbsolute(home)) throw new Error(t("Could not determine your home folder."));
  let loginEnvironmentFailed = false;
  const environment = await readLoginSkillEnvironment(signal).catch(() => {
    loginEnvironmentFailed = true;
    return { ...process.env };
  });
  const roots = resolveSystemSkillRoots(home, environment);
  const failures: SystemSkillSearchFailure[] = [];
  if (loginEnvironmentFailed)
    failures.push({
      root: t("Login shell environment"),
      reason: t("Could not read the login shell environment; inherited environment was used."),
    });
  const library = await fs.promises
    .realpath(options.skillsDirectory)
    .catch(() => path.resolve(options.skillsDirectory));
  const occupied = new Set(installed.map((skill) => skill.name.toLowerCase()));
  try {
    for (const directory of await fs.promises.readdir(options.skillsDirectory, {
      withFileTypes: true,
    })) {
      if (directory.isDirectory() || directory.isSymbolicLink())
        occupied.add(directory.name.toLowerCase());
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(t("Could not read the Scribe skill library."));
  }
  const candidates = new Map<string, SkillImportCandidate>();
  const warnings = new Set<string>();
  let visitedCount = 0;
  for (const root of roots) {
    if (visitedCount >= SYSTEM_SKILL_SEARCH_MAX_DIRECTORIES) break;
    const visited = new Map<string, number>();
    const visit = async (directory: string, depth: number): Promise<void> => {
      signal?.throwIfAborted();
      if (depth > MAX_DEPTH || visitedCount >= SYSTEM_SKILL_SEARCH_MAX_DIRECTORIES) {
        if (visitedCount >= SYSTEM_SKILL_SEARCH_MAX_DIRECTORIES)
          warnings.add(
            t("System search stopped after 10000 folders. Some skills may not be listed.")
          );
        return;
      }
      try {
        const real = await fs.promises.realpath(directory);
        const identity = process.platform === "win32" ? real.toLowerCase() : real;
        const libraryIdentity = process.platform === "win32" ? library.toLowerCase() : library;
        const previousDepth = visited.get(identity);
        if (
          (previousDepth !== undefined && previousDepth <= depth) ||
          resolvesInto(identity, libraryIdentity)
        )
          return;
        visited.set(identity, depth);
        visitedCount += 1;
        const listing = await fs.promises.readdir(real, { withFileTypes: true });
        const descriptions = listing.filter((entry) => entry.name.toLowerCase() === "skill.md");
        if (descriptions.length) {
          const existing = candidates.get(identity);
          if (existing) {
            if (!existing.sources.includes(root.name)) existing.sources.push(root.name);
            return;
          }
          let name = path.basename(real);
          const candidate: SkillImportCandidate = {
            id: real,
            name,
            description: "",
            path: real,
            sources: [root.name],
            status: "available",
          };
          try {
            if (descriptions.length !== 1 || !descriptions[0].isFile())
              throw new Error(
                t(
                  "Choose a folder or ZIP containing exactly one SKILL.md, directly or one folder below."
                )
              );
            const descriptionPath = path.join(real, descriptions[0].name);
            if ((await fs.promises.stat(descriptionPath)).size > SKILL_IMPORT_MAX_BYTES)
              throw new Error(t("A skill can contain at most 2000 files and 50 MB."));
            const content = await fs.promises.readFile(descriptionPath, "utf8");
            // 扫描期同样走「严格 → 受限修复」链路，可修复候选带差异进入确认流程。
            // https://github.com/ItsDalk-Lane/Scribe/issues/44
            let prepared: PreparedSkillDescription;
            try {
              prepared = prepareSkillImportDescription(content, name);
            } catch (error) {
              const fixed = repairSkillImportPreparation(content, name);
              if (!fixed) throw error;
              prepared = fixed.prepared;
              candidate.repair = fixed.repair;
            }
            name = prepared.name;
            candidate.name = name;
            candidate.description = prepared.description;
            candidate.renamedFrom = prepared.renamedFrom;
          } catch (error) {
            try {
              candidate.name = name = normalizeSkillImportName(name);
            } catch {
              candidate.name = name;
            }
            candidate.error =
              error instanceof Error ? error.message : t("The skill could not be read.");
          }
          const sameOrigin = installed.find(
            (skill) => skill.source?.kind === "system" && skill.source.origin === real
          );
          if (sameOrigin && sameOrigin.name !== name) {
            candidate.renamedFrom ??= name;
            candidate.name = name = sameOrigin.name;
          }
          const occupant = installed.find(
            (skill) => skill.name.toLowerCase() === name.toLowerCase()
          );
          if (
            occupied.has(name.toLowerCase()) &&
            (!sameOrigin || (occupant && occupant !== sameOrigin))
          ) {
            candidate.status = "conflict";
          } else if (sameOrigin) candidate.status = "installed";
          candidates.set(identity, candidate);
          return;
        }
        for (const entry of listing.sort((a, b) => a.name.localeCompare(b.name))) {
          if (
            entry.name === "node_modules" ||
            (entry.name.startsWith(".") && !(depth === 0 && ROOT_HIDDEN_ALLOWLIST.has(entry.name)))
          )
            continue;
          if (entry.isDirectory() || entry.isSymbolicLink())
            await visit(path.join(real, entry.name), depth + 1);
        }
      } catch (error) {
        signal?.throwIfAborted();
        // ENOENT 是竞态删除，静默跳过；其余失败进入结构化不完整标记。
        // https://github.com/ItsDalk-Lane/Scribe/issues/49
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          warnings.add(t("Could not read a system skill folder: {path}", { path: directory }));
          failures.push({
            root: root.name,
            reason:
              error instanceof Error
                ? `${(error as NodeJS.ErrnoException).code ?? error.name}: ${error.message}`
                : String(error),
          });
        }
      }
    };
    await visit(root.path, 0);
  }
  signal?.throwIfAborted();
  return {
    candidates: [...candidates.values()].sort((a, b) => a.name.localeCompare(b.name)),
    warnings: [...warnings],
    incomplete: failures.length > 0,
    failures,
  };
}
