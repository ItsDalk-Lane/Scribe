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
    agents: [{ id: "native", label: "Scribe" }],
    selectedAgent: "native",
    query: "",
    onQueryChange: () => {},
    searchPlaceholder: "搜索技能…",
    label: "技能",
    count: 12,
  },
};
export const WithoutExtraTabs: StoryObj<AgentConfigurationHeaderProps> = {
  args: { agents: [{ id: "native", label: "Scribe" }], selectedAgent: "native" },
};

export const ConfigurationActions: StoryObj<AgentConfigurationHeaderProps> = {
  args: {
    ...Skills.args,
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
