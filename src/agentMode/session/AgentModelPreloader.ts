import { logError, logInfo, logWarn } from "@/logger";
import type ScribePlugin from "@/main";
import { getSettings } from "@/settings/model";
import { isAgentBackendEnabled } from "@/settings/agentEnablement";
import { App, FileSystemAdapter, Platform } from "obsidian";
import { MethodUnsupportedError } from "./errors";
import type {
  BackendDescriptor,
  BackendId,
  BackendModelCatalog,
  BackendProcess,
  BackendState,
  EffortOption,
  SessionId,
  SessionUpdateHandler,
} from "./types";

export interface WarmBackend {
  proc: BackendProcess;
}

export class AgentModelPreloader {
  private readonly warm = new Map<BackendId, WarmBackend>();
  private readonly modelCatalogCache = new Map<BackendId, BackendModelCatalog>();
  private readonly effortCatalog = new Map<BackendId, Record<string, EffortOption[]>>();
  private readonly inflight = new Map<BackendId, Promise<void>>();
  private readonly pendingRefresh = new Set<BackendId>();
  private readonly listeners = new Set<() => void>();
  private readonly warmExitUnsubs = new Map<BackendId, () => void>();
  private readonly probing = new Map<BackendId, BackendProcess>();
  private readonly probeGenerations = new Map<BackendId, object>();
  private readonly stoppedProbes = new WeakSet<BackendProcess>();
  private disposed = false;

  constructor(
    private readonly app: App,
    private readonly plugin: ScribePlugin,
    private readonly resolveDescriptor: (id: BackendId) => BackendDescriptor | undefined,
    private readonly beforeBackendStart?: (id: BackendId) => Promise<void>
  ) {}

  getCachedModelCatalog(backendId: BackendId): BackendModelCatalog | null {
    return this.modelCatalogCache.get(backendId) ?? null;
  }

  getEffortCatalog(backendId: BackendId): Record<string, EffortOption[]> | null {
    return this.effortCatalog.get(backendId) ?? null;
  }

  clearCached(backendId: BackendId): void {
    if (this.disposed) return;
    let changed = false;
    if (this.modelCatalogCache.delete(backendId)) changed = true;
    if (this.effortCatalog.delete(backendId)) changed = true;
    const warm = this.warm.get(backendId);
    if (warm) {
      this.warm.delete(backendId);
      this.warmExitUnsubs.get(backendId)?.();
      this.warmExitUnsubs.delete(backendId);
      this.shutdownProbe(warm.proc).catch((e) => {
        logWarn(`[AgentMode] preload clearCached: shutdown of warm ${backendId} failed`, e);
      });
      changed = true;
    }
    if (changed) this.notify();
  }

  takeWarm(backendId: BackendId): WarmBackend | null {
    const entry = this.warm.get(backendId);
    if (!entry) return null;
    this.warm.delete(backendId);
    this.warmExitUnsubs.get(backendId)?.();
    this.warmExitUnsubs.delete(backendId);
    return entry;
  }

  getWarmProcs(): Array<{ backendId: BackendId; proc: BackendProcess }> {
    return Array.from(this.warm.entries(), ([backendId, entry]) => ({
      backendId,
      proc: entry.proc,
    }));
  }

  preload(backendId: BackendId): Promise<void> {
    if (this.disposed || !isAgentBackendEnabled(getSettings(), backendId)) return Promise.resolve();
    const existing = this.inflight.get(backendId);
    if (existing) return existing;
    return this.startProbeChain(backendId);
  }

  refresh(backendId: BackendId): Promise<void> | null {
    if (this.disposed || !isAgentBackendEnabled(getSettings(), backendId)) return null;
    const existing = this.inflight.get(backendId);
    if (existing) {
      this.pendingRefresh.add(backendId);
      return existing;
    }
    if (this.getCachedModelCatalog(backendId) === null) return null;
    this.clearCached(backendId);
    return this.startProbeChain(backendId);
  }

  private startProbeChain(backendId: BackendId): Promise<void> {
    const generation = {};
    this.probeGenerations.set(backendId, generation);
    const promise = this.runProbeChain(backendId, generation).finally(() => {
      if (this.inflight.get(backendId) !== promise) return;
      this.inflight.delete(backendId);
      this.pendingRefresh.delete(backendId);
    });
    this.inflight.set(backendId, promise);
    return promise;
  }

  private async runProbeChain(backendId: BackendId, generation: object): Promise<void> {
    let round = 0;
    do {
      this.pendingRefresh.delete(backendId);
      if (round > 0) this.clearCached(backendId);
      round += 1;
      await this.runProbe(backendId, generation);
    } while (
      this.pendingRefresh.has(backendId) &&
      !this.disposed &&
      this.probeGenerations.get(backendId) === generation
    );
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(backendId: BackendId): Promise<void> {
    this.probeGenerations.delete(backendId);
    this.inflight.delete(backendId);
    this.pendingRefresh.delete(backendId);
    const probing = this.probing.get(backendId);
    const warm = this.warm.get(backendId);
    this.probing.delete(backendId);
    this.warm.delete(backendId);
    this.warmExitUnsubs.get(backendId)?.();
    this.warmExitUnsubs.delete(backendId);
    this.modelCatalogCache.delete(backendId);
    this.effortCatalog.delete(backendId);
    await Promise.all(
      [...new Set([probing, warm?.proc])]
        .filter((proc): proc is BackendProcess => proc !== undefined)
        .map((proc) =>
          this.shutdownProbe(proc).catch((error) => {
            logWarn(`[AgentMode] stopping model probe failed: ${backendId}`, error);
          })
        )
    );
    this.notify();
  }

  private shutdownProbe(proc: BackendProcess): Promise<void> {
    if (this.stoppedProbes.has(proc)) return Promise.resolve();
    this.stoppedProbes.add(proc);
    return proc.shutdown();
  }

  shutdown(): void {
    this.disposed = true;
    this.modelCatalogCache.clear();
    this.effortCatalog.clear();
    this.inflight.clear();
    this.pendingRefresh.clear();
    this.probeGenerations.clear();
    for (const proc of this.probing.values()) void this.shutdownProbe(proc).catch(() => {});
    this.probing.clear();
    this.listeners.clear();
    for (const [backendId, warm] of this.warm) {
      this.warmExitUnsubs.get(backendId)?.();
      this.shutdownProbe(warm.proc).catch((e) => {
        logWarn(`[AgentMode] preload shutdown: warm ${backendId} shutdown failed`, e);
      });
    }
    this.warm.clear();
    this.warmExitUnsubs.clear();
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch (e) {
        logWarn("[AgentMode] preload listener threw", e);
      }
    }
  }

  private async runProbe(backendId: BackendId, generation: object): Promise<void> {
    if (Platform.isMobile) return;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    const cwd = adapter.getBasePath();

    const descriptor = this.resolveDescriptor(backendId);
    if (!descriptor) {
      logWarn(`[AgentMode] preload skipped: unknown backend ${backendId}`);
      return;
    }
    await this.beforeBackendStart?.(backendId);
    if (
      this.disposed ||
      this.probeGenerations.get(backendId) !== generation ||
      !isAgentBackendEnabled(getSettings(), backendId) ||
      descriptor.getInstallState(getSettings()).kind !== "ready"
    )
      return;

    const proc = descriptor.createBackendProcess({
      plugin: this.plugin,
      app: this.app,
      clientVersion: this.plugin.manifest.version,
      descriptor,
    });
    this.probing.set(backendId, proc);

    try {
      let catalog: BackendModelCatalog | null = null;
      let updatedState: BackendState | null = null;
      let effortProbedModelIds: ReadonlySet<string> = new Set();
      let effortPrefetch = Promise.resolve();
      const prefetchEfforts = (sessionId: SessionId, state: BackendState): Promise<void> => {
        effortProbedModelIds = new Set(state.model?.availableModels.map((m) => m.baseModelId));
        effortPrefetch = effortPrefetch.then(() =>
          this.runEffortPrefetch(backendId, descriptor, proc, sessionId, state)
        );
        return effortPrefetch;
      };
      const reprefetchEffortsOnNewModels = (sessionId: SessionId, state: BackendState): void => {
        if (!state.model?.availableModels.some((m) => !effortProbedModelIds.has(m.baseModelId))) {
          return;
        }
        void prefetchEfforts(sessionId, state).then(() => this.notify());
      };
      const onProbeEvent: SessionUpdateHandler = ({ sessionId, update }) => {
        if (this.probeGenerations.get(backendId) !== generation) return;
        if (update.sessionUpdate !== "state_changed" || !update.state.model) return;
        updatedState = update.state;
        if (!catalog || this.modelCatalogCache.get(backendId) !== catalog) return;
        catalog = { availableModels: update.state.model.availableModels };
        this.modelCatalogCache.set(backendId, catalog);
        this.notify();
        reprefetchEffortsOnNewModels(sessionId, update.state);
      };

      let probe: { sessionId: SessionId; state: BackendState } | null = null;
      try {
        await proc.start?.();
        const storedId = descriptor.getProbeSessionId?.(getSettings());
        probe = await this.fetchInitialState(
          proc,
          descriptor,
          backendId,
          storedId,
          cwd,
          onProbeEvent
        );
      } catch (err) {
        logError(`[AgentMode] preload ${backendId} failed`, err);
      }

      if (
        this.disposed ||
        this.probeGenerations.get(backendId) !== generation ||
        !isAgentBackendEnabled(getSettings(), backendId) ||
        !probe ||
        (!probe.state.model && !probe.state.mode)
      ) {
        if (probe) {
          logInfo(`[AgentMode] preload ${backendId}: agent did not report any initial state`);
        }
        try {
          await this.shutdownProbe(proc);
        } catch (e) {
          logWarn(`[AgentMode] preload ${backendId}: shutdown failed`, e);
        }
        return;
      }

      await prefetchEfforts(probe.sessionId, updatedState ?? probe.state);

      if (
        this.disposed ||
        this.probeGenerations.get(backendId) !== generation ||
        !isAgentBackendEnabled(getSettings(), backendId) ||
        !proc.isRunning()
      ) {
        this.effortCatalog.delete(backendId);
        try {
          await this.shutdownProbe(proc);
        } catch (e) {
          logWarn(`[AgentMode] preload ${backendId}: shutdown failed`, e);
        }
        return;
      }

      const warm: WarmBackend = {
        proc,
      };
      const exitUnsub = proc.onExit(() => {
        if (this.disposed) return;
        if (this.warm.get(backendId) === warm) {
          this.warm.delete(backendId);
          this.modelCatalogCache.delete(backendId);
          this.effortCatalog.delete(backendId);
          this.warmExitUnsubs.delete(backendId);
          this.notify();
        }
      });
      this.warm.set(backendId, warm);
      catalog = { availableModels: (updatedState ?? probe.state).model?.availableModels ?? null };
      this.modelCatalogCache.set(backendId, catalog);
      this.warmExitUnsubs.set(backendId, exitUnsub);
      logProbeResult(backendId, "session probe", probe.state);
      this.notify();
      if (updatedState) reprefetchEffortsOnNewModels(probe.sessionId, updatedState);
    } finally {
      if (this.probing.get(backendId) === proc) this.probing.delete(backendId);
    }
  }

  private async runEffortPrefetch(
    backendId: BackendId,
    descriptor: BackendDescriptor,
    proc: BackendProcess,
    sessionId: SessionId,
    state: BackendState
  ): Promise<void> {
    if (!descriptor.prefetchEffortCatalog || !state.model) return;
    const enabledModels = descriptor.getEnabledModelEntries?.(getSettings());
    if (!enabledModels || enabledModels.length === 0) return;
    try {
      const catalog = await descriptor.prefetchEffortCatalog({
        proc,
        sessionId,
        modelState: state.model,
        enabledModels,
        isAborted: () => this.disposed,
      });
      if (this.disposed) return;
      if (Object.keys(catalog).length > 0) this.effortCatalog.set(backendId, catalog);
    } catch (e) {
      logWarn(`[AgentMode] preload ${backendId}: effort prefetch failed`, e);
    }
  }

  private async fetchInitialState(
    proc: BackendProcess,
    descriptor: BackendDescriptor,
    backendId: BackendId,
    storedId: string | undefined,
    cwd: string,
    onProbeEvent: SessionUpdateHandler
  ): Promise<{ sessionId: SessionId; state: BackendState }> {
    type Strategy = {
      label: string;
      sessionId: string;
      run: () => Promise<{ sessionId: string; state: BackendState }>;
    };
    const strategies: Strategy[] = [];
    if (storedId) {
      strategies.push({
        label: `resumed probe session ${storedId}`,
        sessionId: storedId,
        run: () => proc.resumeSession({ sessionId: storedId, cwd }),
      });
      strategies.push({
        label: `loaded probe session ${storedId}`,
        sessionId: storedId,
        run: () => proc.loadSession({ sessionId: storedId, cwd }),
      });
    }

    for (const { label, sessionId, run } of strategies) {
      const unregister = proc.registerSessionHandler(sessionId, onProbeEvent);
      try {
        const resp = await run();
        logInfo(`[AgentMode] preload ${backendId}: ${label}`);
        return { sessionId: resp.sessionId, state: resp.state };
      } catch (err) {
        unregister();
        if (!(err instanceof MethodUnsupportedError)) {
          logWarn(`[AgentMode] preload ${backendId}: ${label} failed (will fall back)`, err);
        }
      }
    }

    const resp = await proc.newSession({ cwd });
    proc.registerSessionHandler(resp.sessionId, onProbeEvent);
    logInfo(`[AgentMode] preload ${backendId}: created probe session ${resp.sessionId}`);
    if (descriptor.persistProbeSessionId) {
      try {
        await descriptor.persistProbeSessionId(resp.sessionId, this.plugin);
      } catch (e) {
        logWarn(`[AgentMode] preload ${backendId}: persistProbeSessionId failed`, e);
      }
    }
    return { sessionId: resp.sessionId, state: resp.state };
  }
}

function logProbeResult(backendId: BackendId, label: string, state: BackendState): void {
  const ids = state.model?.availableModels.map((m) => m.baseModelId).join(", ") ?? "";
  const modeOpts = state.mode?.options.map((o) => o.value).join(", ") ?? "";
  const currentBaseId = state.model?.current.baseModelId ?? "-";
  const currentEntry = state.model?.availableModels.find((e) => e.baseModelId === currentBaseId);
  const effortOpts = currentEntry?.effortOptions.map((o) => o.value ?? "default").join(", ") ?? "";
  logInfo(
    `[AgentMode] preload ${backendId} (${label}): models=[${ids}] (current=${currentBaseId}), ` +
      `mode=[${modeOpts}] effort=[${effortOpts}]`
  );
}
