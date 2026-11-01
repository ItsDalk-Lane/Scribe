import { translate } from "@/lib/i18n";
import { AgentStatusCard } from "@/agentMode/ui/AgentStatusCard";
import type { Meta, StoryObj } from "@/lib/story";
import type * as React from "react";

type AgentStatusCardProps = React.ComponentProps<typeof AgentStatusCard>;

const meta = {
  title: "Agent Mode/Agent Status Card",
  component: AgentStatusCard,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentStatusCardProps>;
export default meta;

export const Checking: StoryObj<AgentStatusCardProps> = {
  args: {
    message: "Checking Very Long Local Agent Backend Name version…",
  },
};

export const InstallAction: StoryObj<AgentStatusCardProps> = {
  args: {
    message: "Very Long Local Agent Backend Name is not installed",
    action: {
      label: "Install Very Long Local Agent Backend Name",
      onClick: () => undefined,
    },
  },
};

export const IncompatibleWarning: StoryObj<AgentStatusCardProps> = {
  args: {
    summary: "Very Long Local Agent Backend Name update required",
    tone: "warning",
    message:
      "Very Long Local Agent Backend Name 2.1.205 is not supported. Version 2.1.206 or newer is required.",
    action: {
      label: "Configure Very Long Local Agent Backend Name",
      onClick: () => undefined,
    },
  },
};

export const LongErrorRetry: StoryObj<AgentStatusCardProps> = {
  args: {
    summary: "Claude session error",
    tone: "error",
    message:
      "The agent could not start because its local connection closed before initialization completed. Check the backend configuration and try again.",
    action: { label: "Retry", onClick: () => undefined },
  },
};

export const LinkedSignIn: StoryObj<AgentStatusCardProps> = {
  args: {
    message: "Signing in to Very Long Local Agent Backend Name…",
    action: {
      label: "Open sign-in page",
      href: "https://example.com/sign-in",
    },
  },
};

export const SignIn: StoryObj<AgentStatusCardProps> = {
  args: {
    message: "Claude not signed in",
    action: { label: "Sign in", onClick: () => undefined },
  },
};

export const LongPathError: StoryObj<AgentStatusCardProps> = {
  args: {
    tone: "error",
    summary: "Claude setup error",
    message:
      "Could not execute C:\\Users\\example\\AppData\\Local\\organizationworkspacewithaverylongunbrokenidentifier012345678901234567890123456789\\customagentruntime\\claude.exe.\nCheck the configured binary path and executable permissions before trying again.\nEACCES: permission denied",
    action: { label: "Configure Claude", onClick: () => undefined },
  },
};

export const ConfigChangedReload: StoryObj<AgentStatusCardProps> = {
  args: {
    layout: "row",
    message: "Claude config has changed",
    action: { label: "Reload", onClick: () => undefined },
  },
};

export const ConfigChangedReloading: StoryObj<AgentStatusCardProps> = {
  args: {
    layout: "row",
    message: "Very Long Local Agent Backend Name config has changed",
    action: { label: "Reloading…", onClick: () => undefined, disabled: true },
  },
};

export const ChineseInstallAction: StoryObj<AgentStatusCardProps> = {
  args: {
    message: translate("zh-CN", "{p0} not installed", { p0: "Claude" }),
    action: {
      label: translate("zh-CN", "Install {p0}", { p0: "Claude" }),
      onClick: () => undefined,
    },
  },
};

export const ChineseUpdateWarning: StoryObj<AgentStatusCardProps> = {
  args: {
    summary: translate("zh-CN", "{p0} update required", { p0: "Claude" }),
    tone: "warning",
    message: "Claude 2.1.205 不受支持，请更新至 2.1.206 或更新版本。",
    action: {
      label: translate("zh-CN", "Configure {p0}", { p0: "Claude" }),
      onClick: () => undefined,
    },
  },
};
