import type { Meta, StoryObj } from "@/lib/story";
import { Terminal } from "lucide-react";
import { AgentBackendHeader, type AgentBackendHeaderProps } from "./AgentBackendHeader";

const meta = {
  title: "Settings/Agent Backend Header",
  component: AgentBackendHeader,
  args: {
    displayName: "Claude",
    Icon: Terminal,
    installState: {
      kind: "incompatible",
      source: "managed",
      currentVersion: "2.1.205",
      minVersion: "2.1.206",
      message: "Claude 2.1.205 is not supported. Scribe requires 2.1.206 or newer.",
    },
    managedInstall: { kind: "idle" },
    resolvedPath: "/usr/local/bin/claude",
    onConfigure: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<AgentBackendHeaderProps>;
export default meta;
export const NotInstalled: StoryObj<AgentBackendHeaderProps> = {
  args: {
    installState: { kind: "absent" },
    resolvedPath: null,
  },
};
export const Upgrade: StoryObj<AgentBackendHeaderProps> = {};
export const SignInRequired: StoryObj<AgentBackendHeaderProps> = {
  args: {
    displayName: "Claude",
    installState: { kind: "ready", source: "managed" },
    authStatus: { signedIn: false },
    resolvedPath: null,
  },
};
export const CheckingSignIn: StoryObj<AgentBackendHeaderProps> = {
  args: { ...SignInRequired.args, authStatus: null },
};
export const SignedIn: StoryObj<AgentBackendHeaderProps> = {
  args: { ...SignInRequired.args, authStatus: { signedIn: true } },
};

export const InstalledPath: StoryObj<AgentBackendHeaderProps> = {
  args: {
    installState: { kind: "ready", source: "managed" },
    authStatus: { signedIn: true },
    resolvedPath: "/usr/local/bin/claude",
  },
};
