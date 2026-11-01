import type { AgentExtensionGroup } from "@/agentMode/session/extensionInventory";
import {
  AgentExtensionsPanel,
  type AgentExtensionsPanelProps,
} from "@/agentMode/ui/AgentExtensionsPanel";
import type { Meta, StoryObj } from "@/lib/story";

const groups: readonly AgentExtensionGroup[] = [
  {
    kind: "skill",
    status: "partial",
    warnings: [],
    items: [
      {
        id: "personal",
        name: "weekly-review",
        description: "回顾本周笔记，整理待办和未完成的问题。",
        source: "user",
        enabled: true,
        availability: "loaded",
        capabilities: { edit: true, delete: true, toggle: true },
      },
      {
        id: "builtin",
        name: "obsidian-markdown",
        description: "内置技能保留独立的加载状态，不能单独修改。",
        source: "runtime",
        builtin: true,
        readOnly: true,
        availability: "not_listed",
      },
      {
        id: "plugin",
        name: "document-review",
        description: "随所属插件关闭的只读条目。",
        source: "plugin",
        parentPluginId: "文档助手",
        enabled: false,
        availability: "disabled",
      },
    ],
  },
];
const args: AgentExtensionsPanelProps = {
  agentName: "Claude Code",
  groups,
  loading: false,
  onRefresh: () => {},
  onOpen: () => {},
  onToggle: () => {},
  onDelete: () => {},
};
const meta = {
  title: "Settings/Agent extension list",
  component: AgentExtensionsPanel,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<AgentExtensionsPanelProps>;
export default meta;
export const Skills: StoryObj<AgentExtensionsPanelProps> = { args };
export const VaultLinkedSkill: StoryObj<AgentExtensionsPanelProps> = {
  args: {
    ...args,
    runtimeState: "checked",
    groups: [
      {
        kind: "skill",
        status: "partial",
        warnings: [],
        items: [
          {
            id: "/shared/skills/weekly-review/SKILL.md",
            name: "weekly-review",
            description: "链接到当前库的个人技能；在原始来源中修改。",
            source: "project",
            location: "/shared/skills/weekly-review/SKILL.md",
            enabled: true,
            availability: "loaded",
            readOnly: true,
            capabilities: { edit: false, delete: false, toggle: false },
          },
        ],
      },
    ],
  },
};
export const Empty: StoryObj<AgentExtensionsPanelProps> = {
  args: { ...args, groups: [{ kind: "subagent", status: "partial", warnings: [], items: [] }] },
};
export const Loading: StoryObj<AgentExtensionsPanelProps> = {
  args: { ...args, groups: null, loading: true },
};
export const Error: StoryObj<AgentExtensionsPanelProps> = {
  args: { ...args, groups: null, error: true, runtimeState: "error" },
};
export const McpStates: StoryObj<AgentExtensionsPanelProps> = {
  args: {
    ...args,
    groups: [
      {
        kind: "mcp",
        status: "partial",
        warnings: [],
        items: [
          {
            id: "connected",
            name: "documents",
            source: "plugin",
            parentPluginId: "文档助手",
            availability: "connected",
            toolCount: 5,
          },
          {
            id: "failed",
            name: "github",
            source: "user",
            availability: "failed",
            enabled: true,
            capabilities: { edit: true, delete: true, toggle: true },
          },
          {
            id: "auth",
            name: "search",
            source: "plugin",
            parentPluginId: "搜索",
            availability: "needs-auth",
          },
          {
            id: "pending",
            name: "browser",
            source: "plugin",
            parentPluginId: "浏览器操作",
            availability: "pending",
          },
        ],
      },
    ],
  },
};

export const LongNames: StoryObj<AgentExtensionsPanelProps> = {
  args: {
    ...args,
    groups: [
      {
        kind: "subagent",
        status: "partial",
        warnings: [],
        items: [
          {
            id: "long-agent",
            name: "research-and-review-agent-with-a-long-name",
            description: "整理多个项目的长期资料，检查笔记中的引用、上下文和未完成事项。",
            source: "user",
            availability: "loaded",
            enabled: true,
            capabilities: { edit: true, delete: true, toggle: true },
          },
        ],
      },
    ],
  },
};
export const Busy: StoryObj<AgentExtensionsPanelProps> = {
  args: { ...args, busy: true },
};
