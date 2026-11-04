import { resolveAgentSelectCta, type AgentSelectRow } from "@/agentMode/ui/agentSelectModel";
import { AgentSelectView } from "@/agentMode/ui/AgentSelectView";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentSelectViewProps = React.ComponentProps<typeof AgentSelectView>;

const CLAUDE: AgentSelectRow = {
  id: "claude",
  name: "Claude",
  description:
    "Anthropic models, billed to your Claude Code subscription. Runs the claude CLI already on your machine.",
  status: "absent",
  recommended: true,
  statusMessage: null,
  usesConfiguredModels: false,
};

const AgentSelectStory: React.FC<Partial<AgentSelectViewProps>> = (args) => {
  const rows = args.rows ?? [CLAUDE];
  const [selectedId, setSelectedId] = React.useState(args.selectedId ?? "claude");
  const selectedRow = rows.find((row) => row.id === selectedId) ?? rows[0];
  const cta = resolveAgentSelectCta(selectedRow);

  return (
    <AgentSelectView
      rows={rows}
      selectedId={selectedId}
      onSelect={setSelectedId}
      ctaLabel={cta.label}
      footerNote={cta.note}
      ctaDisabled={cta.action === "wait"}
      onCta={args.onCta ?? (() => undefined)}
    />
  );
};

const meta = {
  title: "Agent Mode/Agent Select View",
  component: AgentSelectView,
  args: {
    rows: [CLAUDE],
    selectedId: "claude",
    onSelect: () => undefined,
    ctaLabel: "Configure",
    footerNote: "Claude isn't set up on this machine yet.",
    onCta: () => undefined,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentSelectViewProps>;
export default meta;

export const NothingSetUp: StoryObj<AgentSelectViewProps> = {
  args: {},
  render: AgentSelectStory,
};

export const ClaudeInstalled: StoryObj<AgentSelectViewProps> = {
  args: {
    rows: [{ ...CLAUDE, status: "installed" }],
  },
  render: AgentSelectStory,
};

export const ClaudeChecking: StoryObj<AgentSelectViewProps> = {
  args: {
    rows: [{ ...CLAUDE, status: "checking" }],
    selectedId: "claude",
  },
  render: AgentSelectStory,
};

export const ClaudeUpdateRequired: StoryObj<AgentSelectViewProps> = {
  args: {
    rows: [
      {
        ...CLAUDE,
        status: "outdated",
        statusMessage: "Claude 2.1.205 is not supported. Scribe requires 2.1.206 or newer.",
      },
    ],
    selectedId: "claude",
  },
  render: AgentSelectStory,
};

export const ClaudeError: StoryObj<AgentSelectViewProps> = {
  args: {
    rows: [
      {
        ...CLAUDE,
        status: "error",
        statusMessage:
          "Could not read the Claude binary at C:\\Users\\example\\AppData\\Local\\organizationworkspacewithaverylongunbrokenidentifier012345678901234567890123456789\\customagentruntime\\claude.exe.",
      },
    ],
  },
  render: AgentSelectStory,
};

export const LongAgentName: StoryObj<AgentSelectViewProps> = {
  args: {
    rows: [
      {
        ...CLAUDE,
        name: "Claude Code with a very long local installation name",
        description:
          "Runs Claude Code on your machine with the models and account configured in Claude Code. Check that your installation is available and signed in before starting a conversation.",
        status: "installed",
      },
    ],
  },
  render: AgentSelectStory,
};

export const ClaudeSignInRequired: StoryObj<AgentSelectViewProps> = {
  args: {
    rows: [{ ...CLAUDE, status: "signed-out", statusMessage: "Claude not signed in" }],
    selectedId: "claude",
  },
  render: AgentSelectStory,
};

export const LaunchPending: StoryObj<AgentSelectViewProps> = {
  args: {
    rows: [{ ...CLAUDE, status: "installed" }],
    selectedId: "claude",
    ctaLabel: "Starting…",
    footerNote: "Wait for the current agent launch to finish.",
    ctaDisabled: true,
  },
};
