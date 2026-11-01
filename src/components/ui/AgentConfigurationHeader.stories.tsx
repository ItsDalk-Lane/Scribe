import { Button } from "@/components/ui/button";
import { Plus, RefreshCw } from "lucide-react";
import React from "react";
import {
  AgentConfigurationHeader,
  type AgentConfigurationHeaderProps,
} from "@/components/ui/AgentConfigurationHeader";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Settings/Agent configuration header",
  component: AgentConfigurationHeader,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<AgentConfigurationHeaderProps>;
export default meta;
export const Skills: StoryObj<AgentConfigurationHeaderProps> = {
  args: {
    agents: [{ id: "claude", label: "Claude Code" }],
    selectedAgent: "claude",
    source: "user",
    sources: [
      { value: "user", label: "本机 · 用户" },
      { value: "vault", label: "当前库" },
    ],
    onSourceChange: () => {},
    query: "",
    onQueryChange: () => {},
    searchPlaceholder: "搜索技能…",
    label: "技能",
    count: 12,
  },
};
export const AgentOnly: StoryObj<AgentConfigurationHeaderProps> = {
  args: { agents: [{ id: "claude", label: "Claude Code" }], selectedAgent: "claude" },
};

export const ConfigurationActions: StoryObj<AgentConfigurationHeaderProps> = {
  args: {
    ...Skills.args,
    source: "project",
    sources: [
      { value: "user", label: "本机 · 用户" },
      { value: "project", label: "项目 · 本季度资料整理与长期笔记归档" },
    ],
    actions: (
      <>
        <Button size="icon" variant="secondary" aria-label="刷新并检查">
          <RefreshCw className="tw-size-4" />
        </Button>
        <Button variant="secondary">导入</Button>
        <Button>
          <Plus className="tw-size-4" />
          新建
        </Button>
      </>
    ),
  },
};
