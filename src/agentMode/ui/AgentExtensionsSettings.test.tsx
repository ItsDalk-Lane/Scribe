/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 测试替身必须保留实际 Hook 名称。 */
import type {
  AgentExtensionGroup,
  AgentExtensionItem,
} from "@/agentMode/session/extensionInventory";
import { AgentExtensionsSettings } from "@/agentMode/ui/AgentExtensionsSettings";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

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
const mockPlugin = {
  app: {},
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
const mockManagedSkills: Array<{ name: string; filePath: string; builtin?: boolean }> = [];
const mockModalContent = jest.fn<void, [React.ReactElement]>();
jest.mock("@/agentMode/backends/registry", () => ({ backendDisplayOrder: () => [mockDescriptor] }));
jest.mock("@/contexts/PluginContext", () => ({ usePlugin: () => mockPlugin }));
jest.mock("@/projects/state", () => ({ useProjects: () => [] }));
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
}));
jest.mock("@/settings/v2/components/CommandSettings", () => ({
  CommandSettings: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/builtinSkills/builtinSkills", () => ({ BUILTIN_SKILLS: [] }));
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
  describe("AgentExtensionsSettings()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockPending = false;
      mockManagerListeners.clear();
      mockManagedSkills.length = 0;
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
      await screen.findByRole("article", { name: "notes" });
      expect(mockList).toHaveBeenCalledWith("mcp", { kind: "user" });
      await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1));
      expect(
        screen.getByRole("switch", { name: "Enable notes" }).getAttribute("aria-checked")
      ).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Refresh and check" }));
      await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(2));
    });
    it.each(["plugin", "skill", "command", "hook", "mcp", "subagent"] as const)(
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
      await screen.findByRole("article", { name: "notes" });
      act(() => {
        mockPending = true;
        mockManagerListeners.forEach((listener) => listener());
      });
      expect(
        screen.getByRole("switch", { name: "Enable notes" }).getAttribute("aria-disabled")
      ).toBe("true");
      rerender(<AgentExtensionsSettings kind="command" />);
      await screen.findByRole("article", { name: "notes" });
      expect(
        screen.getByRole("switch", { name: "Enable notes" }).getAttribute("aria-disabled")
      ).toBe("true");
      act(() => {
        mockPending = false;
        mockManagerListeners.forEach((listener) => listener());
      });
      rerender(<AgentExtensionsSettings kind="mcp" />);
      await waitFor(() =>
        expect(
          screen.getByRole("switch", { name: "Enable notes" }).getAttribute("aria-disabled")
        ).toBe("false")
      );
    });
    it("keeps a failed check unknown and confirms availability only after a successful retry", async () => {
      mockCheck.mockRejectedValueOnce(new Error("check unavailable"));
      render(<AgentExtensionsSettings kind="mcp" />);
      await screen.findByRole("article", { name: "notes" });
      const control = screen.getByRole("switch", { name: "Enable notes" });
      expect(control.getAttribute("aria-disabled")).toBe("true");
      expect(
        screen.getByLabelText("Availability could not be confirmed. Check again.")
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Refresh and check" }));
      await waitFor(() =>
        expect(
          screen.getByRole("switch", { name: "Enable notes" }).getAttribute("aria-checked")
        ).toBe("true")
      );
    });
    it("writes a toggle using fresh details and marks configuration for the next natural agent start", async () => {
      render(<AgentExtensionsSettings kind="mcp" />);
      fireEvent.click(await screen.findByRole("switch", { name: "Enable notes" }));
      await waitFor(() =>
        expect(mockToggle).toHaveBeenCalledWith(expect.objectContaining({ revision: "v1" }), false)
      );
      await waitFor(() => expect(mockChanged).toHaveBeenCalledWith("claude"));
      await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(2));
    });
    it("preserves a plugin's local installation scope when the update action is opened from the current vault", async () => {
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
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "vault" } });
      fireEvent.click(await screen.findByRole("article", { name: "notes" }));
      await waitFor(() => expect(mockModalContent).toHaveBeenCalledTimes(1));
      const details = mockModalContent.mock.calls[0][0] as React.ReactElement<{
        onUpdate: () => Promise<void>;
      }>;
      await act(async () => details.props.onUpdate());
      expect(mockManagement.pluginAction).toHaveBeenCalledWith({
        action: "update",
        scope: { kind: "project", cwd: "/vault" },
        plugin: "notes@team",
        local: false,
        installationScope: "local",
      });
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
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "vault" } });
      fireEvent.click(await screen.findByRole("article", { name: "notes" }));
      await waitFor(() => expect(mockModalContent).toHaveBeenCalledTimes(1));
      const details = mockModalContent.mock.calls[0][0] as React.ReactElement<{
        onUpdate?: unknown;
        onDelete?: unknown;
      }>;
      expect(details.props.onUpdate).toBeUndefined();
      expect(details.props.onDelete).toBeDefined();
    });
    it("shows a plugin inherited from the user scope as unavailable without editor or uninstall actions (https://github.com/ItsDalk-Lane/Scribe/issues/1)", async () => {
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
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "vault" } });
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

    it("does not show a second empty list below the current vault's existing skill groups", async () => {
      mockList.mockResolvedValue([]);
      mockRead.mockResolvedValue([{ kind: "skill", status: "partial", warnings: [], items: [] }]);
      render(<AgentExtensionsSettings kind="skill" />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "vault" } });
      await waitFor(() => expect(screen.queryByText("Loading extensions…")).toBeNull());
      expect(screen.getByText("Managed skill items")).toBeTruthy();
      expect(screen.queryByText("No entries found in the checked sources.")).toBeNull();
    });

    it("keeps an externally linked vault skill visible after Claude confirms it loaded", async () => {
      const skill: AgentExtensionItem = {
        ...mockItem,
        kind: "skill",
        id: "/external/linked-skill/SKILL.md",
        name: "linked-skill",
        location: "/external/linked-skill/SKILL.md",
        target: {
          path: "/external/linked-skill/SKILL.md",
          format: "markdown",
          scope: { kind: "project", cwd: "/vault" },
        },
      };
      mockList.mockResolvedValue([skill]);
      mockRead.mockResolvedValue([
        { kind: "skill", status: "partial", warnings: [], items: [skill] },
      ]);
      mockCheck.mockResolvedValue({
        skills: ["linked-skill"],
        commands: [],
        plugins: [],
        failedPlugins: [],
        mcpServers: [],
      });
      render(<AgentExtensionsSettings kind="skill" />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "vault" } });
      await waitFor(() => expect(screen.queryByText("Loading extensions…")).toBeNull());
      expect(screen.getByRole("article", { name: "linked-skill" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Refresh and check" }));
      await waitFor(() =>
        expect(
          screen.getByRole("switch", { name: "Enable linked-skill" }).getAttribute("aria-checked")
        ).toBe("true")
      );
      expect(screen.getByRole("article", { name: "linked-skill" })).toBeTruthy();
    });

    it("hides only skills already shown by the managed list, preserving another file with the same name", async () => {
      const managedPath = "/vault/scribe/skills/review/SKILL.md";
      mockManagedSkills.push({ name: "review", filePath: managedPath });
      const skills: AgentExtensionItem[] = [managedPath, "/external/review/SKILL.md"].map(
        (path) => ({
          ...mockItem,
          kind: "skill",
          id: path,
          name: "review",
          location: path,
          target: { path, format: "markdown", scope: { kind: "project", cwd: "/vault" } },
        })
      );
      mockList.mockResolvedValue(skills);
      mockRead.mockResolvedValue([
        { kind: "skill", status: "partial", warnings: [], items: skills },
      ]);
      render(<AgentExtensionsSettings kind="skill" />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "vault" } });
      await waitFor(() => expect(screen.queryByText("Loading extensions…")).toBeNull());
      expect(screen.getAllByRole("article", { name: "review" })).toHaveLength(1);
      fireEvent.click(screen.getByRole("article", { name: "review" }));
      await waitFor(() =>
        expect(mockDetails).toHaveBeenCalledWith(
          expect.objectContaining({ location: "/external/review/SKILL.md" })
        )
      );
    });

    it("changes the selected source without attributing the old source's entries to it", async () => {
      mockCheck.mockResolvedValue({
        skills: [],
        commands: [],
        plugins: [],
        failedPlugins: [],
        mcpServers: [],
      });
      let resolveOld!: (value: readonly AgentExtensionItem[]) => void;
      const oldInventory = new Promise<readonly AgentExtensionItem[]>((resolve) => {
        resolveOld = resolve;
      });
      mockList.mockImplementation((kind, scope) =>
        scope.kind === "user"
          ? oldInventory
          : Promise.resolve(
              kind === "mcp" ? [{ ...mockItem, id: "user", name: "personal", source: "user" }] : []
            )
      );
      render(<AgentExtensionsSettings kind="mcp" />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "vault" } });
      await screen.findByRole("article", { name: "personal" });
      resolveOld([mockItem]);
      await waitFor(() =>
        expect(mockList).toHaveBeenCalledWith("mcp", { kind: "project", cwd: "/vault" })
      );
      expect(screen.queryByRole("article", { name: "notes" })).toBeNull();
    });
  });
});
