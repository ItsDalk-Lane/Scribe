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
        id: "meeting-notes",
        name: "meeting-notes",
        description: "整理会议记录，提炼结论并列出后续需要跟进的事项。",
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
  agentName: "Test agent",
  groups,
  loading: false,
  forceExpanded: true,
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
export const CollapsedSections: StoryObj<AgentExtensionsPanelProps> = {
  args: { ...args, forceExpanded: false },
};
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

export const PluginAvailability: StoryObj<AgentExtensionsPanelProps> = {
  args: {
    ...args,
    runtimeState: "checked",
    groups: [
      {
        kind: "plugin",
        status: "partial",
        warnings: ["The agent reported plugin errors; details for each plugin were not provided."],
        items: [
          {
            id: "notes@community",
            name: "笔记助手",
            source: "user",
            kind: "plugin",
            version: "1.4.0",
            availability: "loaded_with_errors",
            capabilities: { edit: false, delete: true, toggle: true },
            description: "插件已加载；附属服务的可用性在详情中分别查看。",
          },
          {
            id: "review@community",
            name: "内容审阅",
            source: "user",
            kind: "plugin",
            version: "0.9.2",
            enabled: false,
            availability: "disabled",
            canEnable: false,
            unavailableReason: "Installed only for other projects; unavailable in this scope.",
            capabilities: { edit: false, delete: false, toggle: true },
          },
          {
            id: "research@community",
            name: "资料研究",
            source: "user",
            kind: "plugin",
            availability: "failed",
            unavailableReason: "Installed plugin files are missing.",
            capabilities: { edit: false, delete: true, toggle: true },
          },
        ],
      },
    ],
  },
};

export const ConfirmedBuiltin: StoryObj<AgentExtensionsPanelProps> = {
  args: {
    ...args,
    runtimeState: "checked",
    groups: [
      {
        kind: "command",
        status: "partial",
        warnings: [],
        items: [
          {
            id: "help",
            name: "help",
            source: "runtime",
            kind: "command",
            builtin: true,
            availability: "loaded",
          },
        ],
      },
    ],
  },
};

export const FailedCheck: StoryObj<AgentExtensionsPanelProps> = {
  args: { ...args, runtimeState: "error" },
};
