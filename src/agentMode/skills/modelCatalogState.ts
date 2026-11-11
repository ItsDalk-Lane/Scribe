import { atom, createStore, useAtomValue } from "jotai";

// 模型可见目录的最近一次构建状态，供设置页展示预算降级情况。
// https://github.com/ItsDalk-Lane/Scribe/issues/40
export interface SkillCatalogStatus {
  mode: "full" | "pruned" | "names-only";
  includedNames: string[];
  omittedNames: string[];
}

const store = createStore();
const catalogStatusAtom = atom<SkillCatalogStatus | null>(null);
let lastKey = "";

export function publishSkillCatalogStatus(status: SkillCatalogStatus): void {
  const key = `${status.mode}\u0000${status.includedNames.join(",")}\u0000${status.omittedNames.join(",")}`;
  if (key === lastKey) return;
  lastKey = key;
  store.set(catalogStatusAtom, status);
}

export function useSkillCatalogStatus(): SkillCatalogStatus | null {
  return useAtomValue(catalogStatusAtom, { store });
}

export function getSkillCatalogStatus(): SkillCatalogStatus | null {
  return store.get(catalogStatusAtom);
}

export function resetSkillCatalogStatusForTesting(): void {
  lastKey = "";
  store.set(catalogStatusAtom, null);
}
