import {
  SCRIBE_OBSIDIAN_CLI_ENV,
  resolveObsidianCliPath,
} from "@/agentMode/backends/shared/obsidianCliPath";
import { requireNodeModule } from "@/utils/desktopRuntime";

const EMPTY_MANAGED_ENV: Readonly<Record<string, string>> = Object.freeze({});

export async function buildBuiltinSkillEnv(): Promise<Readonly<Record<string, string>>> {
  const os = requireNodeModule<typeof import("node:os")>("os");
  const env: Record<string, string> = {};

  const obsidianCliPath = resolveObsidianCliPath({
    platform: process.platform,
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    homeDir: os.homedir(),
  });
  if (obsidianCliPath) env[SCRIBE_OBSIDIAN_CLI_ENV] = obsidianCliPath;

  return Object.keys(env).length === 0 ? EMPTY_MANAGED_ENV : env;
}
