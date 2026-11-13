import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

import {
  McpToolsSection,
  type McpDirectToolState,
  type McpToolsSectionProps,
} from "./McpToolsSection";

const TOOLS = [
  {
    name: "read_file",
    description: "Read the contents of a file at a path.",
    inputSchema: {
      type: "object",
      description: "Arguments for reading a file.",
      properties: {
        path: { type: "string", description: "Absolute path to the file." },
        encoding: { type: "string", enum: ["utf-8", "base64"], description: "Text encoding." },
        options: {
          type: "object",
          description: "Additional read options.",
          properties: {
            maxBytes: { type: "number", description: "Read at most this many bytes." },
            head: { type: "boolean", description: "Only read the head of the file." },
          },
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description: "List entries of a directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        depth: { type: "number", description: "Levels to descend." },
      },
      required: ["path"],
    },
  },
  {
    name: "run_query",
    description: "Run a saved query.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", description: "Query identifiers.", items: { type: "string" } },
      },
    },
  },
  {
    name: "search_web",
    description: "Find current information on the public web.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  },
];

const meta = {
  title: "Settings/MCP tools section",
  component: McpToolsSection,
  args: {
    onToggleTool: () => undefined,
    onToggleAutoApprove: () => undefined,
    onToggleDirect: () => undefined,
    directToolStates: new Map([["search_web", "web-search"]]),
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<McpToolsSectionProps>;
export default meta;

export const WithTools: StoryObj<McpToolsSectionProps> = {
  args: { tools: TOOLS, disabledTools: [], autoApprovedTools: [] },
};

export const MixedToggles: StoryObj<McpToolsSectionProps> = {
  args: {
    tools: TOOLS,
    disabledTools: ["run_query"],
    autoApprovedTools: ["read_file"],
    directToolStates: new Map([
      ["read_file", "approved"],
      ["search_web", "web-search"],
    ]),
  },
};

export const NoTools: StoryObj<McpToolsSectionProps> = {
  args: { tools: [], disabledTools: [], autoApprovedTools: [] },
};

export const Interactive: StoryObj<McpToolsSectionProps> = {
  render: function InteractivePreview() {
    const [disabled, setDisabled] = React.useState<readonly string[]>([]);
    const [approved, setApproved] = React.useState<readonly string[]>([]);
    const [direct, setDirect] = React.useState<ReadonlyMap<string, McpDirectToolState>>(
      () => new Map([["search_web", "web-search"]])
    );
    return (
      <McpToolsSection
        tools={TOOLS}
        disabledTools={disabled}
        autoApprovedTools={approved}
        directToolStates={direct}
        onToggleDirect={(name, value) =>
          setDirect((current) => {
            const next = new Map(current);
            if (value) next.set(name, "approved");
            else next.delete(name);
            return next;
          })
        }
        onToggleTool={(name, enabled) =>
          setDisabled((current) =>
            enabled ? current.filter((entry) => entry !== name) : [...new Set([...current, name])]
          )
        }
        onToggleAutoApprove={(name, value) =>
          setApproved((current) =>
            value ? [...new Set([...current, name])] : current.filter((entry) => entry !== name)
          )
        }
      />
    );
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
};

export const Saving: StoryObj<McpToolsSectionProps> = {
  args: { tools: TOOLS, disabled: true, disabledTools: [], autoApprovedTools: [] },
};

export const DeferredLoading: StoryObj<McpToolsSectionProps> = {
  args: {
    tools: TOOLS,
    disabledTools: [],
    autoApprovedTools: ["read_file"],
    directToolStates: new Map([
      ["read_file", "approved"],
      ["search_web", "web-search"],
    ]),
    deferred: true,
  },
};

export const FullRegistration: StoryObj<McpToolsSectionProps> = {
  args: {
    tools: TOOLS,
    disabledTools: ["run_query"],
    autoApprovedTools: [],
    deferred: false,
    directToolStates: new Map([
      ["read_file", "approved"],
      ["search_web", "web-search"],
    ]),
  },
};
