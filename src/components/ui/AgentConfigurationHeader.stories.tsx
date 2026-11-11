import { Button } from "@/components/ui/button";
import { Plus, RotateCcw } from "lucide-react";
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
        <Button variant="secondary">
          <RotateCcw className="tw-size-4" />
          恢复内置技能
        </Button>
        <Button>
          <Plus className="tw-size-4" />
          添加技能
        </Button>
      </>
    ),
  },
};
