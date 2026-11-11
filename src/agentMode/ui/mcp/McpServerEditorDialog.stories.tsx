import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

import type { McpServerConfig } from "@/agentMode/mcp/types";
import {
  McpServerEditorContent,
  type McpServerEditorContentProps,
  type McpServerEditorRuntime,
} from "./McpServerEditorDialog";

const server = (overrides: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: "srv-1",
  name: "filesystem",
  type: "stdio",
  command: "npx",
  args: ["-y", "mcp-server-files"],
  isActive: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const runtime = (overrides: Partial<McpServerEditorRuntime>): McpServerEditorRuntime => ({
  status: "disabled",
  tools: [],
  ...overrides,
});

const TOOLS = [
  {
    name: "read_file",
    description: "Read the contents of a file at a path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file." },
        encoding: { type: "string", enum: ["utf-8", "base64"], description: "Text encoding." },
      },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description: "List entries of a directory.",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  },
];

const meta = {
  title: "Modal/MCP server editor",
  component: (props: McpServerEditorContentProps) => (
    <div className="tw-flex tw-h-[70vh] tw-min-h-0 tw-flex-col">
      <McpServerEditorContent {...props} />
    </div>
  ),
  args: {
    onSave: () => undefined,
    onCancel: () => undefined,
  },
  parameters: {
    gallery: { host: "modal", layout: "padded", modalClass: "scribe-modal-untitled" },
  },
} satisfies Meta<McpServerEditorContentProps>;
export default meta;

export const CreateStdio: StoryObj<McpServerEditorContentProps> = {
  args: {
    mode: "create",
    server: null,
    runtime: runtime({ status: "disabled" }),
  },
};

export const EditConnectedStdio: StoryObj<McpServerEditorContentProps> = {
  args: {
    mode: "edit",
    server: server({
      isActive: true,
      timeoutSeconds: 120,
      longRunning: true,
      env: { HOME: "/home/user" },
      secretRefs: [{ scope: "env", key: "API_KEY", secretId: "mcp:srv-1:env:API_KEY" }],
      disabledTools: ["list_directory"],
      autoApprovedTools: ["read_file"],
    }),
    runtime: runtime({ status: "connected", version: "1.2.0", tools: TOOLS }),
    liveActive: true,
    onToggleActive: () => undefined,
  },
};

export const EditRemoteWithError: StoryObj<McpServerEditorContentProps> = {
  args: {
    mode: "edit",
    server: server({
      name: "web-search",
      type: "sse",
      url: "https://mcp.example.com/sse",
      headers: { "X-Trace": "abc" },
      isActive: true,
    }),
    runtime: runtime({ status: "error", lastError: "connect ECONNREFUSED 127.0.0.1:3000" }),
    liveActive: true,
    onToggleActive: () => undefined,
  },
};

export const ToolsTab: StoryObj<McpServerEditorContentProps> = {
  name: "Tools tab (connected)",
  args: {
    mode: "edit",
    server: server({ isActive: true }),
    runtime: runtime({ status: "connected", version: "1.2.0", tools: TOOLS }),
    initialTab: "tools",
  },
};

export const Saving: StoryObj<McpServerEditorContentProps> = {
  args: {
    mode: "edit",
    server: server(),
    runtime: runtime({ status: "connecting" }),
    saving: true,
  },
};
