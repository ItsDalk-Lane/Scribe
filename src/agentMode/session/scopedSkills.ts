import { joinPosix, resolvesInto } from "@/utils/pathUtils";

interface ScopedSkill {
  dirPath: string;
  location: { kind: string };
}

const EMPTY_SCOPED_SKILLS: readonly never[] = Object.freeze([]);

export function filterSkillsForScope<T extends ScopedSkill>(
  skills: readonly T[],
  cwd: string | null,
  projectDirectory: string
): readonly T[] {
  const visible = skills.filter(
    (skill) =>
      skill.location.kind === "canonical" ||
      (cwd !== null && resolvesInto(skill.dirPath, joinPosix(cwd, projectDirectory)))
  );
  return visible.length ? visible : EMPTY_SCOPED_SKILLS;
}
