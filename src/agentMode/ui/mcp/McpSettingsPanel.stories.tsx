import type { DragEndEvent } from "@dnd-kit/core";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

import type { McpServerConfig, McpServerState } from "@/agentMode/mcp/types";
import {
  McpServerList,
  McpServerRow,
  type McpServerListProps,
  type McpServerRowProps,
} from "./McpSettingsPanel";
import type { McpServerView } from "./mcpUiState";

const server = (overrides: Partial<McpServerConfig>): McpServerConfig => ({
  id: overrides.id ?? "srv-1",
  name: "files",
  type: "stdio",
  command: "npx",
  args: ["-y", "mcp-server-files"],
  isActive: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const state = (overrides: Partial<McpServerState> & { serverId: string }): McpServerState => ({
  status: "disabled",
  toolCount: 0,
  ...overrides,
});

const views = (entries: [McpServerConfig, McpServerState][]): McpServerView[] =>
  entries.map(([config, runtimeState]) => ({ server: config, state: runtimeState }));

const SAMPLE_VIEWS = views([
  [
    server({ id: "a", name: "filesystem", isActive: true, description: "Local file access" }),
    state({ serverId: "a", status: "connected", version: "1.2.0", toolCount: 11 }),
  ],
  [
    server({
      id: "b",
      name: "web-search",
      type: "sse",
      url: "https://mcp.example.com/sse",
      isActive: true,
    }),
    state({ serverId: "b", status: "connecting", toolCount: 0 }),
  ],
  [
    server({
      id: "c",
      name: "broken",
      type: "streamableHttp",
      url: "http://localhost:3000/mcp",
      isActive: true,
    }),
    state({ serverId: "c", status: "error", lastError: "connect ECONNREFUSED 127.0.0.1:3000" }),
  ],
  [
    server({
      id: "d",
      name: "memory",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
    }),
    state({ serverId: "d", status: "disabled" }),
  ],
]);

const meta = {
  title: "Settings/MCP server list",
  component: McpServerList,
  args: {
    onEdit: () => undefined,
    onToggle: () => undefined,
    onReorder: () => undefined,
    emptyMessage: "No MCP servers configured yet.",
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<McpServerListProps>;
export default meta;

export const Populated: StoryObj<McpServerListProps> = { args: { views: SAMPLE_VIEWS } };

export const Empty: StoryObj<McpServerListProps> = {
  args: { views: [], emptyMessage: "No MCP servers configured yet." },
};

export const SearchNoMatch: StoryObj<McpServerListProps> = {
  args: { views: [], emptyMessage: "No servers match the current filters." },
};

export const SingleRowStates: StoryObj<McpServerRowProps> = {
  render: function RowStatesPreview() {
    const configs = [
      server({ id: "r1", name: "connected", isActive: true }),
      server({ id: "r2", name: "connecting", type: "sse", url: "https://x/sse", isActive: true }),
      server({
        id: "r3",
        name: "errored",
        type: "streamableHttp",
        url: "http://x/mcp",
        isActive: true,
      }),
      server({ id: "r4", name: "disabled" }),
    ];
    const statuses: McpServerState[] = [
      state({ serverId: "r1", status: "connected", version: "3.0.1", toolCount: 4 }),
      state({ serverId: "r2", status: "connecting" }),
      state({ serverId: "r3", status: "error", lastError: "spawn npx ENOENT" }),
      state({ serverId: "r4", status: "disabled" }),
    ];
    const [active, setActive] = React.useState<Record<string, boolean>>(() =>
      Object.fromEntries(configs.map((config) => [config.id, config.isActive]))
    );
    return (
      <div className="tw-flex tw-flex-col tw-gap-2">
        {configs.map((config, index) => (
          <McpServerRow
            key={config.id}
            server={{ ...config, isActive: active[config.id] ?? config.isActive }}
            state={statuses[index]}
            onEdit={() => undefined}
            onToggle={(target, checked) =>
              setActive((current) => ({ ...current, [target.id]: checked }))
            }
          />
        ))}
      </div>
    );
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
};

export const Reorderable: StoryObj<McpServerListProps> = {
  render: function ReorderablePreview() {
    const [current, setCurrent] = React.useState(SAMPLE_VIEWS);
    return (
      <McpServerList
        views={current}
        onEdit={() => undefined}
        onToggle={() => undefined}
        onReorder={(event: DragEndEvent) => {
          const from = current.findIndex((view) => view.server.id === event.active.id);
          const to = current.findIndex((view) => view.server.id === event.over?.id);
          if (from === -1 || to === -1) return;
          const next = [...current];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          setCurrent(next);
        }}
        emptyMessage=""
      />
    );
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
};
