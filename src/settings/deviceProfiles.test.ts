import { DEFAULT_SETTINGS } from "@/constants";
import { dehydrateDeviceProfile, hydrateDeviceProfile } from "@/settings/deviceProfiles";
import type { CopilotSettings } from "@/settings/model";

function makeSettings(agentMode: Partial<CopilotSettings["agentMode"]> = {}): CopilotSettings {
  return { ...DEFAULT_SETTINGS, agentMode: { ...DEFAULT_SETTINGS.agentMode, ...agentMode } };
}

const DEVICE_A = "device-a";
const DEVICE_B = "device-b";

describe("deviceProfiles", () => {
  describe("dehydrateDeviceProfile()", () => {
    it("moves the Claude path and environment into this device's profile", () => {
      const settings = makeSettings({
        claudeCli: { path: "/a/claude" },
        backends: { claude: { envOverrides: { ANTHROPIC_BASE_URL: "https://example.com" } } },
      });

      const out = dehydrateDeviceProfile(settings, DEVICE_A);

      expect(out.agentMode.claudeCli).toBeUndefined();
      expect(out.agentMode.backends.claude).toBeUndefined();
      expect(out.agentMode.deviceProfiles?.[DEVICE_A]).toEqual({
        claudeCliPath: "/a/claude",
        claude: { envOverrides: { ANTHROPIC_BASE_URL: "https://example.com" } },
      });
    });

    it("keeps the Claude model and thinking preference in synced settings", () => {
      const settings = makeSettings({
        backends: {
          claude: {
            defaultModel: { baseModelId: "sonnet", effort: "high" },
            enableThinking: true,
            envOverrides: { BAR: "2" },
          },
        },
      });

      const out = dehydrateDeviceProfile(settings, DEVICE_A);

      expect(out.agentMode.backends.claude).toEqual({
        defaultModel: { baseModelId: "sonnet", effort: "high" },
        enableThinking: true,
      });
      expect(out.agentMode.deviceProfiles?.[DEVICE_A]?.claude?.envOverrides).toEqual({ BAR: "2" });
    });

    it("preserves another device's profile and removes this device's empty profile", () => {
      const settings = makeSettings({
        deviceProfiles: {
          [DEVICE_A]: { claudeCliPath: "/stale/claude" },
          [DEVICE_B]: { claudeCliPath: "/b/claude" },
        },
      });

      const out = dehydrateDeviceProfile(settings, DEVICE_A);

      expect(out.agentMode.deviceProfiles?.[DEVICE_A]).toBeUndefined();
      expect(out.agentMode.deviceProfiles?.[DEVICE_B]).toEqual({ claudeCliPath: "/b/claude" });
    });
  });

  describe("hydrateDeviceProfile()", () => {
    it("merges this device's Claude path and environment with the synced model", () => {
      const settings = makeSettings({
        backends: { claude: { defaultModel: { baseModelId: "sonnet", effort: null } } },
        deviceProfiles: {
          [DEVICE_A]: {
            claudeCliPath: "/a/claude",
            claude: { envOverrides: { API_HOST: "https://example.com" } },
          },
        },
      });

      const out = hydrateDeviceProfile(settings, DEVICE_A);

      expect(out.agentMode.claudeCli?.path).toBe("/a/claude");
      expect(out.agentMode.backends.claude).toEqual({
        defaultModel: { baseModelId: "sonnet", effort: null },
        envOverrides: { API_HOST: "https://example.com" },
      });
    });

    it("clears stale global device fields when this device has no profile", () => {
      const settings = makeSettings({
        claudeCli: { path: "/stale/claude" },
        backends: { claude: { enableThinking: true, envOverrides: { STALE: "1" } } },
        deviceProfiles: { [DEVICE_B]: { claudeCliPath: "/b/claude" } },
      });

      const out = hydrateDeviceProfile(settings, DEVICE_A);

      expect(out.agentMode.claudeCli).toBeUndefined();
      expect(out.agentMode.backends.claude).toEqual({ enableThinking: true });
    });

    it("restores the same Claude settings when saved and loaded on the same device", () => {
      const settings = makeSettings({
        claudeCli: { path: "/a/claude" },
        backends: {
          claude: {
            defaultModel: { baseModelId: "sonnet", effort: "high" },
            envOverrides: { API_HOST: "https://example.com" },
          },
        },
      });

      const restored = hydrateDeviceProfile(dehydrateDeviceProfile(settings, DEVICE_A), DEVICE_A);

      expect(restored.agentMode.claudeCli).toEqual(settings.agentMode.claudeCli);
      expect(restored.agentMode.backends).toEqual(settings.agentMode.backends);
    });

    it("keeps each device's Claude path private to that device across saves", () => {
      const aDisk = dehydrateDeviceProfile(
        makeSettings({ claudeCli: { path: "/a/claude" } }),
        DEVICE_A
      );
      const bLoaded = hydrateDeviceProfile(aDisk, DEVICE_B);
      expect(bLoaded.agentMode.claudeCli).toBeUndefined();

      const bDisk = dehydrateDeviceProfile(
        { ...bLoaded, agentMode: { ...bLoaded.agentMode, claudeCli: { path: "/b/claude" } } },
        DEVICE_B
      );

      expect(hydrateDeviceProfile(bDisk, DEVICE_A).agentMode.claudeCli?.path).toBe("/a/claude");
      expect(hydrateDeviceProfile(bDisk, DEVICE_B).agentMode.claudeCli?.path).toBe("/b/claude");
    });
  });
});
