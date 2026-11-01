import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import type { AgentExtensionDetails } from "@/agentMode/session/extensionManagement";
import type { AgentExtensionItem } from "@/agentMode/session/extensionInventory";
import { ExtensionDetailsView, ExtensionImportForm, PluginInstallForm } from "./ExtensionDialogs";

const plugin: AgentExtensionDetails = {
  item: {
    id: "notes@community",
    name: "Notes",
    kind: "plugin",
    source: "user",
    version: "2.4.1",
    availability: "loaded",
    installations: [
      { scope: "user", path: "/plugins/notes", version: "2.4.1", available: true },
      {
        scope: "local",
        path: "/plugins/notes-previous",
        projectPath: "/another-project",
        version: "2.3.0",
        available: true,
      },
    ],
    description: "Read notes and prepare summaries.",
    location: "/plugins/notes",
    toolCount: 2,
  },
  revision: "example",
  children: (
    [
      { id: "notes:skill", name: "review-notes", kind: "skill", availability: "loaded" },
      { id: "notes:command", name: "summarize", kind: "command", availability: "loaded" },
      { id: "notes:hook", name: "check-note", kind: "hook", availability: "not_listed" },
      { id: "notes:mcp", name: "note-search", kind: "mcp", availability: "failed" },
      { id: "notes:agent", name: "reviewer", kind: "subagent", availability: "loaded" },
    ] as AgentExtensionItem[]
  ).map((item) => ({
    ...item,
    source: "plugin",
    parentPluginId: "notes@community",
    readOnly: true,
    capabilities: { edit: false, delete: false, toggle: false },
  })),
};
const meta = {
  title: "Agent Configuration/Dialogs",
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta;
export default meta;
export const InstallPlugin: StoryObj = {
  render: () => (
    <PluginInstallForm
      scope={{ kind: "user" }}
      marketplaces={[
        {
          name: "community",
          source: "https://example.com/marketplace",
          plugins: [
            { id: "notes@community", name: "Notes", description: "Read and summarize notes" },
            { id: "review@community", name: "Review", description: "Review a collection of notes" },
          ],
        },
      ]}
      onInstall={async () => {}}
      onClose={() => {}}
    />
  ),
};
export const ImportConfiguration: StoryObj = {
  render: () => (
    <ExtensionImportForm
      kind="mcp"
      scope={{ kind: "user" }}
      onImport={async () => {}}
      onClose={() => {}}
    />
  ),
};
export const PluginDetails: StoryObj = {
  render: () => (
    <ExtensionDetailsView
      details={plugin}
      onClose={() => {}}
      onUpdate={async () => {}}
      onDelete={() => {}}
    />
  ),
};
export const InheritedPlugin: StoryObj = {
  render: () => (
    <ExtensionDetailsView
      details={{
        ...plugin,
        item: {
          ...plugin.item,
          source: "project",
          installationScope: "user",
          capabilities: { edit: false, toggle: true, delete: false, update: false },
        },
      }}
      onClose={() => {}}
    />
  ),
};
export const ReadOnlyChild: StoryObj = {
  render: () => (
    <ExtensionDetailsView
      details={{
        ...plugin,
        item: {
          ...plugin.item,
          id: "notes:review",
          name: "review",
          kind: "skill",
          parentPluginId: "notes@community",
          readOnly: true,
        },
        content: "Read the chosen notes and report missing context.",
      }}
      onClose={() => {}}
    />
  ),
};
export const BuiltinReadOnly: StoryObj = {
  render: () => (
    <ExtensionDetailsView
      details={{
        ...plugin,
        item: { ...plugin.item, kind: "skill", name: "obsidian-markdown", builtin: true },
        content: "Create and edit Obsidian Markdown notes.",
      }}
      onClose={() => {}}
    />
  ),
};

export const MissingInstallation: StoryObj = {
  render: () => (
    <ExtensionDetailsView
      details={{
        ...plugin,
        item: {
          ...plugin.item,
          availability: "failed",
          unavailableReason: "Installation files are missing.",
          installations: [{ scope: "user", path: "/plugins/notes", available: false }],
        },
        children: undefined,
      }}
      onClose={() => {}}
    />
  ),
};
export const EmptyComponents: StoryObj = {
  render: () => <ExtensionDetailsView details={{ ...plugin, children: [] }} onClose={() => {}} />,
};
export const DisabledPlugin: StoryObj = {
  render: () => (
    <ExtensionDetailsView
      details={{
        ...plugin,
        item: { ...plugin.item, availability: "disabled", enabled: false },
        children: plugin.children?.map((child) => ({ ...child, availability: "disabled" })),
      }}
      onClose={() => {}}
    />
  ),
};
export const UnknownComponents: StoryObj = {
  render: () => (
    <ExtensionDetailsView
      details={{
        ...plugin,
        item: { ...plugin.item, availability: undefined },
        children: undefined,
      }}
      onClose={() => {}}
    />
  ),
};
