import { FileSystemAdapter, type App } from "obsidian";
import { DEFAULT_SETTINGS } from "@/constants";
import { setSettings } from "@/settings/model";
import {
  buildNativeSystemPrompt,
  buildNativeSystemPromptState,
} from "@/agentMode/backends/native/nativeSystemPrompt";
import { getMcpServerManager } from "@/agentMode/mcp/McpServerManager";
import type { McpServerManager } from "@/agentMode/mcp/McpServerManager";
import type { McpServerConfig, McpToolInfo } from "@/agentMode/mcp/types";
import { mcpDirectToolFingerprint } from "@/agentMode/mcp/mcpDirectPolicy";
import { readAgentsFile } from "@/instructions/agentsFile";
import { getCachedProjectRecordById } from "@/projects/state";

jest.mock("@/agentMode/backends/shared/agentSystemPrompt", () => ({
  buildAgentSystemPrompt: () => "Scribe Obsidian identity",
}));
jest.mock("@/instructions/agentsFile", () => ({ readAgentsFile: jest.fn() }));
jest.mock("@/projects/state", () => ({ getCachedProjectRecordById: jest.fn() }));
jest.mock("@/agentMode/mcp/McpServerManager", () => ({
  getMcpServerManager: jest.fn(),
}));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

function app(): App {
  return {
    vault: {
      adapter: Object.assign(Object.create(FileSystemAdapter.prototype), {
        getBasePath: () => "/vault",
        exists: jest.fn().mockResolvedValue(false),
        read: jest.fn(),
      }),
    },
  } as unknown as App;
}

const NOTE_SEARCH_TOOL: McpToolInfo = {
  name: "search",
  description: "Search notes.",
  inputSchema: { type: "object" },
};

function mcpManagerStub(
  tools: McpToolInfo[] = [NOTE_SEARCH_TOOL],
  confirmedTools: readonly McpToolInfo[] = tools
): McpServerManager {
  const server: McpServerConfig = {
    id: "srv-1",
    name: "files",
    type: "stdio",
    command: "npx",
    isActive: true,
    createdAt: "",
    updatedAt: "",
  };
  server.directToolApprovals = Object.fromEntries(
    confirmedTools.map((tool) => [tool.name, mcpDirectToolFingerprint(server, tool)])
  );
  return {
    getRevision: () => 0,
    listEnabledServers: () => [server],
    getTools: () => tools,
  } as unknown as McpServerManager;
}

describe("nativeSystemPrompt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(readAgentsFile)
      .mockImplementation(async (_app, folder) =>
        folder ? "Project directory rules" : "Vault rules"
      );
    jest.mocked(getCachedProjectRecordById).mockReturnValue(undefined);
    jest.mocked(getMcpServerManager).mockReturnValue(null);
  });

  describe("buildNativeSystemPromptState()", () => {
    it("reuses an unchanged MCP catalog across model steps while still reading current rules https://github.com/ItsDalk-Lane/Scribe/issues/65", async () => {
      const manager = mcpManagerStub();
      const scan = jest.spyOn(manager, "listEnabledServers");
      jest.mocked(getMcpServerManager).mockReturnValue(manager);
      setSettings({
        ...DEFAULT_SETTINGS,
        agentMode: { ...DEFAULT_SETTINGS.agentMode, mcpToolLoading: "always" },
      });
      const target = app();
      const first = await buildNativeSystemPromptState(target, { cwd: "/vault" });
      for (let step = 1; step < 20; step++) {
        const next = await buildNativeSystemPromptState(target, { cwd: "/vault" });
        expect(next.sections.mcp_catalog).toBe(first.sections.mcp_catalog);
      }
      expect(scan).toHaveBeenCalledTimes(2);
      expect(readAgentsFile).toHaveBeenCalledTimes(20);
      jest.mocked(readAgentsFile).mockResolvedValue("Newly saved rules");
      const updated = await buildNativeSystemPromptState(target, { cwd: "/vault" });
      expect(updated.sections.vault_instructions).toContain("Newly saved rules");
      expect(scan).toHaveBeenCalledTimes(2);
    });

    it("rebuilds the MCP catalog for a new capability revision and coalesces intervening revisions https://github.com/ItsDalk-Lane/Scribe/issues/65", async () => {
      const old = { name: "old", inputSchema: {} };
      const current = { name: "current", description: "Current schema", inputSchema: {} };
      const manager = mcpManagerStub([old], [old, current]);
      let revision = 0;
      let tools: McpToolInfo[] = [old];
      jest.spyOn(manager, "getRevision").mockImplementation(() => revision);
      jest.spyOn(manager, "getTools").mockImplementation(() => tools);
      const scan = jest.spyOn(manager, "listEnabledServers");
      jest.mocked(getMcpServerManager).mockReturnValue(manager);
      setSettings({
        ...DEFAULT_SETTINGS,
        agentMode: { ...DEFAULT_SETTINGS.agentMode, mcpToolLoading: "always" },
      });
      const target = app();
      expect(
        (await buildNativeSystemPromptState(target, { cwd: "/vault" })).sections.mcp_catalog
      ).toContain("mcp__files__old");
      revision += 3;
      tools = [current];
      const updated = await buildNativeSystemPromptState(target, { cwd: "/vault" });
      expect(updated.sections.mcp_catalog).toContain("mcp__files__current");
      expect(updated.sections.mcp_catalog).not.toContain("mcp__files__old");
      expect(scan).toHaveBeenCalledTimes(4);
      revision++;
      tools = [];
      expect(
        (await buildNativeSystemPromptState(target, { cwd: "/vault" })).sections.mcp_catalog
      ).toBeNull();
    });

    it("invalidates the catalog for loading settings and keeps replacement managers isolated https://github.com/ItsDalk-Lane/Scribe/issues/65", async () => {
      const manager = mcpManagerStub();
      jest.mocked(getMcpServerManager).mockReturnValue(manager);
      const target = app();
      const settings = {
        ...DEFAULT_SETTINGS,
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          mcpToolLoading: "auto" as const,
          mcpToolLoadingThresholdChars: 1,
        },
      };
      setSettings(settings);
      expect(
        (await buildNativeSystemPromptState(target, { cwd: "/vault" })).sections.mcp_catalog
      ).toContain("mcp__files__search");
      setSettings({
        ...settings,
        agentMode: { ...settings.agentMode, mcpToolLoadingThresholdChars: 100000 },
      });
      expect(
        (await buildNativeSystemPromptState(target, { cwd: "/vault" })).sections.mcp_catalog
      ).toBeNull();
      setSettings({ ...settings, agentMode: { ...settings.agentMode, mcpToolLoading: "off" } });
      expect(
        (await buildNativeSystemPromptState(target, { cwd: "/vault" })).sections.mcp_catalog
      ).toBeNull();
      setSettings(settings);
      expect(
        (await buildNativeSystemPromptState(target, { cwd: "/vault", purpose: "skill-authoring" }))
          .sections.mcp_catalog
      ).toBeNull();
      const replacement = mcpManagerStub([{ name: "replacement", inputSchema: {} }]);
      jest.mocked(getMcpServerManager).mockReturnValue(replacement);
      const updated = await buildNativeSystemPromptState(target, { cwd: "/vault" });
      expect(updated.sections.mcp_catalog).toContain("mcp__files__replacement");
      expect(updated.sections.mcp_catalog).not.toContain("mcp__files__search");
    });

    it("omits unconfirmed and advertised search tools and withdraws an alias selected for web search without a connection revision https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      const web = { name: "web_search", inputSchema: {} };
      const selected = { name: "retrieve", inputSchema: {} };
      const unconfirmed = { name: "lookup", inputSchema: {} };
      const manager = mcpManagerStub(
        [NOTE_SEARCH_TOOL, web, selected, unconfirmed],
        [NOTE_SEARCH_TOOL, web, selected]
      );
      jest.mocked(getMcpServerManager).mockReturnValue(manager);
      const target = app();
      const settings = { ...DEFAULT_SETTINGS.agentMode, mcpToolLoading: "always" as const };
      setSettings({ ...DEFAULT_SETTINGS, agentMode: settings });
      const initial = (await buildNativeSystemPromptState(target, { cwd: "/vault" })).sections
        .mcp_catalog;
      expect(initial).toContain("mcp__files__retrieve");
      expect(initial).not.toContain("mcp__files__lookup");
      expect(initial).not.toContain("mcp__files__web_search");

      setSettings({
        agentMode: {
          ...settings,
          webSearch: {
            preferred: "builtin",
            mcp: { serverId: "srv-1", toolName: "retrieve", queryParameter: "query" },
          },
        },
      });
      const updated = (await buildNativeSystemPromptState(target, { cwd: "/vault" })).sections
        .mcp_catalog;
      expect(updated).toContain("mcp__files__search");
      expect(updated).not.toContain("mcp__files__retrieve");
    });

    it("returns stable named sections and explicit removals rather than merging rule files into the base", async () => {
      const initial = await buildNativeSystemPromptState(app(), { cwd: "/vault/Research" });
      expect(initial.content).toContain("Scribe Obsidian identity");
      expect(initial.content).not.toContain("Vault rules");
      expect(initial.sections.vault_instructions).toContain("Vault rules");
      expect(initial.sections.working_directory_instructions).toContain("Project directory rules");
      jest.mocked(readAgentsFile).mockResolvedValue("");
      const cleared = await buildNativeSystemPromptState(app(), { cwd: "/vault/Research" });
      expect(cleared.sections).toEqual({
        vault_instructions: null,
        project_instructions: null,
        working_directory_instructions: null,
        mcp_catalog: null,
      });
    });
  });

  describe("buildNativeSystemPrompt()", () => {
    it("combines Scribe identity, vault rules and only the selected project's own instructions in a fixed order", async () => {
      const target = app();
      jest.mocked(getCachedProjectRecordById).mockReturnValue({
        project: { systemPrompt: "Selected project instructions" },
      } as ReturnType<typeof getCachedProjectRecordById>);
      const prompt = await buildNativeSystemPrompt(target, {
        cwd: "/vault/Projects/Research",
        projectId: "research",
      });
      const parts = [
        "Scribe Obsidian identity",
        "Vault rules",
        "Selected project instructions",
        "Project directory rules",
      ];
      for (const part of parts) expect(prompt).toContain(part);
      expect(parts.map((part) => prompt.indexOf(part))).toEqual(
        [...parts.map((part) => prompt.indexOf(part))].sort((a, b) => a - b)
      );
      expect(jest.mocked(readAgentsFile).mock.calls.map((args) => args[1])).toEqual([
        "",
        "Projects/Research",
      ]);
      expect(getCachedProjectRecordById).toHaveBeenCalledWith("research");
    });
    it("keeps global chat free of other projects' instructions and reads vault AGENTS only once", async () => {
      const prompt = await buildNativeSystemPrompt(app(), { cwd: "/vault" });
      expect(prompt).toContain("Vault rules");
      expect(prompt).not.toContain("Project directory rules");
      expect(getCachedProjectRecordById).not.toHaveBeenCalled();
      expect(readAgentsFile).toHaveBeenCalledTimes(1);
    });
    it("ignores retired custom prompt settings without reading their selected directory", async () => {
      const target = app();
      jest.mocked(target.vault.adapter.exists).mockResolvedValue(true);
      jest
        .mocked(target.vault.adapter.read)
        .mockResolvedValue("---\ntitle: Selected\n---\n\nSelected prompt body");
      setSettings({
        ...DEFAULT_SETTINGS,
        ...{ defaultSystemPromptTitle: "Selected", userSystemPrompt: "Legacy text" },
      });
      const prompt = await buildNativeSystemPrompt(target, { cwd: "/vault" });
      expect(prompt).not.toContain("Selected prompt body");
      expect(prompt).not.toContain("Legacy text");
      expect(prompt).not.toContain("title: Selected");
      expect(target.vault.adapter.exists).not.toHaveBeenCalled();
      expect(target.vault.adapter.read).not.toHaveBeenCalled();
    });
    it("rejects a non-desktop vault before reading instructions", async () => {
      await expect(
        buildNativeSystemPrompt({ vault: { adapter: {} } } as unknown as App, { cwd: "/vault" })
      ).rejects.toThrow("desktop vault");
      expect(readAgentsFile).not.toHaveBeenCalled();
    });
    it("rejects a working directory outside the current vault before reading any instructions", async () => {
      await expect(buildNativeSystemPrompt(app(), { cwd: "/other-vault" })).rejects.toThrow(
        "must belong"
      );
      expect(readAgentsFile).not.toHaveBeenCalled();
    });

    it("appends the deferred MCP tool catalog when deferred loading is active https://github.com/ItsDalk-Lane/Scribe/issues/65", async () => {
      jest.mocked(getMcpServerManager).mockReturnValue(mcpManagerStub());
      setSettings({
        ...DEFAULT_SETTINGS,
        agentMode: { ...DEFAULT_SETTINGS.agentMode, mcpToolLoading: "always" },
      });
      const prompt = await buildNativeSystemPrompt(app(), { cwd: "/vault" });
      expect(prompt).toContain("<mcp_tool_catalog>");
      expect(prompt).toContain("mcp__files__search — Search notes.");
      expect(prompt).toContain("tool_search");
    });

    it("omits the MCP catalog below the auto threshold and when loading is off https://github.com/ItsDalk-Lane/Scribe/issues/65", async () => {
      jest.mocked(getMcpServerManager).mockReturnValue(mcpManagerStub());
      setSettings({
        ...DEFAULT_SETTINGS,
        agentMode: { ...DEFAULT_SETTINGS.agentMode, mcpToolLoading: "auto" },
      });
      expect(await buildNativeSystemPrompt(app(), { cwd: "/vault" })).not.toContain(
        "<mcp_tool_catalog>"
      );
      setSettings({
        ...DEFAULT_SETTINGS,
        agentMode: { ...DEFAULT_SETTINGS.agentMode, mcpToolLoading: "off" },
      });
      expect(await buildNativeSystemPrompt(app(), { cwd: "/vault" })).not.toContain(
        "<mcp_tool_catalog>"
      );
    });

    it("omits the MCP catalog for skill-authoring chats even when deferred loading is active https://github.com/ItsDalk-Lane/Scribe/issues/65", async () => {
      jest.mocked(getMcpServerManager).mockReturnValue(mcpManagerStub());
      setSettings({
        ...DEFAULT_SETTINGS,
        agentMode: { ...DEFAULT_SETTINGS.agentMode, mcpToolLoading: "always" },
      });
      const prompt = await buildNativeSystemPrompt(app(), {
        cwd: "/vault",
        purpose: "skill-authoring",
      });
      expect(prompt).not.toContain("<mcp_tool_catalog>");
    });
  });
});
