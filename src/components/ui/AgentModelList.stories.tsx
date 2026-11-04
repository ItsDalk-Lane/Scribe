import { AgentModelList, type AgentModelListProps } from "@/components/ui/AgentModelList";
import type { Meta, StoryObj } from "@/lib/story";

const rows = [
  {
    id: "default",
    label: "Default (recommended)",
    wireId: "default",
    description: "使用代理当前的默认模型。",
    enabled: true,
  },
  {
    id: "opus",
    label: "同一个模型的不同入口",
    wireId: "opus",
    description: "模型名称、说明和代号由代理报告。",
    enabled: true,
  },
  {
    id: "sonnet",
    label: "同一个模型的不同入口",
    wireId: "sonnet",
    description: "这项未启用，但仍显示在完整列表中。",
    enabled: false,
  },
];
const meta = {
  title: "Settings/Agent models",
  component: AgentModelList,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<AgentModelListProps>;
export default meta;
export const Collapsed: StoryObj<AgentModelListProps> = {
  args: { rows, onToggle: () => {}, agentName: "Scribe" },
};
export const FullList: StoryObj<AgentModelListProps> = {
  args: { rows, onToggle: () => {}, agentName: "Scribe", defaultOpen: true },
};
export const Empty: StoryObj<AgentModelListProps> = {
  args: { rows: [], onToggle: () => {}, agentName: "Scribe", defaultOpen: true },
};
export const Disabled: StoryObj<AgentModelListProps> = {
  args: {
    rows: rows.map((row) => ({ ...row, enabled: false })),
    onToggle: () => {},
    agentName: "Scribe",
    defaultOpen: true,
  },
};

export const LongNames: StoryObj<AgentModelListProps> = {
  args: {
    rows: [
      {
        id: "long-model",
        label: "Scribe 自动报告的长名称模型入口",
        wireId: "claude-model-with-a-long-version-and-endpoint-identifier",
        description: "完整保留模型说明，较窄的设置窗口中名称和代号应换行显示，右侧开关保持可用。",
        enabled: true,
      },
    ],
    onToggle: () => {},
    agentName: "Scribe",
    defaultOpen: true,
  },
};
