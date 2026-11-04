export interface EffortOption {
  value: string | null;
  label: string;
}

export const EFFORT_LEVELS_ASCENDING: readonly string[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const EMPTY_EFFORT_OPTIONS: EffortOption[] = Object.freeze([]) as unknown as EffortOption[];

export function sortEffortOptions(options: readonly EffortOption[]): EffortOption[] {
  const concrete = options.filter((option) => option.value !== null);
  if (concrete.length === 0) return EMPTY_EFFORT_OPTIONS;
  return concrete.sort((a, b) => effortRank(a.value!) - effortRank(b.value!));
}

function effortRank(value: string): number {
  const rank = EFFORT_LEVELS_ASCENDING.indexOf(value);
  return rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
}

export function resolveEffort(
  preferred: string | null | undefined,
  options: readonly EffortOption[] | undefined
): string | null {
  if (options === undefined) return preferred ?? null;
  if (preferred != null && options.some((option) => option.value === preferred)) return preferred;
  return sortEffortOptions(options)[0]?.value ?? null;
}
