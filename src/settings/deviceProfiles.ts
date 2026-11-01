// Device-specific fields live in per-device segments because `data.json` syncs across devices:
// https://github.com/logancyang/obsidian-copilot/issues/2539

import type { CopilotSettings, DeviceAgentProfile } from "@/settings/model";

type AgentMode = CopilotSettings["agentMode"];
type Backends = AgentMode["backends"];

function hasOwnKeys(obj: object): boolean {
  return Object.keys(obj).length > 0;
}

function omitKeys<T extends object>(obj: T, keys: readonly string[]): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const key of keys) delete out[key];
  return out as T;
}

const CLAUDE_DEVICE_KEYS = ["envOverrides"] as const;

function buildProfileFromFlat(agentMode: AgentMode): DeviceAgentProfile {
  const profile: DeviceAgentProfile = {};

  const claudeCliPath = agentMode.claudeCli?.path;
  if (claudeCliPath) profile.claudeCliPath = claudeCliPath;

  const claudeSrc = agentMode.backends?.claude;
  if (claudeSrc?.envOverrides) {
    profile.claude = { envOverrides: claudeSrc.envOverrides };
  }

  return profile;
}

function stripDeviceFieldsFromBackends(backends: Backends | undefined): Backends {
  const out: Backends = {};
  if (!backends) return out;

  if (backends.claude) {
    const synced = omitKeys(backends.claude, CLAUDE_DEVICE_KEYS);
    if (hasOwnKeys(synced)) out.claude = synced;
  }
  return out;
}

export function dehydrateDeviceProfile(
  settings: CopilotSettings,
  deviceId: string
): CopilotSettings {
  const agentMode = settings?.agentMode;
  if (!agentMode) return settings;

  const profile = buildProfileFromFlat(agentMode);
  const deviceProfiles = { ...(agentMode.deviceProfiles ?? {}) };
  if (hasOwnKeys(profile)) deviceProfiles[deviceId] = profile;
  else delete deviceProfiles[deviceId];

  const nextAgentMode: AgentMode = {
    ...agentMode,
    claudeCli: undefined,
    backends: stripDeviceFieldsFromBackends(agentMode.backends),
    deviceProfiles: hasOwnKeys(deviceProfiles) ? deviceProfiles : undefined,
  };
  return { ...settings, agentMode: nextAgentMode };
}

export function hydrateDeviceProfile(settings: CopilotSettings, deviceId: string): CopilotSettings {
  const agentMode = settings.agentMode;
  if (!agentMode) return settings;
  const profile = agentMode.deviceProfiles?.[deviceId];

  const nextBackends = stripDeviceFieldsFromBackends(agentMode.backends);
  if (profile?.claude) nextBackends.claude = { ...nextBackends.claude, ...profile.claude };

  const nextAgentMode: AgentMode = {
    ...agentMode,
    backends: nextBackends,
    claudeCli: profile?.claudeCliPath ? { path: profile.claudeCliPath } : undefined,
  };
  return { ...settings, agentMode: nextAgentMode };
}
