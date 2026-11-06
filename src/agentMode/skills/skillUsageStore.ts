import { debounce } from "@/lib/debounce";
import { logWarn } from "@/logger";
import { writeVaultFile } from "@/utils/vaultFileStore";
import { atom, createStore, useAtomValue } from "jotai";
import type { App } from "obsidian";

// 纯本地技能使用台账：记录次数、最近时间与调用来源，存 .scribe 库内随库同步，
// 不外传任何数据；写入失败只影响统计完整性，不影响技能投递主路径。
// https://github.com/ItsDalk-Lane/Scribe/issues/48
export const SKILL_USAGE_PATH = ".scribe/skills/.usage.json";

export type SkillUsageSource = "model" | "user";

export interface SkillUsageEntry {
  count: number;
  lastUsedAt: number;
  lastSource: SkillUsageSource;
}

export type SkillUsageLedger = Record<string, SkillUsageEntry>;

const PERSIST_DEBOUNCE_MS = 30_000;

const store = createStore();
const usageAtom = atom<SkillUsageLedger>({});

let app: App | null = null;
let ledger: SkillUsageLedger = {};
let loaded = false;
let pendingPersist = false;

async function load(owner: App): Promise<SkillUsageLedger> {
  try {
    if (!(await owner.vault.adapter.exists(SKILL_USAGE_PATH))) return {};
    const raw = await owner.vault.adapter.read(SKILL_USAGE_PATH);
    if (!raw.trim()) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: SkillUsageLedger = {};
    for (const [name, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const record = entry as Partial<SkillUsageEntry> | null;
      if (
        record &&
        typeof record.count === "number" &&
        typeof record.lastUsedAt === "number" &&
        (record.lastSource === "model" || record.lastSource === "user")
      )
        next[name] = {
          count: record.count,
          lastUsedAt: record.lastUsedAt,
          lastSource: record.lastSource,
        };
    }
    return next;
  } catch (error) {
    logWarn("[Skills] Could not read the usage ledger", error);
    return {};
  }
}

async function persistNow(owner: App): Promise<void> {
  pendingPersist = false;
  try {
    await writeVaultFile(owner.vault, SKILL_USAGE_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
  } catch (error) {
    logWarn("[Skills] Could not save the usage ledger", error);
  }
}

let flushPromise: Promise<void> = Promise.resolve();
const persistSoon = debounce((owner: App) => {
  flushPromise = persistNow(owner);
}, PERSIST_DEBOUNCE_MS);

export function initializeSkillUsageStore(owner: App): void {
  app = owner;
}

export function useSkillUsageLedger(): SkillUsageLedger {
  return useAtomValue(usageAtom, { store });
}

export function getSkillUsageLedger(): SkillUsageLedger {
  return ledger;
}

function publish(next: SkillUsageLedger): void {
  ledger = next;
  store.set(usageAtom, ledger);
}

export function recordSkillUsage(owner: App | null, name: string, source: SkillUsageSource): void {
  const target = owner ?? app;
  if (!target) return;
  if (!loaded) {
    loaded = true;
    void load(target)
      .then((initial) => {
        publish({
          ...initial,
          [name]: {
            count: (initial[name]?.count ?? 0) + 1,
            lastUsedAt: Date.now(),
            lastSource: source,
          },
        });
        schedulePersist(target);
      })
      .catch((error: unknown) => logWarn("[Skills] Could not load the usage ledger", error));
    return;
  }
  const entry = ledger[name];
  publish({
    ...ledger,
    [name]: {
      count: (entry?.count ?? 0) + 1,
      lastUsedAt: Date.now(),
      lastSource: source,
    },
  });
  schedulePersist(target);
}

function schedulePersist(target: App): void {
  pendingPersist = true;
  persistSoon(target);
}

export async function flushSkillUsageStore(): Promise<void> {
  if (app && pendingPersist) persistSoon.flush();
  await flushPromise;
}

// 技能删除时一并清除其台账记录；重装恢复后计数从零开始。
// https://github.com/ItsDalk-Lane/Scribe/issues/48
export function forgetSkillUsage(name: string): void {
  if (!(name in ledger)) return;
  const next = { ...ledger };
  delete next[name];
  publish(next);
  if (app) schedulePersist(app);
}

export function resetSkillUsageStoreForTesting(): void {
  app = null;
  ledger = {};
  loaded = false;
  pendingPersist = false;
  persistSoon.cancel();
  store.set(usageAtom, {});
}
