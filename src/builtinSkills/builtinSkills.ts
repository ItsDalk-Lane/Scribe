import type { BuiltinPreferences } from "@/settings/builtinSkillPreferences";
import { t } from "@/lib/i18n";
import type { CopilotSettings } from "@/settings/model";
import { isObsidianCliEnabled } from "@/services/obsidianCli/ObsidianCliClient";
import { OBSIDIAN_SKILLS } from "./obsidianSkills";

export interface BuiltinSkill {
  readonly name: string;
  readonly version: number;
  readonly defaultPreference?: BuiltinPreferences[string];
  readonly skillMd: string;
  readonly files: ReadonlyArray<{ readonly path: string; readonly content: string }>;
}

export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [...OBSIDIAN_SKILLS];

export const DEFAULT_BUILTIN_PREFERENCES: BuiltinPreferences = Object.freeze({});

// The CLI toggle is per device, so an unavailable skill keeps its synced files and loses only its
// agent links and steering here. https://github.com/Brevilabs/obsidian-copilot-private/issues/726
export function builtinSkillUnavailableReason(skillName: string): string | undefined {
  return skillName === "obsidian-cli" && !isObsidianCliEnabled()
    ? t("Turn on Command line interface in Obsidian's Settings → General to use this skill.")
    : undefined;
}

export function isBuiltinSkillEnabledFor(
  _settings: CopilotSettings,
  skillName: string,
  _agentId: string
): boolean {
  return BUILTIN_SKILLS.some((skill) => skill.name === skillName);
}
