import type { SkillDependency } from "@/agentMode/skills/skillFormat";
import { detectBinary } from "@/utils/detectBinary";
import { requireNodeModule } from "@/utils/desktopRuntime";

// 本地只读依赖检测：命令行走 PATH 检测，插件查安装清单，Python 包用固定
// importlib.metadata 查询；绝不自动安装任何依赖。
// https://github.com/ItsDalk-Lane/Scribe/issues/46
export interface SkillDependencyReading {
  type: SkillDependency["type"];
  name: string;
  ready: boolean;
  detail: string;
}

export interface SkillDependencyCheckProbes {
  resolveCommand?: (name: string) => Promise<string | null>;
  pluginVersion?: (id: string) => string | undefined;
  pythonVersion?: (name: string) => Promise<string | null>;
}

const cache = new Map<string, SkillDependencyReading>();

export function resetSkillDependencyCacheForTesting(): void {
  cache.clear();
}

export function clearSkillDependencyCache(): void {
  cache.clear();
}

export async function checkSkillDependency(
  dependency: SkillDependency,
  probes: SkillDependencyCheckProbes = {},
  fresh = false
): Promise<SkillDependencyReading> {
  const key = `${dependency.type}\u0000${dependency.name}`;
  if (!fresh) {
    const cached = cache.get(key);
    if (cached) return cached;
  }
  const reading = await readDependency(dependency, probes);
  cache.set(key, reading);
  return reading;
}

export async function checkSkillDependencies(
  dependencies: readonly SkillDependency[],
  probes: SkillDependencyCheckProbes = {},
  fresh = false
): Promise<SkillDependencyReading[]> {
  return Promise.all(
    dependencies.map((dependency) => checkSkillDependency(dependency, probes, fresh))
  );
}

async function readDependency(
  dependency: SkillDependency,
  probes: SkillDependencyCheckProbes
): Promise<SkillDependencyReading> {
  if (dependency.type === "command") {
    const path = await (probes.resolveCommand ?? detectBinary)(dependency.name);
    return {
      type: dependency.type,
      name: dependency.name,
      ready: path !== null,
      detail: path ?? "not found on PATH",
    };
  }
  if (dependency.type === "obsidian-plugin") {
    const version = (probes.pluginVersion ?? (() => undefined))(dependency.name);
    return {
      type: dependency.type,
      name: dependency.name,
      ready: version !== undefined,
      detail: version !== undefined ? `version ${version}` : "not installed",
    };
  }
  const version = await (probes.pythonVersion ?? detectPythonPackage)(dependency.name);
  return {
    type: dependency.type,
    name: dependency.name,
    ready: version !== null,
    detail: version !== null ? `version ${version}` : "python package not found",
  };
}

async function detectPythonPackage(name: string): Promise<string | null> {
  const python = await detectBinary("python3");
  if (!python) return null;
  const childProcess = requireNodeModule<typeof import("node:child_process")>("node:child_process");
  const { promisify } = requireNodeModule<typeof import("node:util")>("node:util");
  const execFileAsync = promisify(childProcess.execFile);
  try {
    const { stdout } = await execFileAsync(
      python,
      ["-c", "import importlib.metadata as m, sys; print(m.version(sys.argv[1]))", name],
      { timeout: 10000 }
    );
    const version = stdout.trim();
    return version.length ? version : null;
  } catch {
    return null;
  }
}
