import type { Meta, StoryObj } from "@/lib/story";
import { Trash2 } from "lucide-react";
import React from "react";
import { Button } from "@/components/ui/button";
import { ExtensionAvailabilityDot } from "@/components/ui/extension-availability-dot";
import { ExtensionAvailabilitySwitch } from "@/components/ui/extension-availability-switch";
import { SkillRowLayout, type SkillRowLayoutProps } from "./SkillRowLayout";
import { EmptyPlaceholder } from "./EmptyPlaceholder";
import { SkillLoadIssues } from "./SkillLoadIssues";

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
      <ExtensionAvailabilitySwitch
        label="Enable writing-review"
        state={{ checked: true, disabled: false }}
        onToggle={() => undefined}
      />
    </div>
  ),
  actions: (
    <Button variant="ghost" size="icon" aria-label="Uninstall">
      <Trash2 className="tw-size-4" />
    </Button>
  ),
};

export const Canonical: StoryObj<SkillRowLayoutProps> = { args };
export const Checking: StoryObj<SkillRowLayoutProps> = {
  args: {
    ...args,
    controls: (
      <ExtensionAvailabilitySwitch
        label="Enable writing-review"
        state={{ checked: true, disabled: true, phase: "checking" }}
      />
    ),
  },
};
export const WaitingForUpdate: StoryObj<SkillRowLayoutProps> = {
  args: {
    ...args,
    controls: (
      <ExtensionAvailabilitySwitch
        label="Enable writing-review"
        state={{ checked: false, disabled: true, phase: "pending" }}
      />
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
export const Unconfirmed: StoryObj<SkillRowLayoutProps> = {
  args: {
    ...args,
    controls: (
      <ExtensionAvailabilityDot
        state={{
          enabled: false,
          reason: "Availability could not be confirmed. Check again.",
        }}
      />
    ),
  },
};

export const UnconfirmedPreference: StoryObj<SkillRowLayoutProps> = {
  args: {
    ...args,
    controls: (
      <ExtensionAvailabilitySwitch
        label="Enable writing-review"
        state={{
          checked: true,
          disabled: true,
          reason: "Availability could not be confirmed. Check again.",
        }}
      />
    ),
  },
};

export const PersonalSkillsEmpty: StoryObj<SkillRowLayoutProps> = {
  args,
  render: () => <EmptyPlaceholder />,
};

export const LegacyNamedPersonalSkill: StoryObj<SkillRowLayoutProps> = {
  args: {
    ...args,
    name: "obsidian-markdown",
    description: "My own Markdown rules, with the edits I saved in this skill.",
    onOpen: () => undefined,
    controls: (
      <ExtensionAvailabilitySwitch
        label="Enable obsidian-markdown"
        state={{ checked: false, disabled: false }}
        onToggle={() => undefined}
      />
    ),
  },
};

export const PersonalSkillsWithLoadError: StoryObj<SkillRowLayoutProps> = {
  args: LegacyNamedPersonalSkill.args,
  render: (props) => (
    <section aria-label="Your skills" className="tw-space-y-3">
      <SkillLoadIssues
        issues={[
          {
            location: "scribe/skills/review-notes/SKILL.md",
            reason: "The skill description is missing.",
            revealLabel: "Reveal in vault",
            onFixWithAgent: () => undefined,
            onOpen: () => undefined,
            onReveal: () => undefined,
          },
        ]}
        onViewDetails={() => undefined}
      />
      <SkillRowLayout {...args} {...props} />
    </section>
  ),
};
