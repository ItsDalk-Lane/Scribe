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
  claude: { kind: "ready", source: "custom" },
};
const managedInstallStates: Record<string, { kind: string; [key: string]: unknown }> = {};

let resolvedPaths: Record<string, string | null> = {};

const MANAGED_BINARY_PATH = "/usr/local/bin/claude";

const installStateListeners = new Set<() => void>();
function publishInstallState() {
  for (const listener of installStateListeners) listener();
}

function makeDescriptor(id: string, displayName: string) {
  return {
    id,
    displayName,
    auth: {},
    Icon,
    getInstallState: () => installStates[id],
    getResolvedBinaryPath: () => resolvedPaths[id] ?? null,
    openInstallUI: jest.fn(),
    SettingsPanel: () => <div data-testid={`panel-${id}`}>settings panel</div>,
  };
}

const DESCRIPTORS = [makeDescriptor("claude", "Claude")];

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
      mockAuthStatuses.claude = { signedIn: true };
      mockSettings = {
        agentMode: {
          activeBackend: "claude",
          backends: {},
          notificationSound: true,
          notificationSoundId: "piano",
        },
      };
      (setSettings as jest.Mock).mockClear();
      (playNotificationSound as jest.Mock).mockClear();
      installStates.claude = { kind: "ready", source: "custom" };
      mockGetCachedModelCatalog.mockReset().mockReturnValue({ availableModels: [] });
      mockPreloadModels.mockReset().mockResolvedValue(undefined);
      resolvedPaths = {};
    });

    it.each(["claude"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 reflects %s account readiness in the settings header",
      (id) => {
        mockSettings.agentMode.activeBackend = id;
        mockAuthStatuses[id] = { signedIn: false };
        const view = render(<AgentSettings />);
        fireEvent.click(screen.getByRole("tab", { name: "Claude Code" }));
        expect(screen.getByText("Sign in required")).toBeTruthy();
        expect(screen.queryByText("Ready")).toBeNull();
        mockAuthStatuses[id] = null;
        view.rerender(<AgentSettings />);
        expect(screen.getByText("Checking sign-in…")).toBeTruthy();
        mockAuthStatuses[id] = { signedIn: true };
        view.rerender(<AgentSettings />);
        expect(screen.getByText("Ready")).toBeTruthy();
      }
    );

    it("skips model preload when the shared catalog is already available", async () => {
      render(<AgentSettings />);

      await waitFor(() => expect(mockGetCachedModelCatalog).toHaveBeenCalledWith("claude"));
      expect(mockPreloadModels).not.toHaveBeenCalled();
    });

    it("preloads models when the shared catalog is unavailable", async () => {
      mockGetCachedModelCatalog.mockReturnValue(null);

      render(<AgentSettings />);

      await waitFor(() => expect(mockPreloadModels).toHaveBeenCalledWith("claude"));
    });

    it("shows only the Claude Code configuration tab", () => {
      render(<AgentSettings />);
      const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
      expect(tabs).toEqual(["Claude Code"]);
    });

    it("omits the default agent picker because Claude is the only agent", () => {
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
      expect(screen.getByTestId("model-list-claude")).toBeTruthy();
      expect(screen.queryByTestId("default-model-claude")).toBeNull();
      expect(screen.queryByText("Quick tools")).toBeNull();
    });

    it("changes agent enablement through the session manager and prevents preloading while disabled", async () => {
      const view = render(<AgentSettings />);
      fireEvent.click(screen.getByRole("switch", { name: "Enable Claude Code" }));
      await waitFor(() => expect(mockSetBackendEnabled).toHaveBeenCalledWith("claude", false));
      await screen.findByText("Disabled; configuration kept");
      expect(view.container.querySelector("[inert]")).toBeTruthy();
      mockGetCachedModelCatalog.mockReturnValue(null);
      view.rerender(<AgentSettings />);
      expect(mockPreloadModels).not.toHaveBeenCalled();
    });

    it("shows an incompatible-version message and hides ready-only model controls", () => {
      const message =
        "Claude Code 2.1.205 is not supported. Scribe requires Claude Code 2.1.206 or newer.";
      installStates.claude = {
        kind: "incompatible",
        source: "custom",
        currentVersion: "2.1.205",
        minVersion: "2.1.206",
        message,
      };

      render(<AgentSettings />);
      fireEvent.click(screen.getByRole("tab", { name: "Claude Code" }));

      fireEvent.click(screen.getByRole("button", { name: "Installation and sign-in settings" }));
      expect(screen.getByText(message)).toBeTruthy();
      expect(screen.queryByTestId("model-list-claude")).toBeNull();
    });

    it.each(DESCRIPTORS)(
      "opens $displayName configuration while the binary is absent",
      (descriptor) => {
        installStates[descriptor.id] = { kind: "absent" };
        render(<AgentSettings />);
        fireEvent.click(screen.getByRole("tab", { name: "Claude Code" }));
        fireEvent.click(screen.getByRole("button", { name: "Installation and sign-in settings" }));
        fireEvent.click(screen.getByRole("button", { name: "Configure" }));
        expect(descriptor.openInstallUI).toHaveBeenCalledTimes(1);
        expect(screen.queryByText("Recommended")).toBeNull();
      }
    );

    it("shows the resolved binary when configuration finishes installing Claude", async () => {
      installStates.claude = { kind: "absent" };
      render(<AgentSettings />);
      fireEvent.click(screen.getByRole("button", { name: "Installation and sign-in settings" }));
      fireEvent.click(screen.getByRole("button", { name: "Configure" }));
      expect(DESCRIPTORS[0].openInstallUI).toHaveBeenCalledTimes(1);

      act(() => {
        installStates.claude = { kind: "ready", source: "custom" };
        resolvedPaths.claude = MANAGED_BINARY_PATH;
        publishInstallState();
      });

      expect(await screen.findByText("Ready")).not.toBeNull();
      expect(screen.getByText(MANAGED_BINARY_PATH)).not.toBeNull();
      expect(screen.getByRole("button", { name: "Configure" })).not.toBeNull();
    });
  });
});
