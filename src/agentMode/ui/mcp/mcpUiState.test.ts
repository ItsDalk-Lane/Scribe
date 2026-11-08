import type { App } from "obsidian";
import { DEFAULT_SETTINGS } from "@/constants";
import type { McpServerConfig } from "@/agentMode/mcp/types";
import {
  getSettings,
  setSettings,
  settingsAtom,
  settingsStore,
  type ScribeSettings,
} from "@/settings/model";
import { resetPersistenceState } from "@/services/settingsPersistence";
import { writeMcpServers } from "./mcpUiState";

jest.mock("@/agentMode/mcp/McpServerManager", () => ({ getMcpServerManager: () => null }));

function server(id: string): McpServerConfig {
  return {
    id,
    name: id,
    type: "streamableHttp",
    url: "https://example.com/mcp",
    isActive: false,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}

function appWithSave(saveData: (data: ScribeSettings) => Promise<void>): App {
  return { plugins: { getPlugin: () => ({ saveData }) } } as unknown as App;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("mcpUiState", () => {
  describe("writeMcpServers()", () => {
    beforeEach(() => {
      resetPersistenceState();
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, mcp: { servers: [] } });
    });

    it("publishes the new server list only after its configuration has been saved", async () => {
      const started = deferred();
      const persisted = deferred();
      const records: ScribeSettings[] = [];
      const app = appWithSave(async (data) => {
        records.push(data);
        started.resolve();
        await persisted.promise;
      });
      const write = writeMcpServers(app, (servers) => [...servers, server("search")]);
      await started.promise;
      expect(getSettings().mcp.servers).toEqual([]);
      persisted.resolve();
      await write;
      expect(records[0].mcp.servers.map((entry) => entry.name)).toEqual(["search"]);
      expect(getSettings().mcp.servers).toEqual([server("search")]);
    });

    it("preserves the previous list and propagates a failed configuration save", async () => {
      const previous = server("existing");
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, mcp: { servers: [previous] } });
      const app = appWithSave(async () => {
        throw new Error("synthetic disk failure");
      });
      await expect(writeMcpServers(app, () => [server("replacement")])).rejects.toThrow(
        "synthetic disk failure"
      );
      expect(getSettings().mcp.servers).toEqual([previous]);
    });

    it("saves an unrelated preference changed while the server configuration is being written", async () => {
      const started = deferred();
      const firstSaved = deferred();
      const records: ScribeSettings[] = [];
      const app = appWithSave(async (data) => {
        records.push(data);
        if (records.length === 1) {
          started.resolve();
          await firstSaved.promise;
        }
      });
      const update = jest.fn((servers: McpServerConfig[]) => [...servers, server("search")]);
      const write = writeMcpServers(app, update);
      await started.promise;
      setSettings({ debug: !DEFAULT_SETTINGS.debug });
      firstSaved.resolve();
      await write;
      const lastSaved = records[records.length - 1];
      expect(lastSaved.debug).toBe(!DEFAULT_SETTINGS.debug);
      expect(lastSaved.mcp.servers.map((entry) => entry.name)).toEqual(["search"]);
      expect(getSettings().debug).toBe(!DEFAULT_SETTINGS.debug);
      expect(update).toHaveBeenCalledTimes(1);
    });

    it("applies consecutive changes to the latest saved list without losing either server", async () => {
      const started = deferred();
      const firstSaved = deferred();
      const records: ScribeSettings[] = [];
      const app = appWithSave(async (data) => {
        records.push(data);
        if (records.length === 1) {
          started.resolve();
          await firstSaved.promise;
        }
      });
      const first = writeMcpServers(app, (servers) => [...servers, server("first")]);
      const second = writeMcpServers(app, (servers) => [...servers, server("second")]);
      await started.promise;
      expect(records).toHaveLength(1);
      firstSaved.resolve();
      await Promise.all([first, second]);
      expect(records.map((data) => data.mcp.servers.map((entry) => entry.name))).toEqual([
        ["first"],
        ["first", "second"],
      ]);
      expect(getSettings().mcp.servers.map((entry) => entry.name)).toEqual(["first", "second"]);
    });
  });
});
