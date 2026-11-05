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
  displayName: "Scribe",
  Icon: Bot,
  installState: { kind: "ready", source: "managed" },
  managedInstall: { kind: "idle" },
  resolvedPath: null,
  onConfigure: () => {},
  enabled: true,
  onEnabledChange: () => {},
};
export const Ready: StoryObj<AgentConfigurationCardProps> = {
  name: "Configured models and providers",
  args,
};
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
    installState: {
      kind: "error",
      reason: "configuration",
      message: "Configure and enable a chat model in your model settings first.",
    },
    resolvedPath: null,
  },
};
