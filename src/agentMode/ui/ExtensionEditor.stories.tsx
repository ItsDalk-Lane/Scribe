import type { Meta, StoryObj } from "@/lib/story";
import type { AgentExtensionDetails } from "@/agentMode/session/extensionManagement";
import { ExtensionEditor, type ExtensionEditorProps } from "./ExtensionEditor";

function details(config: Record<string, unknown>, content?: string): AgentExtensionDetails {
  return {
    item: { id: "notes", name: "notes", source: "user" },
    revision: "example",
    config,
    content,
    ...(config.type === "prompt" || config.type === "agent"
      ? { hookEvents: ["Stop", "PreToolUse", "PostToolUse", "SubagentStop"] }
      : config.type === "http"
        ? { hookEvents: ["PreToolUse", "PostToolUse", "Stop", "Notification"] }
        : {}),
  };
}

const meta = {
  title: "Agent Configuration/Editor",
  component: ExtensionEditor,
  args: { kind: "mcp", scope: { kind: "user" }, onSave: async () => {}, onClose: () => {} },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ExtensionEditorProps>;
export default meta;

export const HttpServer: StoryObj<ExtensionEditorProps> = {
  args: {
    original: details({
      type: "http",
      url: "https://example.com/mcp",
      headers: { "X-Client": "Scribe" },
    }),
    onTest: async () => "Connected: 2 tools",
  },
};
export const LocalServer: StoryObj<ExtensionEditorProps> = {
  args: {
    original: details({
      type: "stdio",
      command: "node",
      args: ["/tools/notes-server.js", "--readonly"],
      env: { NOTES_MODE: "local" },
    }),
    onTest: async () => "Connected: 1 tool",
  },
};
export const Hook: StoryObj<ExtensionEditorProps> = {
  args: {
    kind: "hook",
    original: details({
      event: "PreToolUse",
      matcher: "Read|Grep",
      command: "echo Check the selected note",
      timeout: 30,
    }),
  },
};
export const Skill: StoryObj<ExtensionEditorProps> = {
  args: {
    kind: "skill",
    original: details(
      { description: "Review notes for missing context" },
      "Read the chosen notes and list questions that need clarification."
    ),
  },
};
export const Subagent: StoryObj<ExtensionEditorProps> = {
  args: {
    kind: "subagent",
    original: details(
      { description: "Read-only note reviewer", model: "inherit", tools: ["Read", "Grep", "Glob"] },
      "Review the selected notes and report inconsistencies."
    ),
  },
};
export const Command: StoryObj<ExtensionEditorProps> = {
  args: {
    kind: "command",
    original: details(
      { description: "Summarize a note" },
      "Summarize the selected note in three clear paragraphs."
    ),
  },
};
export const PromptHook: StoryObj<ExtensionEditorProps> = {
  args: {
    kind: "hook",
    original: details({
      type: "prompt",
      event: "Stop",
      prompt: "Check whether the requested work is complete.",
      model: "haiku",
    }),
  },
};
export const AgentHook: StoryObj<ExtensionEditorProps> = {
  args: {
    kind: "hook",
    original: details({
      type: "agent",
      event: "Stop",
      prompt: "Read the result and check that the requested changes are present.",
      timeout: 90,
    }),
  },
};
export const HttpHook: StoryObj<ExtensionEditorProps> = {
  args: {
    kind: "hook",
    original: details({
      type: "http",
      event: "PreToolUse",
      matcher: "Bash",
      url: "https://example.com/check",
      headers: { Authorization: "Bearer $TOKEN" },
      allowedEnvVars: ["TOKEN"],
    }),
  },
};
export const UnsupportedHook: StoryObj<ExtensionEditorProps> = {
  args: { kind: "hook", original: details({ type: "future-type", event: "Stop" }) },
};
export const SubagentDefaultModel: StoryObj<ExtensionEditorProps> = {
  args: {
    kind: "subagent",
    original: details(
      { description: "Review using the configured agent defaults" },
      "Review the selected note."
    ),
  },
};
