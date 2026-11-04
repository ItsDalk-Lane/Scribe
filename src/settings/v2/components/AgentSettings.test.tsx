import type { BackendAuthStatus } from "@/agentMode/session/types";
const mockAuthStatuses: Record<string, BackendAuthStatus | null> = {};
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { setSettings } from "@/settings/model";
import { playNotificationSound } from "@/utils/notificationSound";
import { AgentSettings } from "./AgentSettings";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

jest.mock("@/utils/notificationSound", () => {
  const actual = jest.requireActual<object>("@/utils/notificationSound");
  return { ...actual, playNotificationSound: jest.fn() };
});

let mockSettings: {
  agentMode: {
    activeBackend: string;
    backends: Record<string, unknown>;
    notificationSound: boolean;
    notificationSoundId: string;
  };
};
jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useSettingsValue: () => mockSettings,
  setSettings: jest.fn(),
  updateSetting: jest.fn(),
}));

jest.mock("@/hooks/useChatBackendModelOptions", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useChatBackendModelOptions: () => ({ options: [], resolveSelectionId: () => undefined }),
}));

const Icon: React.FC<{ className?: string }> = () => <svg data-testid="icon" />;

const installStates: Record<string, { kind: string; [key: string]: unknown }> = {
  native: { kind: "ready", source: "custom" },
};
const managedInstallStates: Record<string, { kind: string; [key: string]: unknown }> = {};

const installStateListeners = new Set<() => void>();
function publishInstallState() {
  for (const listener of installStateListeners) listener();
}

function makeDescriptor(id: string, displayName: string) {
  return {
    id,
    displayName,
    Icon,
    getInstallState: () => installStates[id],
    openInstallUI: jest.fn(),
    SettingsPanel: () => <div data-testid={`panel-${id}`}>settings panel</div>,
  };
}

const DESCRIPTORS = [makeDescriptor("native", "Scribe")];

const mockGetCachedModelCatalog = jest.fn();
const mockPreloadModels = jest.fn();
let mockEnabled = true;
const mockRuntimeListeners = new Set<() => void>();
const mockSetBackendEnabled = jest.fn(async (_id: string, enabled: boolean) => {
  mockEnabled = enabled;
  for (const listener of mockRuntimeListeners) listener();
});
const mockManager = {
  getCachedModelCatalog: mockGetCachedModelCatalog,
  preloadModels: mockPreloadModels,
  isBackendEnabled: () => mockEnabled,
  isBackendDisablePending: () => false,
  subscribe: (listener: () => void) => {
    mockRuntimeListeners.add(listener);
    return () => mockRuntimeListeners.delete(listener);
  },
  setBackendEnabled: mockSetBackendEnabled,
};

jest.mock("@/agentMode", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the actual hook export
  useBackendAuthState: (descriptor: { id: string }) => ({
    status: mockAuthStatuses[descriptor.id],
  }),
  AgentConfigurationCard: jest.requireActual<
    typeof import("@/agentMode/backends/shared/ui/AgentConfigurationCard")
  >("@/agentMode/backends/shared/ui/AgentConfigurationCard").AgentConfigurationCard,
  backendDisplayOrder: () => DESCRIPTORS,
  useBackendInstallState: (descriptor: { getInstallState: () => unknown }) => {
    const subscribe = React.useCallback((listener: () => void) => {
      installStateListeners.add(listener);
      return () => installStateListeners.delete(listener);
    }, []);
    const read = () => descriptor.getInstallState();
    return React.useSyncExternalStore(subscribe, read, read);
  },
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook export
  useManagedInstallActionState: (descriptor: { id: string }) =>
    managedInstallStates[descriptor.id] ?? { kind: "idle" },
}));

jest.mock("@/contexts/PluginContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real `usePlugin` hook; the name must match the export
  usePlugin: () => ({
    app: {},
    agentSessionManager: mockManager,
  }),
}));

jest.mock("./ChatModelEnableList", () => ({
  ChatModelEnableList: () => <div data-testid="chat-model-list">chat models</div>,
}));

jest.mock("./ConfiguredModelEnableList", () => ({
  ConfiguredModelEnableList: ({ descriptor }: { descriptor: { id: string } }) => (
    <div data-testid={`model-list-${descriptor.id}`}>model list</div>
  ),
}));

describe("AgentSettings", () => {
  describe("AgentSettings()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockEnabled = true;
      mockAuthStatuses.native = { signedIn: true };
      mockSettings = {
        agentMode: {
          activeBackend: "native",
          backends: {},
          notificationSound: true,
          notificationSoundId: "piano",
        },
      };
      (setSettings as jest.Mock).mockClear();
      (playNotificationSound as jest.Mock).mockClear();
      installStates.native = { kind: "ready", source: "custom" };
      mockGetCachedModelCatalog.mockReset().mockReturnValue({ availableModels: [] });
      mockPreloadModels.mockReset().mockResolvedValue(undefined);
    });

    it("skips model preload when the shared catalog is already available", async () => {
      render(<AgentSettings />);

      await waitFor(() => expect(mockGetCachedModelCatalog).toHaveBeenCalledWith("native"));
      expect(mockPreloadModels).not.toHaveBeenCalled();
    });

    it("preloads models when the shared catalog is unavailable", async () => {
      mockGetCachedModelCatalog.mockReturnValue(null);

      render(<AgentSettings />);

      await waitFor(() => expect(mockPreloadModels).toHaveBeenCalledWith("native"));
    });

    it("shows only the Scribe configuration tab", () => {
      render(<AgentSettings />);
      const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
      expect(tabs).toEqual(["Scribe"]);
    });

    it("omits the default agent picker because Scribe is the only agent", () => {
      render(<AgentSettings />);
      const tablist = screen.getByRole("tablist");
      expect(within(tablist).queryByText("Default agent")).toBeNull();
      expect(screen.queryByText("Default agent")).toBeNull();
    });

    it("mutes the chime when the notification sound switch is turned off", () => {
      render(<AgentSettings />);
      const toggle = screen.getAllByRole("switch")[1];
      expect(toggle.getAttribute("aria-checked")).toBe("true");

      fireEvent.click(toggle);

      const applyUpdate = (setSettings as jest.Mock).mock.calls[0][0] as (
        current: typeof mockSettings
      ) => { agentMode: typeof mockSettings.agentMode };
      expect(applyUpdate(mockSettings)).toEqual({
        agentMode: { ...mockSettings.agentMode, notificationSound: false },
      });
    });

    it("plays a sound as soon as one is picked, and remembers the pick", () => {
      render(<AgentSettings />);

      fireEvent.change(screen.getByDisplayValue("Piano key"), { target: { value: "doorbell" } });

      const applyUpdate = (setSettings as jest.Mock).mock.calls[0][0] as (
        current: typeof mockSettings
      ) => { agentMode: typeof mockSettings.agentMode };
      expect(applyUpdate(mockSettings).agentMode.notificationSoundId).toBe("doorbell");
      expect(playNotificationSound).toHaveBeenCalledWith("doorbell");
    });

    it("shows the real model list without the retired default-model and Quick tools controls", () => {
      render(<AgentSettings />);
      expect(screen.getByTestId("model-list-native")).toBeTruthy();
      expect(screen.queryByTestId("default-model-native")).toBeNull();
      expect(screen.queryByText("Quick tools")).toBeNull();
    });

    it("changes agent enablement through the session manager and prevents preloading while disabled", async () => {
      const view = render(<AgentSettings />);
      fireEvent.click(screen.getByRole("switch", { name: "Enable Scribe" }));
      await waitFor(() => expect(mockSetBackendEnabled).toHaveBeenCalledWith("native", false));
      await screen.findByText("Disabled; configuration kept");
      expect(view.container.querySelector("[inert]")).toBeTruthy();
      mockGetCachedModelCatalog.mockReturnValue(null);
      view.rerender(<AgentSettings />);
      expect(mockPreloadModels).not.toHaveBeenCalled();
    });

    it("shows a model-configuration error and hides ready-only model controls", () => {
      const message = "Configure a chat model in the existing BYOK settings.";
      installStates.native = {
        kind: "error",
        message,
      };

      render(<AgentSettings />);
      fireEvent.click(screen.getByRole("tab", { name: "Scribe" }));

      fireEvent.click(screen.getByRole("button", { name: "Agent configuration" }));
      expect(screen.getByText(message)).toBeTruthy();
      expect(screen.queryByTestId("model-list-native")).toBeNull();
    });

    it.each(DESCRIPTORS)(
      "opens $displayName model settings when no model has been configured",
      (descriptor) => {
        installStates[descriptor.id] = { kind: "error", message: "Choose a chat model" };
        render(<AgentSettings />);
        fireEvent.click(screen.getByRole("tab", { name: "Scribe" }));
        fireEvent.click(screen.getByRole("button", { name: "Agent configuration" }));
        fireEvent.click(screen.getByRole("button", { name: "Configure" }));
        expect(descriptor.openInstallUI).toHaveBeenCalledTimes(1);
        expect(screen.queryByText("Recommended")).toBeNull();
      }
    );

    it("restores model controls when BYOK configuration becomes ready", async () => {
      installStates.native = { kind: "error", message: "Choose a chat model" };
      render(<AgentSettings />);
      fireEvent.click(screen.getByRole("button", { name: "Agent configuration" }));
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(DESCRIPTORS[0].openInstallUI).toHaveBeenCalledTimes(1);

      act(() => {
        installStates.native = { kind: "ready", source: "custom" };
        publishInstallState();
      });

      expect(await screen.findByText("Ready")).not.toBeNull();
      expect(screen.getByTestId("model-list-native")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Configure" })).not.toBeNull();
    });
  });
});
