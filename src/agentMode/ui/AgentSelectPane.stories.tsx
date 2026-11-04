import { AgentSelectPane, type AgentSelectPaneProps } from "@/agentMode/ui/AgentSelectPane";
import { AgentSelectView } from "@/agentMode/ui/AgentSelectView";
import type { AgentSelectRow } from "@/agentMode/ui/agentSelectModel";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const ROWS: readonly AgentSelectRow[] = [
  {
    id: "claude",
    name: "Claude",
    description: "Anthropic models, billed to your Claude Code subscription.",
    status: "absent",
    recommended: true,
    statusMessage: null,
    usesConfiguredModels: false,
  },
];

const AgentControlsFixture = () => (
  <div className="copilot-divider-t tw-flex tw-items-center tw-justify-between tw-p-2 tw-text-ui-smaller tw-text-muted">
    <span>Agent Mode</span>
    <span>Default</span>
  </div>
);

const meta = {
  title: "Agent Mode/Agent Select Pane",
  component: AgentSelectPane,
  args: {
    children: (
      <AgentSelectView
        rows={ROWS}
        selectedId="claude"
        onSelect={() => undefined}
        ctaLabel="Configure"
        footerNote="Claude isn't set up on this machine yet."
        onCta={() => undefined}
      />
    ),
    controls: <AgentControlsFixture />,
  },
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<AgentSelectPaneProps>;
export default meta;

export const ColdStart: StoryObj<AgentSelectPaneProps> = {};
