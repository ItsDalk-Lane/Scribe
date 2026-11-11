import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import { SkillEditorForm, type SkillEditorFormProps } from "@/agentMode/skills/ui/SkillEditorForm";
const meta = {
  title: "Skills/Agent draft confirmation",
  component: SkillEditorForm,
  parameters: { gallery: { host: "modal", layout: "padded" } },
  args: {
    initialContent:
      "---\nname: weekly-review\ndescription: Turn selected notes into a weekly review\n---\nRead the selected notes in full. Group decisions, completed work, and open questions. Keep links to the original notes.",
    onSave: () => {},
    onCancel: () => {},
  },
} satisfies Meta<SkillEditorFormProps>;
export default meta;
export const CompleteDraft: StoryObj<SkillEditorFormProps> = {
  render: (props) => (
    <div className="tw-space-y-4">
      <p>Review the complete draft. The skill is installed only when you choose Save.</p>
      <SkillEditorForm
        {...props}
        initialContent={props.initialContent ?? meta.args.initialContent}
        onSave={() => {}}
        onCancel={() => {}}
      />
    </div>
  ),
};
export const Saving: StoryObj<SkillEditorFormProps> = { args: { saving: true } };
export const InvalidName: StoryObj<SkillEditorFormProps> = {
  args: {
    initialContent: "---\nname: Weekly Review\ndescription: Review notes\n---\nRead every note.",
    error: "Use a lowercase name with hyphens, up to 64 characters.",
  },
};
