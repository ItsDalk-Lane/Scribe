import { NativeBackendDescriptor } from "@/agentMode/backends/native/descriptor";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { AgentSelectPanel } from "@/agentMode/ui/AgentSelectPanel";
import { PluginProvider } from "@/contexts/PluginContext";
import { setInterfaceLocale } from "@/lib/i18n";
import type ScribePlugin from "@/main";
import { createModelManagement, ModelManagementProvider } from "@/modelManagement";
import { getSettings, resetSettings, setSettings } from "@/settings/model";
import { consumeRequestedScribeSettingsTab } from "@/settings/openSettings";
import { AgentSettings } from "@/settings/v2/components/AgentSettings";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

const skillPreferences = {
  folder: ".scribe/skills",
  builtinPreferences: { "obsidian-markdown": { disabledAgents: ["native"] } },
};
const defaultModel = { baseModelId: "unavailable-model", effort: null };

function createFixture() {
  const setting = { open: jest.fn(), openTabById: jest.fn() };
  const app = {
    setting,
    vault: { on: () => ({}), offref: () => {} },
    metadataCache: { on: () => ({}), offref: () => {} },
    workspace: {
      getMostRecentLeaf: () => ({ view: { containerEl: document.createElement("div") } }),
    },
  } as unknown as App;
  const manager = {
    subscribe: () => () => {},
    getIsStarting: () => false,
    getStartingBackendId: () => null,
    getActiveSession: () => null,
    isBackendEnabled: () => true,
    isBackendDisablePending: () => false,
    getCachedModelCatalog: () => ({ availableModels: [] }),
    preloadModels: jest.fn().mockResolvedValue(undefined),
  } as unknown as AgentSessionManager;
  const plugin = { app, agentSessionManager: manager } as unknown as ScribePlugin;
  return { setting, plugin, manager, api: createModelManagement({ app }) };
}

function configureModel(enabled: boolean) {
  setSettings((current) => ({
    providers: {
      local: {
        providerId: "local",
        providerType: "openai-compatible",
        displayName: "Local model service",
        baseUrl: "http://localhost:1234/v1",
        requiresApiKey: false,
        origin: { kind: "byok" },
        addedAt: 1,
      },
    },
    configuredModels: [
      {
        configuredModelId: "model-a",
        providerId: "local",
        info: { id: "model-a", displayName: "First model" },
        configuredAt: 1,
      },
    ],
    backends: {
      chat: { enabledModels: ["model-a"] },
      native: { enabledModels: enabled ? ["model-a"] : [] },
    },
    agentMode: {
      ...current.agentMode,
      backends: { native: { defaultModel } },
      skills: skillPreferences,
    },
  }));
}

function renderSettings(fixture: ReturnType<typeof createFixture>) {
  return render(
    <PluginProvider plugin={fixture.plugin}>
      <ModelManagementProvider api={fixture.api}>
        <AgentSettings />
      </ModelManagementProvider>
    </PluginProvider>
  );
}

describe("AgentSettings", () => {
  beforeEach(() => {
    resetSettings();
    setInterfaceLocale("en");
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    consumeRequestedScribeSettingsTab();
  });

  afterEach(() => {
    cleanup();
    setInterfaceLocale("en");
    jest.restoreAllMocks();
    resetSettings();
    consumeRequestedScribeSettingsTab();
  });

  describe("AgentSettings()", () => {
    it("shows a ready agent and the enabled configured model when a chat model is enabled (https://github.com/ItsDalk-Lane/Scribe/issues/21)", () => {
      configureModel(true);
      renderSettings(createFixture());

      expect(screen.getByText("Ready")).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Visible models/ }));
      expect(
        screen
          .getByRole("switch", { name: "Show model First model (model-a)" })
          .getAttribute("aria-checked")
      ).toBe("true");
    });

    it("lets a user enable a disabled configured model from the error state without changing existing preferences (https://github.com/ItsDalk-Lane/Scribe/issues/21)", async () => {
      configureModel(false);
      const fixture = createFixture();
      const selection = render(
        <AgentSelectPanel plugin={fixture.plugin} manager={fixture.manager} />
      );

      expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("error");
      expect(screen.queryByText("Ready")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(fixture.setting.openTabById).toHaveBeenCalledWith("scribe");
      expect(consumeRequestedScribeSettingsTab()).toBe("agents");
      selection.unmount();

      const settingsView = renderSettings(fixture);
      expect(screen.queryByText("Ready")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Visible models/ }));
      const toggle = screen.getByRole("switch", { name: "Show model First model (model-a)" });
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(toggle);

      await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
      expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("ready");
      expect(getSettings().backends.native?.enabledModels).toEqual(["model-a"]);
      expect(getSettings().agentMode.skills).toEqual(skillPreferences);
      expect(getSettings().agentMode.backends.native?.defaultModel).toEqual(defaultModel);
      expect(await screen.findByText("Ready")).not.toBeNull();

      fireEvent.click(toggle);
      await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
      expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("error");
      expect(getSettings().agentMode.skills).toEqual(skillPreferences);
      expect(getSettings().agentMode.backends.native?.defaultModel).toEqual(defaultModel);
      settingsView.unmount();
    });

    it("opens models and providers when no chat model has been configured (https://github.com/ItsDalk-Lane/Scribe/issues/21)", () => {
      setSettings({ providers: {}, configuredModels: [], backends: {} });
      const fixture = createFixture();
      render(<AgentSelectPanel plugin={fixture.plugin} manager={fixture.manager} />);

      expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("error");
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(fixture.setting.openTabById).toHaveBeenCalledWith("scribe");
      expect(consumeRequestedScribeSettingsTab()).toBe("quickActions");
    });
  });
});
