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
const EMPTY_LEDGER = Object.freeze({}) as SkillUsageLedger;

const store = createStore();
const usageAtom = atom<SkillUsageLedger>(EMPTY_LEDGER);

interface UsageState {
  owner: App;
  ledger: SkillUsageLedger;
  loaded: boolean;
  failed: boolean;
  loading: Promise<void> | null;
  deletedDuringLoad: Set<string>;
  changedDuringLoad: boolean;
  pendingPersist: boolean;
  disposed: boolean;
  writeQueue: Promise<void>;
  persistSoon: ReturnType<typeof debounce<(owner: UsageState) => void>>;
}

let current: UsageState | null = null;
const states = new Map<App, UsageState>();

async function load(owner: App): Promise<SkillUsageLedger> {
  if (!(await owner.vault.adapter.exists(SKILL_USAGE_PATH))) return {};
  const raw = await owner.vault.adapter.read(SKILL_USAGE_PATH);
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid skill usage ledger");
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
    else throw new Error("Invalid skill usage entry");
  }
  return next;
}

function persistNow(state: UsageState): void {
  state.pendingPersist = false;
  const contents = `${JSON.stringify(state.ledger, null, 2)}\n`;
  // 同一库的旧快照不能在新快照之后落盘。https://github.com/ItsDalk-Lane/Scribe/issues/48
  state.writeQueue = state.writeQueue
    .then(() => writeVaultFile(state.owner.vault, SKILL_USAGE_PATH, contents))
    .catch((error: unknown) => logWarn("[Skills] Could not save the usage ledger", error));
}

export function initializeSkillUsageStore(owner: App): void {
  // 切库不能丢弃上一库未完成的读取和保存。https://github.com/ItsDalk-Lane/Scribe/issues/48
  let state = states.get(owner);
  if (!state) {
    state = {
      owner,
      ledger: EMPTY_LEDGER,
      loaded: false,
      failed: false,
      loading: null,
      deletedDuringLoad: new Set(),
      changedDuringLoad: false,
      pendingPersist: false,
      disposed: false,
      writeQueue: Promise.resolve(),
      persistSoon: debounce(persistNow, PERSIST_DEBOUNCE_MS),
    };
    states.set(owner, state);
  }
  current = state;
  publish(state);
  startLoading(state);
}

export function useSkillUsageLedger(): SkillUsageLedger {
  return useAtomValue(usageAtom, { store });
}

export function getSkillUsageLedger(): SkillUsageLedger {
  return current?.ledger ?? EMPTY_LEDGER;
}

function publish(state: UsageState): void {
  if (current === state) store.set(usageAtom, state.ledger);
}

function startLoading(state: UsageState): void {
  if (!state.loaded && !state.loading && !state.failed) {
    // 首次读取旧台账期间的调用仍须计数，不能被读取结果覆盖。https://github.com/ItsDalk-Lane/Scribe/issues/48
    const pending = load(state.owner)
      .then((initial) => {
        if (state.disposed) return;
        for (const deleted of state.deletedDuringLoad) delete initial[deleted];
        for (const [pendingName, entry] of Object.entries(state.ledger)) {
          initial[pendingName] = {
            ...entry,
            count: (initial[pendingName]?.count ?? 0) + entry.count,
          };
        }
        state.deletedDuringLoad.clear();
        state.ledger = initial;
        publish(state);
        state.loaded = true;
        if (state.changedDuringLoad) {
          state.changedDuringLoad = false;
          schedulePersist(state);
        }
      })
      .catch((error: unknown) => {
        // 读取失败时保留原文件，不能把未知内容当成空台账覆盖。https://github.com/ItsDalk-Lane/Scribe/issues/48
        state.failed = true;
        logWarn("[Skills] Could not load the usage ledger", error);
      });
    state.loading = pending;
  }
}

export function recordSkillUsage(owner: App | null, name: string, source: SkillUsageSource): void {
  const target = owner ?? current?.owner;
  if (!target) return;
  if (!states.has(target)) initializeSkillUsageStore(target);
  const state = states.get(target)!;
  startLoading(state);
  const entry = state.ledger[name];
  state.ledger = {
    ...state.ledger,
    [name]: {
      count: (entry?.count ?? 0) + 1,
      lastUsedAt: Date.now(),
      lastSource: source,
    },
  };
  publish(state);
  if (state.loaded) schedulePersist(state);
  else if (!state.failed) state.changedDuringLoad = true;
}

function schedulePersist(state: UsageState): void {
  state.pendingPersist = true;
  state.persistSoon(state);
}

export async function flushSkillUsageStore(): Promise<void> {
  await Promise.all(
    [...states.values()].map(async (state) => {
      await state.loading;
      if (state.pendingPersist) state.persistSoon.flush();
      await state.writeQueue;
    })
  );
}

// 技能删除时一并清除其台账记录；重装恢复后计数从零开始。
// https://github.com/ItsDalk-Lane/Scribe/issues/48
export function forgetSkillUsage(name: string): void {
  const state = current;
  if (!state) return;
  if (!state.loaded && !state.failed) {
    state.deletedDuringLoad.add(name);
    state.changedDuringLoad = true;
  }
  if (!(name in state.ledger)) return;
  const next = { ...state.ledger };
  delete next[name];
  state.ledger = next;
  publish(state);
  if (state.loaded) schedulePersist(state);
}

export function resetSkillUsageStoreForTesting(): void {
  for (const state of states.values()) {
    state.disposed = true;
    state.persistSoon.cancel();
  }
  states.clear();
  current = null;
  store.set(usageAtom, EMPTY_LEDGER);
}
