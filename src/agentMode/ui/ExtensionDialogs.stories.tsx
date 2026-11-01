import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import type { AgentExtensionDetails } from "@/agentMode/session/extensionManagement";
import { ExtensionDetailsView, ExtensionImportForm, PluginInstallForm } from "./ExtensionDialogs";

const plugin: AgentExtensionDetails = {
  item: {
    id: "notes@community",
    name: "Notes",
    source: "user",
    description: "Read notes and prepare summaries.",
    location: "/plugins/notes",
    toolCount: 2,
  },
  revision: "example",
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
        item: { ...plugin.item, name: "obsidian-markdown", builtin: true },
        content: "Create and edit Obsidian Markdown notes.",
      }}
      onClose={() => {}}
    />
  ),
};
