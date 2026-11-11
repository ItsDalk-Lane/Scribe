import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import type { SkillImportCandidate } from "@/agentMode/skills/types";
import {
  SystemSkillSearchView,
  BuiltinSkillRecoveryView,
  LocalSkillImportView,
  type SystemSkillSearchViewProps,
} from "@/agentMode/skills/ui/SkillImportDialogs";
const candidates: SkillImportCandidate[] = [
  {
    id: "review",
    name: "review-notes",
    description: "Review the structure and supporting evidence in a note.",
    path: "/Users/example/.agents/skills/review-notes",
    sources: ["Agent Skills", "Claude Code"],
    status: "available",
  },
  {
    id: "weekly",
    name: "weekly-review",
    description: "Prepare a weekly summary from existing notes.",
    path: "/Users/example/.codex/skills/weekly-review",
    sources: ["Codex"],
    status: "installed",
  },
  {
    id: "conflict",
    name: "obsidian-markdown",
    description: "An existing skill already uses this name.",
    path: "/Users/example/.claude/skills/obsidian-markdown",
    sources: ["Claude Code"],
    status: "conflict",
    error: "Another source already uses this name.",
  },
];
const meta = {
  title: "Skills/Import and recovery",
  component: SystemSkillSearchView,
  parameters: { gallery: { host: "modal", layout: "padded" } },
  args: {
    candidates,
    warnings: [],
    selected: new Set<string>(),
    results: {},
    loading: false,
    busy: false,
    onRefresh: () => {},
    onImport: () => {},
    onSelect: () => {},
  },
} satisfies Meta<SystemSkillSearchViewProps>;
export default meta;
export const SystemResults: StoryObj<SystemSkillSearchViewProps> = {};
export const Searching: StoryObj<SystemSkillSearchViewProps> = {
  args: { loading: true, candidates: [] },
};
export const Empty: StoryObj<SystemSkillSearchViewProps> = { args: { candidates: [] } };
export const PartialFailure: StoryObj<SystemSkillSearchViewProps> = {
  args: {
    results: {
      review: "Imported",
      weekly: "Could not import: source changed. Refresh and try again.",
    },
    warnings: ["A protected folder could not be read; other results are still available."],
  },
};
export const Recovery: StoryObj<SystemSkillSearchViewProps> = {
  render: () => (
    <BuiltinSkillRecoveryView
      statuses={[
        { name: "skill-creator", status: "uninstalled" },
        { name: "defuddle", status: "modified" },
        { name: "json-canvas", status: "conflict" },
        { name: "knap", status: "installed" },
      ]}
      results={{}}
      loading={false}
      busy={false}
      onRestore={() => {}}
    />
  ),
};
export const RecoveryFailure: StoryObj<SystemSkillSearchViewProps> = {
  render: () => (
    <BuiltinSkillRecoveryView
      statuses={[{ name: "skill-creator", status: "uninstalled" }]}
      results={{ "skill-creator": "Could not restore. Existing files are kept." }}
      loading={false}
      busy={false}
      onRestore={() => {}}
    />
  ),
};
export const LocalImport: StoryObj<SystemSkillSearchViewProps> = {
  render: () => (
    <div className="tw-w-full tw-min-w-0">
      <LocalSkillImportView
        onImportPath={() => {}}
        onPickFolder={() => {}}
        onPickZip={() => {}}
        onPickMarkdown={() => {}}
      />
    </div>
  ),
};
