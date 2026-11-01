/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 测试替身必须保留实际 Hook 名称。 */
import type {
  AgentExtensionGroup,
  AgentExtensionItem,
} from "@/agentMode/session/extensionInventory";
import { AgentExtensionsSettings } from "@/agentMode/ui/AgentExtensionsSettings";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  },
};
const mockSettings = {};
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
    it("reads configuration without starting an agent, then performs an explicit no-message check on refresh", async () => {
      render(<AgentExtensionsSettings kind="mcp" />);
      await screen.findByRole("article", { name: "notes" });
      expect(mockList).toHaveBeenCalledWith("mcp", { kind: "user" });
      expect(mockCheck).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Refresh and check" }));
      await screen.findByText("Connected · 2 tools");
      expect(mockCheck).toHaveBeenCalledTimes(1);
    });
    it("writes a toggle using fresh details and marks configuration for the next natural agent start", async () => {
      render(<AgentExtensionsSettings kind="mcp" />);
      fireEvent.click(await screen.findByRole("switch", { name: "Enable notes" }));
      await waitFor(() =>
        expect(mockToggle).toHaveBeenCalledWith(expect.objectContaining({ revision: "v1" }), false)
      );
      await waitFor(() => expect(mockChanged).toHaveBeenCalledWith("claude"));
      expect(mockCheck).not.toHaveBeenCalled();
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
    it("offers only the local enablement switch for a plugin inherited from the user scope", async () => {
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
      expect(screen.getByRole("switch", { name: "Enable notes" })).toBeTruthy();
    });
    it("preserves the selected source's write target when another scope reports the same entry id", async () => {
      const userItem: AgentExtensionItem = {
        ...mockItem,
        name: "personal",
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
      await screen.findByText("Loaded");
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
      let resolveOld!: (value: readonly AgentExtensionItem[]) => void;
      mockList.mockImplementationOnce(
        () =>
          new Promise<readonly AgentExtensionItem[]>((resolve) => {
            resolveOld = resolve;
          })
      );
      mockList.mockResolvedValueOnce([
        { ...mockItem, id: "user", name: "personal", source: "user" },
      ]);
      render(<AgentExtensionsSettings kind="mcp" />);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "vault" } });
      await screen.findByRole("article", { name: "personal" });
      resolveOld([mockItem]);
      await waitFor(() =>
        expect(mockList).toHaveBeenLastCalledWith("mcp", { kind: "project", cwd: "/vault" })
      );
      expect(screen.queryByRole("article", { name: "notes" })).toBeNull();
    });
  });
});
