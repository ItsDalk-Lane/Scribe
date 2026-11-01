import {
  AgentConfigurationCard,
  type AgentConfigurationCardProps,
} from "@/agentMode/backends/shared/ui/AgentConfigurationCard";
import type { Meta, StoryObj } from "@/lib/story";
import { Bot } from "lucide-react";

const meta = {
  title: "Settings/Agent configuration card",
  component: AgentConfigurationCard,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<AgentConfigurationCardProps>;
export default meta;
const args: AgentConfigurationCardProps = {
  displayName: "Claude Code",
  Icon: Bot,
  installState: { kind: "ready", source: "custom", version: "2.1.281" },
  managedInstall: { kind: "idle" },
  resolvedPath: "/local/claude",
  onConfigure: () => {},
  enabled: true,
  onEnabledChange: () => {},
};
export const Ready: StoryObj<AgentConfigurationCardProps> = { args };
export const Disabled: StoryObj<AgentConfigurationCardProps> = {
  args: { ...args, enabled: false },
};
export const FinishingTasks: StoryObj<AgentConfigurationCardProps> = {
  args: { ...args, enabled: false, pendingDisable: true },
};
export const Missing: StoryObj<AgentConfigurationCardProps> = {
  args: { ...args, installState: { kind: "absent" }, resolvedPath: null },
};

export const DetectionError: StoryObj<AgentConfigurationCardProps> = {
  args: {
    ...args,
    installState: { kind: "error", message: "暂时无法检测 Claude Code，请检查安装配置后重试。" },
    resolvedPath: null,
  },
};
