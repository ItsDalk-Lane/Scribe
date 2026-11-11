import type { App } from "obsidian";
import type React from "react";
import type ScribePlugin from "@/main";
import type { ScribeSettings } from "@/settings/model";
import type { Destination } from "@/types/destination";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type {
  BackendConfigOption,
  BackendId,
  BackendProcess,
  BackendState,
  EffortOption,
  EnabledModelEntry,
  ModelSelection,
  ModelState,
  ModelWireCodec,
  ModeMapping,
  PermissionOption,
  RawModeState,
  SessionId,
} from "./types";

export interface ModelSelectionSession {
  getState(): BackendState | null;
  applyModelWireId(wireId: string): Promise<void>;
  setConfigOption(configId: string, value: string): Promise<void>;
}

export type InstallState =
  | { kind: "absent" }
  | { kind: "checking"; source: "managed" | "custom" }
  | { kind: "ready"; source: "managed" | "custom"; version?: string }
  | {
      kind: "incompatible";
      source: "managed" | "custom";
      currentVersion: string;
      minVersion: string;
      message: string;
    }
  | { kind: "error"; message: string; reason?: "configuration" };

export type ManagedInstallActionState =
  | { kind: "idle" }
  | { kind: "running"; label: string; percent?: number }
  | { kind: "error"; message: string };

export interface ManagedInstallAction {
  getState(plugin: ScribePlugin): ManagedInstallActionState;
  subscribe(plugin: ScribePlugin, onChange: () => void): () => void;
  run(plugin: ScribePlugin): Promise<void>;
}

export interface BackendAuthStatus {
  signedIn: boolean;
  label?: string;
}

export interface BackendSignInHandlers {
  signal?: AbortSignal;
  onUrl?: (url: string) => void;
  onLine?: (line: string) => void;
}

export interface BackendAuth {
  getProbeKey?(settings: ScribeSettings): string;
  getStatus(settings: ScribeSettings): Promise<BackendAuthStatus>;
  signIn(settings: ScribeSettings, handlers?: BackendSignInHandlers): Promise<BackendAuthStatus>;
  signOut?(
    settings: ScribeSettings,
    options?: { signal?: AbortSignal }
  ): Promise<BackendAuthStatus>;
}

export interface BackendDescriptor {
  createExtensionManager?: (input: {
    settings: ScribeSettings;
    cwd: string | null;
  }) => import("./extensionManagement").AgentExtensionManager;
  checkExtensions?: (input: {
    plugin: ScribePlugin;
    cwd: string;
    scope?: import("./extensionManagement").AgentExtensionScope;
    signal?: AbortSignal;
    onUpdate?: (runtime: import("./extensionInventory").AgentExtensionRuntimeSnapshot) => void;
  }) => Promise<import("./extensionInventory").AgentExtensionRuntimeSnapshot | null>;

  readExtensions?: (input: {
    settings: ScribeSettings;
    cwd: string | null;
  }) => Promise<readonly import("./extensionInventory").AgentExtensionGroup[]>;

  readonly id: BackendId;
  readonly displayName: string;

  readonly Icon: React.ComponentType<{ className?: string }>;

  readonly usesConfiguredModels: boolean;

  readonly setupDescription: string;

  readonly skillsProjectDir: string;

  readonly crossDiscoveredAgents: ReadonlyArray<BackendId>;

  readonly summarizesSessionTitle: boolean;

  readonly sharesMcpServersAcrossSessions?: boolean;

  readonly agentProductName?: string;

  readonly planFeedbackDelivery?: "permission" | "next_turn";

  readonly midTurnDelivery?: boolean;

  readonly withdraw?: boolean;

  readonly stopTask?: boolean;

  readonly processPerChat?: boolean;

  getInstallState(settings: ScribeSettings): InstallState;

  getResolvedBinaryPath?(settings: ScribeSettings): string | null;

  subscribeInstallState(plugin: ScribePlugin, cb: () => void): () => void;

  openInstallUI(plugin: ScribePlugin): void;

  managedInstall?: ManagedInstallAction;

  auth?: BackendAuth;

  createBackendProcess(args: {
    plugin: ScribePlugin;
    app: App;
    clientVersion: string;
    descriptor: BackendDescriptor;
    configurationScope?: import("./extensionManagement").AgentExtensionScope;
  }): BackendProcess;

  SettingsPanel?: React.FC<{ plugin: ScribePlugin; app: App }>;

  onPluginLoad?(plugin: ScribePlugin): Promise<void>;

  readonly wire: ModelWireCodec;

  normalizeModelName?(name: string): string;

  presentPermissionOption?(option: PermissionOption, metadata: unknown): PermissionOption;

  dataDestination?(settings: ScribeSettings, vaultBase: string | null): Destination;

  readonly showModelDescriptions?: boolean;

  applySelection(session: ModelSelectionSession, selection: ModelSelection): Promise<void>;

  getModeMapping?(
    modeState: RawModeState | null,
    configOptions: BackendConfigOption[] | null
  ): ModeMapping | null;

  getModeState?(
    modeState: RawModeState | null,
    configOptions: BackendConfigOption[] | null
  ): BackendState["mode"];

  applyInitialSessionConfig?(
    session: AgentSession,
    settings: ScribeSettings,
    seededSelection?: ModelSelection
  ): Promise<void>;

  isPlanModePlanFilePath?(absolutePath: string, cwd: string | null | undefined): boolean;

  getProbeSessionId?(settings: ScribeSettings): string | undefined;

  getEnabledModelEntries?(settings: ScribeSettings): EnabledModelEntry[] | null;

  getWireBaseId?(configuredModelId: string, settings: ScribeSettings): string | null;

  persistProbeSessionId?(sessionId: string, plugin: ScribePlugin): Promise<void>;

  prefetchEffortCatalog?(args: {
    proc: BackendProcess;
    sessionId: SessionId;
    modelState: ModelState;
    enabledModels: ReadonlyArray<EnabledModelEntry>;
    isAborted: () => boolean;
  }): Promise<Record<string, EffortOption[]>>;
}
