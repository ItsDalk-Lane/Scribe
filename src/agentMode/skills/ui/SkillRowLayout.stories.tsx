import type { Meta, StoryObj } from "@/lib/story";
import { Bot, MoreVertical } from "lucide-react";
import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AgentIconButton } from "./AgentIconButton";
import { SkillRowLayout, type SkillRowLayoutProps } from "./SkillRowLayout";

const meta = {
  title: "Skills/Custom skill row",
  component: SkillRowLayout,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<SkillRowLayoutProps>;
export default meta;

const args: SkillRowLayoutProps = {
  name: "writing-review-with-a-long-descriptive-name",
  description: "Review the structure, clarity and supporting evidence in a long-form note.",
  controls: (
    <div className="tw-flex tw-items-center tw-gap-1.5">
      <AgentIconButton Icon={Bot} agentId="claude" enabled />
    </div>
  ),
  actions: (
    <Button variant="ghost" size="icon" aria-label="More actions">
      <MoreVertical className="tw-size-4" />
    </Button>
  ),
};

export const Canonical: StoryObj<SkillRowLayoutProps> = { args };
export const WithChips: StoryObj<SkillRowLayoutProps> = {
  args: {
    ...args,
    annotations: (
      <>
        <Badge variant="secondary">model-invoke off</Badge>
        <Badge variant="secondary">hidden from /</Badge>
      </>
    ),
  },
};
export const MirroredLocation: StoryObj<SkillRowLayoutProps> = {
  args: {
    ...args,
    annotations: (
      <span className="tw-truncate tw-text-ui-smaller tw-text-faint">
        mirrored in .claude, .agents
      </span>
    ),
  },
};
export const ChipsAndLocation: StoryObj<SkillRowLayoutProps> = {
  args: {
    ...args,
    annotations: (
      <>
        <Badge variant="secondary">claude · sonnet</Badge>
        <span className="tw-truncate tw-text-ui-smaller tw-text-faint">in .claude/skills</span>
      </>
    ),
  },
};

export const LongDescription: StoryObj<SkillRowLayoutProps> = {
  args: {
    ...args,
    name: "review-project-notes-and-keep-the-original-decisions-visible",
    description:
      "检查项目笔记中的结构、依据和待确认事项。这段较长说明用于检查窄窗口中的换行，确保技能名称和说明清晰可读，右侧操作仍然可用。",
  },
};
export const DisabledAgent: StoryObj<SkillRowLayoutProps> = {
  args: {
    ...args,
    controls: <AgentIconButton Icon={Bot} agentId="claude" enabled={false} disabled />,
  },
};
