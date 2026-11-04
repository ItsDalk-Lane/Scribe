import { AgentHomeShelf, type AgentHomeShelfSection } from "@/agentMode/ui/AgentHomeShelf";
import { AgentLandingStack } from "@/agentMode/ui/AgentLandingStack";
import { ScribeBrandIcon } from "@/components/ui/ScribeBrandIcon";
import type { Meta, StoryObj } from "@/lib/story";
import { MessageSquare } from "lucide-react";
import React from "react";

type AgentLandingStackProps = React.ComponentProps<typeof AgentLandingStack>;

interface LandingStackCanvasProps {
  args: Partial<AgentLandingStackProps>;
  shelf?: React.ReactNode;
}

const rows = Array.from({ length: 10 }, (_, index) => `Recent chat ${index + 1}`);
const sections: AgentHomeShelfSection[] = [
  {
    id: "chats",
    icon: <MessageSquare className="tw-size-4" />,
    title: "Recent Chats",
    renderBody: () => (
      <div className="tw-flex tw-flex-col">
        <div className="tw-p-1">
          <div className="tw-h-7 tw-rounded-md tw-border tw-border-solid tw-border-border tw-px-2 tw-text-ui-small tw-leading-7 tw-text-normal">
            Search chats...
          </div>
        </div>
        <div className="tw-flex tw-flex-col tw-divide-y tw-divide-border">
          {rows.map((row) => (
            <div key={row} className="tw-min-h-9 tw-px-2 tw-py-1.5 tw-text-ui-small">
              {row}
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

function LandingStackCanvas({ args, shelf = args.shelf }: LandingStackCanvasProps) {
  return (
    <div className="tw-flex tw-size-full tw-flex-col tw-overflow-y-auto tw-px-2">
      <AgentLandingStack
        hero={args.hero ?? null}
        composer={args.composer ?? null}
        floating={args.floating}
        context={args.context}
        shelf={shelf}
      />
    </div>
  );
}

const meta = {
  title: "Agent Mode/Agent Landing Stack",
  component: AgentLandingStack,
  args: {
    hero: (
      <div className="tw-flex tw-items-center tw-justify-center tw-gap-3">
        <ScribeBrandIcon className="tw-size-6 tw-text-normal" />
        <span className="tw-text-3xl tw-font-[330] tw-text-normal">Where should we start?</span>
      </div>
    ),
    composer: (
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-4 tw-text-ui-small tw-text-normal">
        Ask Scribe...
      </div>
    ),
    shelf: <AgentHomeShelf sections={sections} />,
  },
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<AgentLandingStackProps>;
export default meta;

export const FullPreview: StoryObj<AgentLandingStackProps> = {
  render: (args) => <LandingStackCanvas args={args} />,
};
