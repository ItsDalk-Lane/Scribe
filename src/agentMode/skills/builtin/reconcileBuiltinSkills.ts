import type { InstallState } from "@/agentMode/session/types";
import type { ScribeSettings } from "@/settings/model";
import { joinPosix } from "@/utils/pathUtils";
import {
  BUILTIN_SKILLS,
  builtinSkillUnavailableReason,
  isBuiltinSkillEnabledFor,
} from "@/builtinSkills/builtinSkills";
import { inspectBuiltinSkill, seedBuiltinSkills, type BuiltinSeedFs } from "./seedBuiltinSkills";

export type { BuiltinPreferences } from "@/settings/builtinSkillPreferences";

export interface ReconcileBuiltinOptions {
  folder: string;
  fs: BuiltinSeedFs;
  settings: ScribeSettings;
  availableAgents: readonly string[];
  registeredAgents: readonly string[];
}

export async function reconcileBuiltinSkills(options: ReconcileBuiltinOptions): Promise<void> {
  const { folder, fs, settings, availableAgents, registeredAgents } = options;
  const errors: string[] = [];
  const enabledAgents: Record<string, string[]> = {};
  for (const skill of BUILTIN_SKILLS) {
    enabledAgents[skill.name] = registeredAgents.filter((agent) =>
      isBuiltinSkillEnabledFor(settings, skill.name, agent)
    );
  }
  const seed = BUILTIN_SKILLS.filter(
    (skill) =>
      !builtinSkillUnavailableReason(skill.name) &&
      enabledAgents[skill.name].some((agent) => availableAgents.includes(agent))
  );
  await seedBuiltinSkills({ skillsFolderRelPath: folder, fs, skills: seed, enabledAgents });
  for (const skill of seed) {
    const state = await inspectBuiltinSkill(folder, skill.name, fs, skill.version);
    const supportFilesPresent =
      state === "seeded" &&
      (
        await Promise.all(
          skill.files.map((file) => fs.exists(joinPosix(joinPosix(folder, skill.name), file.path)))
        )
      ).every(Boolean);
    if (!supportFilesPresent)
      errors.push(
        state === "collision"
          ? `A user-owned skill occupies ${skill.name}.`
          : `Could not install built-in skill ${skill.name}.`
      );
  }
  if (errors.length > 0) throw new Error(errors.join(" "));
}

const EMPTY_AVAILABLE_AGENTS = Object.freeze([]) as readonly string[];

export function availableBuiltinAgents(
  states: Readonly<Record<string, InstallState>>,
  previous: readonly string[]
): readonly string[] {
  const available = Object.entries(states)
    .filter(
      ([id, state]) =>
        state.kind === "ready" || (state.kind === "checking" && previous.includes(id))
    )
    .map(([id]) => id);
  if (available.length === 0) return EMPTY_AVAILABLE_AGENTS;
  if (available.length === previous.length && available.every((id, i) => id === previous[i])) {
    return previous;
  }
  return available;
}
