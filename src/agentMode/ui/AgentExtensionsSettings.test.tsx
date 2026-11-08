/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 测试替身必须保留实际 Hook 名称。 */
import type {
  AgentExtensionGroup,
  AgentExtensionItem,
} from "@/agentMode/session/extensionInventory";
import { resetExtensionCheckCacheForTests } from "@/agentMode/session/extensionCheckCache";
import { resetExpandedExtensionSectionsForTests } from "@/agentMode/ui/AgentExtensionsPanel";
import { AgentExtensionsSettings, EXTENSION_KINDS } from "@/agentMode/ui/AgentExtensionsSettings";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

jest.mock("@/agentMode/subagents/ui/SubagentsSettings", () => ({
  SubagentsSettings: () => <section aria-label="Custom subagent management" />,
}));

const expandAllSections = async () => {
  await waitFor(() => {
    const triggers = screen
      .getAllByRole("button")
      .filter((trigger) => trigger.getAttribute("aria-expanded") !== null);
    expect(triggers.length).toBeGreaterThan(0);
    for (const trigger of triggers) {
      if (trigger.getAttribute("aria-expanded") === "false") fireEvent.click(trigger);
    }
  });
};

const mockItem: AgentExtensionItem = {
  id: "test",
  name: "notes",
  kind: "mcp",
  source: "project",
  enabled: true,
  capabilities: { edit: true, delete: true, toggle: true },
  target: {
    path: "/vault/.mcp.json",
    format: "json",
    keyPath: ["mcpServers", "notes"],
    scope: { kind: "project", cwd: "/vault" },
  },
};
const mockList = jest.fn(),
  mockToggle = jest.fn(),
  mockDetails = jest.fn(),
  mockCheck = jest.fn(),
  mockRead = jest.fn(),
  mockChanged = jest.fn();
const mockManagement = {
  list: mockList,
  toggle: mockToggle,
  details: mockDetails,
  save: jest.fn(),
  delete: jest.fn(),
  import: jest.fn(),
  pluginAction: jest.fn(),
  marketplaces: jest.fn(),
  testConnection: jest.fn(),
};
const mockDescriptor = {
  id: "claude",
  displayName: "Claude",
  createExtensionManager: () => mockManagement,
  readExtensions: mockRead,
  checkExtensions: mockCheck,
};
const mockLocalStorage = new Map<string, unknown>();
const mockApp = {
  loadLocalStorage: (key: string) => mockLocalStorage.get(key) ?? null,
  saveLocalStorage: (key: string, data: unknown) => {
    mockLocalStorage.set(key, data);
  },
};
const mockPlugin = {
  app: mockApp,
  skills: { refresh: jest.fn().mockResolvedValue(undefined) },
  agentSessionManager: {
    getSessions: () => [],
    isBackendEnabled: () => true,
    noteExtensionsChanged: mockChanged,
    isExtensionChangePending: () => mockPending,
    subscribe: (listener: () => void) => {
      mockManagerListeners.add(listener);
      return () => mockManagerListeners.delete(listener);
    },
  },
};
const mockSettings = {};
let mockPending = false;
const mockManagerListeners = new Set<() => void>();
const mockManagedSkills: Array<{ name: string; filePath: string }> = [];
const mockOpenNewSkill = jest.fn();
const mockModalContent = jest.fn<void, [React.ReactElement]>();
jest.mock("@/agentMode/backends/registry", () => ({ backendDisplayOrder: () => [mockDescriptor] }));
jest.mock("@/contexts/PluginContext", () => ({ usePlugin: () => mockPlugin }));
const mockProjects: Array<{ id: string; name: string }> = [];
const LISTS_PER_LOAD = 2 * EXTENSION_KINDS.length;
jest.mock("@/projects/state", () => ({ useProjects: () => mockProjects }));
jest.mock("@/agentMode/session/sessionScope", () => ({
  resolveScopeCwd: (base: string, id: string) => `${base}/${id}`,
}));
jest.mock("@/settings/model", () => ({ useSettingsValue: () => mockSettings }));
jest.mock("@/utils/vaultPath", () => ({ getVaultBase: () => "/vault" }));
jest.mock("@/agentMode/skills/SkillManager", () => ({ useManagedSkills: () => mockManagedSkills }));
jest.mock("@/commands/state", () => ({ useCustomCommands: () => [] }));
jest.mock("@/agentMode/skills/ui/SkillsSettings", () => ({
  SkillsSettings: ({ children }: { children: React.ReactNode }) => (
    <>
      <span>Managed skill items</span>
      {children}
    </>
  ),
  openNewSkillModal: (...args: unknown[]) => mockOpenNewSkill(...args),
}));
jest.mock("@/settings/v2/components/CommandSettings", () => ({
  CommandSettings: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/logger", () => ({ logError: jest.fn() }));
jest.mock("@/agentMode/ui/ExtensionDialogs", () => ({
  ExtensionModal: class {
    constructor(_app: unknown, _title: string, content: (close: () => void) => React.ReactElement) {
      mockModalContent(content(jest.fn()));
    }
    open = jest.fn();
  },
  ExtensionDetailsView: () => null,
  PluginInstallForm: () => null,
  ExtensionImportForm: () => null,
}));

describe("AgentExtensionsSettings", () => {
  describe("AgentExtensionsSettings", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      resetExtensionCheckCacheForTests();
      resetExpandedExtensionSectionsForTests();
      mockLocalStorage.clear();
      mockPending = false;
      mockManagerListeners.clear();
      mockManagedSkills.length = 0;
      mockProjects.length = 0;
      mockList.mockResolvedValue([mockItem]);
      mockRead.mockResolvedValue([
        { kind: "mcp", status: "partial", warnings: [], items: [mockItem] },
      ] satisfies AgentExtensionGroup[]);
      mockCheck.mockResolvedValue({
        skills: [],
        commands: [],
        plugins: [],
        failedPlugins: [],
        mcpServers: [{ name: "notes", status: "connected", toolCount: 2 }],
      });
      mockDetails.mockResolvedValue({
        item: mockItem,
        revision: "v1",
        config: { command: "notes-server" },
      });
      mockToggle.mockResolvedValue(undefined);
    });
    it("automatically checks availability on entry and repeats the no-message check on refresh", async () => {
      render(<AgentExtensionsSettings kind="mcp" />);
      await expandAllSections();
      await screen.findByRole("article", { name: "notes" });
      expect(mockList).toHaveBeenCalledWith("mcp", { kind: "project", cwd: "/vault" });
      await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1));
      expect(
        screen.getByRole("switch", { name: "Enable notes" }).getAttribute("aria-checked")
      ).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Refresh and check" }));
      await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(2));
    });
    it("reads the current vault and every configured project in one merged list", async () => {
      mockProjects.push({ id: "proj-1", name: "Notes" });
      render(<AgentExtensionsSettings kind="mcp" />);
      await waitFor(() =>
        expect(mockList).toHaveBeenCalledWith("mcp", { kind: "project", cwd: "/vault" })
      );
      await waitFor(() =>
        expect(mockList).toHaveBeenCalledWith("mcp", {
          kind: "project",
          cwd: "/vault/proj-1",
        })
      );
    });
    it("routes skills to the single managed page without blank creation or a second runtime list", () => {
      render(<AgentExtensionsSettings kind="skill" />);
      expect(screen.getByText("Managed skill items")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "New skill" })).toBeNull();
      expect(mockList).not.toHaveBeenCalled();
      expect(mockCheck).not.toHaveBeenCalled();
    });
    it("routes the subagent settings page to custom management", () => {
      render(<AgentExtensionsSettings kind="subagent" />);
      expect(screen.getByRole("region", { name: "Custom subagent management" })).toBeTruthy();
      expect(mockCheck).not.toHaveBeenCalled();
    });
    it.each(["plugin", "command", "hook", "mcp"] as const)(
      "checks %s on entry without repeating on search",
      async (kind) => {
        render(<AgentExtensionsSettings kind={kind} />);
        await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1));
        fireEvent.change(screen.getByRole("textbox"), { target: { value: "notes" } });
        expect(mockCheck).toHaveBeenCalledTimes(1);
      }
    );
    it("keeps switches pending across page changes until existing chats have updated", async () => {
      const { rerender } = render(<AgentExtensionsSettings kind="mcp" />);
      await expandAllSections();
      await screen.findByRole("article", { name: "notes" });
      act(() => {
        mockPending = true;
        mockManagerListeners.forEach((listener) => listener());
      });
      expect(
        screen.getByRole("switch", { name: "Enable notes" }).getAttribute("aria-disabled")
      ).toBe("true");
      rerender(<AgentExtensionsSettings kind="command" />);
      await expandAllSections();
      await screen.findByRole("article", { name: "notes" });
      act(() => {
        mockPending = false;
        mockManagerListeners.forEach((listener) => listener());
      });
      rerender(<AgentExtensionsSettings kind="mcp" />);
      await expandAllSections();
      await waitFor(() =>
        expect(
          screen.getByRole("switch", { name: "Enable notes" }).getAttribute("aria-disabled")
        ).toBe("false")
      );
    });
    it("shows the unconfirmed dot after a failed check and confirms the switch only after a successful retry", async () => {
      mockCheck.mockRejectedValueOnce(new Error("check unavailable"));
      render(<AgentExtensionsSettings kind="mcp" />);
      await expandAllSections();
      await screen.findByRole("article", { name: "notes" });
      expect(screen.queryByRole("switch", { name: "Enable notes" })).toBeNull();
      expect(
        screen.getByRole("img", { name: "Availability could not be confirmed. Check again." })
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Refresh and check" }));
      await waitFor(() =>
        expect(
          screen.getByRole("switch", { name: "Enable notes" }).getAttribute("aria-checked")
        ).toBe("true")
      );
    });
    it("writes a toggle using fresh details and marks configuration for the next natural agent start without repeating an unchanged check", async () => {
      render(<AgentExtensionsSettings kind="mcp" />);
      await expandAllSections();
      fireEvent.click(await screen.findByRole("switch", { name: "Enable notes" }));
      await waitFor(() =>
        expect(mockToggle).toHaveBeenCalledWith(expect.objectContaining({ revision: "v1" }), false)
      );
      await waitFor(() => expect(mockChanged).toHaveBeenCalledWith("claude"));
      await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2 * LISTS_PER_LOAD));
      expect(mockCheck).toHaveBeenCalledTimes(1);
    });
    it("answers from the cached check while the configuration is unchanged and rechecks on an explicit refresh", async () => {
      const first = render(<AgentExtensionsSettings kind="mcp" />);
      await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1));
      await expandAllSections();
      expect(
        screen.getByRole("switch", { name: "Enable notes" }).getAttribute("aria-checked")
      ).toBe("true");
      first.unmount();

      render(<AgentExtensionsSettings kind="mcp" />);
      expect(screen.queryByText("Loading extensions…")).toBeNull();
      await screen.findByRole("article", { name: "notes" });
      expect(
        screen.getByRole("switch", { name: "Enable notes" }).getAttribute("aria-checked")
      ).toBe("true");
      expect(mockCheck).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Refresh and check" }));
      await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(2));
    });
    it("starts a fresh check after a plugin reload without restoring an old local-storage answer", async () => {
      const first = render(<AgentExtensionsSettings kind="mcp" />);
      await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1));
      await expandAllSections();
      first.unmount();
      resetExtensionCheckCacheForTests();

      render(<AgentExtensionsSettings kind="mcp" />);
      expect(screen.getByText("Loading extensions…")).not.toBeNull();
      await expandAllSections();
      expect(
        screen.getByRole("switch", { name: "Enable notes" }).getAttribute("aria-checked")
      ).toBe("true");
      await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2 * LISTS_PER_LOAD));
      expect(mockCheck).toHaveBeenCalledTimes(2);
      expect(mockLocalStorage.size).toBe(0);
    });
    it("checks again when the saved answer no longer matches the configuration", async () => {
      const first = render(<AgentExtensionsSettings kind="mcp" />);
      await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1));
      first.unmount();
      mockList.mockResolvedValue([{ ...mockItem, id: "added", name: "added" }]);

      render(<AgentExtensionsSettings kind="mcp" />);
      await expandAllSections();
      await screen.findByRole("article", { name: "added" });
      await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(2));
    });
    it("shows the connecting dot and replaces it with the switch once the settle continuation reports", async () => {
      let deliver!: (runtime: unknown) => void;
      mockCheck.mockImplementation(async ({ onUpdate }) => {
        deliver = (runtime: unknown) => onUpdate(runtime);
        return {
          skills: [],
          commands: [],
          plugins: [],
          failedPlugins: [],
          mcpServers: [{ name: "notes", status: "pending" }],
        };
      });
      render(<AgentExtensionsSettings kind="mcp" />);
      await expandAllSections();
      await screen.findByRole("article", { name: "notes" });
      expect(screen.queryByRole("switch", { name: "Enable notes" })).toBeNull();
      expect(screen.getByRole("img", { name: "Connecting…" })).toBeTruthy();

      await act(async () => {
        deliver({
          skills: [],
          commands: [],
          plugins: [],
          failedPlugins: [],
          mcpServers: [{ name: "notes", status: "connected", toolCount: 2 }],
        });
      });

      await waitFor(() =>
        expect(
          screen.getByRole("switch", { name: "Enable notes" }).getAttribute("aria-checked")
        ).toBe("true")
      );
    });
    it("keeps old plugin details readable without offering marketplace installation or updates", async () => {
      const plugin: AgentExtensionItem = {
        ...mockItem,
        kind: "plugin",
        id: "notes@team",
        installationScope: "local",
      };
      mockList.mockResolvedValue([plugin]);
      mockRead.mockResolvedValue([
        { kind: "plugin", status: "partial", warnings: [], items: [plugin] },
      ]);
      mockDetails.mockResolvedValue({ item: plugin, revision: "v1", config: {} });
      render(<AgentExtensionsSettings kind="plugin" />);
      await expandAllSections();
      fireEvent.click(await screen.findByRole("article", { name: "notes" }));
      await waitFor(() => expect(mockModalContent).toHaveBeenCalledTimes(1));
      const details = mockModalContent.mock.calls[0][0] as React.ReactElement<{
        onUpdate?: () => Promise<void>;
      }>;
      expect(details.props.onUpdate).toBeUndefined();
      expect(screen.queryByRole("button", { name: "Browse plugin marketplace" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Add plugin" })).toBeNull();
      expect(mockManagement.pluginAction).not.toHaveBeenCalled();
    });
    it("hides the update action for a local-directory plugin while keeping removal available", async () => {
      const plugin: AgentExtensionItem = {
        ...mockItem,
        kind: "plugin",
        id: "local:notes",
        capabilities: { edit: false, delete: true, toggle: true },
        target: {
          path: "/vault/.claude/.scribe/extensions.json",
          format: "json",
          keyPath: ["localPlugins", "local:notes"],
          scope: { kind: "project", cwd: "/vault" },
        },
      };
      mockList.mockResolvedValue([plugin]);
      mockRead.mockResolvedValue([
        { kind: "plugin", status: "partial", warnings: [], items: [plugin] },
      ]);
      mockDetails.mockResolvedValue({ item: plugin, revision: "v1", config: {} });
      render(<AgentExtensionsSettings kind="plugin" />);
      await expandAllSections();
      fireEvent.click(await screen.findByRole("article", { name: "notes" }));
      await waitFor(() => expect(mockModalContent).toHaveBeenCalledTimes(1));
      const details = mockModalContent.mock.calls[0][0] as React.ReactElement<{
        onUpdate?: unknown;
        onDelete?: unknown;
      }>;
      expect(details.props.onUpdate).toBeUndefined();
      expect(details.props.onDelete).toBeDefined();
    });
    it("shows a plugin inherited from the user scope as unavailable without editor or uninstall actions", async () => {
      const plugin: AgentExtensionItem = {
        ...mockItem,
        kind: "plugin",
        id: "notes@team",
        installationScope: "user",
        capabilities: { edit: false, delete: false, update: false, toggle: true },
      };
      mockList.mockResolvedValue([plugin]);
      mockRead.mockResolvedValue([
        { kind: "plugin", status: "partial", warnings: [], items: [plugin] },
      ]);
      mockDetails.mockResolvedValue({ item: plugin, revision: "v1", config: {} });
      render(<AgentExtensionsSettings kind="plugin" />);
      await expandAllSections();
      fireEvent.click(await screen.findByRole("article", { name: "notes" }));
      await waitFor(() => expect(mockModalContent).toHaveBeenCalledTimes(1));
      const details = mockModalContent.mock.calls[0][0] as React.ReactElement<{
        onUpdate?: unknown;
        onDelete?: unknown;
      }>;
      expect(details.props.onUpdate).toBeUndefined();
      expect(details.props.onDelete).toBeUndefined();
      const row = within(screen.getByRole("article", { name: "notes" }));
      expect(row.queryByRole("switch")).toBeNull();
      expect(
        row.getByRole("img", { name: "This item could not be loaded in the selected scope." })
      ).toBeTruthy();
    });
    it("preserves the selected source's write target when another scope reports the same entry id", async () => {
      const userItem: AgentExtensionItem = {
        ...mockItem,
        name: "personal",
        runtimeName: "notes",
        source: "user",
        target: {
          path: "/home/.claude.json",
          format: "json",
          keyPath: ["mcpServers", "notes"],
          scope: { kind: "user" },
        },
      };
      mockList.mockResolvedValue([userItem]);
      render(<AgentExtensionsSettings kind="mcp" />);
      await expandAllSections();
      await screen.findByRole("article", { name: "personal" });
      fireEvent.click(screen.getByRole("switch", { name: "Enable personal" }));
      await waitFor(() =>
        expect(mockDetails).toHaveBeenCalledWith(
          expect.objectContaining({ target: userItem.target, source: "user" })
        )
      );
    });

    it("shows agent commands without the separate custom commands section", async () => {
      mockList.mockResolvedValue([]);
      mockRead.mockResolvedValue([{ kind: "command", status: "partial", warnings: [], items: [] }]);
      render(<AgentExtensionsSettings kind="command" />);
      await waitFor(() => expect(screen.queryByText("Loading extensions…")).toBeNull());
      expect(screen.queryByText("My commands")).toBeNull();
      expect(screen.getByText("No entries found in the checked sources.")).toBeTruthy();
    });

    it("opens the command editor from a New Commands button on the Commands tab (https://github.com/ItsDalk-Lane/Scribe/issues/53)", async () => {
      mockList.mockResolvedValue([]);
      mockRead.mockResolvedValue([{ kind: "command", status: "partial", warnings: [], items: [] }]);
      render(<AgentExtensionsSettings kind="command" />);
      await waitFor(() => expect(screen.queryByText("Loading extensions…")).toBeNull());
      fireEvent.click(screen.getByRole("button", { name: "New Commands" }));
      expect(mockModalContent).toHaveBeenCalledTimes(1);
    });

    it("does not expose external or runtime-only skills through a second management interface", () => {
      mockList.mockResolvedValue([
        { ...mockItem, kind: "skill", source: "runtime", name: "external-only" },
      ]);
      render(<AgentExtensionsSettings kind="skill" />);
      expect(screen.getByText("Managed skill items")).toBeTruthy();
      expect(screen.queryByText("external-only")).toBeNull();
      expect(mockList).not.toHaveBeenCalled();
    });

    it("keeps entries from different scopes side by side", async () => {
      const userItem: AgentExtensionItem = {
        ...mockItem,
        id: "global",
        name: "global",
        source: "user",
        target: {
          path: "/home/.mcp.json",
          format: "json",
          keyPath: ["mcpServers", "global"],
          scope: { kind: "user" },
        },
      };
      mockList.mockImplementation(async (_entryKind, scope) =>
        scope.kind === "user" ? [userItem] : [{ ...mockItem, id: "personal", name: "personal" }]
      );
      render(<AgentExtensionsSettings kind="mcp" />);
      await expandAllSections();
      expect(await screen.findByRole("article", { name: "global" })).toBeTruthy();
      expect(await screen.findByRole("article", { name: "personal" })).toBeTruthy();
    });
    it("reveals matching entries without manual expansion once a search query filters the list", async () => {
      render(<AgentExtensionsSettings kind="mcp" />);
      await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("switch", { name: "Enable notes" })).toBeNull();
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "notes" } });
      await waitFor(() =>
        expect(
          screen.getByRole("switch", { name: "Enable notes" }).getAttribute("aria-checked")
        ).toBe("true")
      );
      expect(mockCheck).toHaveBeenCalledTimes(1);
    });
  });
});
