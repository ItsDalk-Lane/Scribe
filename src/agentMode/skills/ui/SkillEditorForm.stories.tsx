import type { Meta, StoryObj } from "@/lib/story";
import { SkillEditorForm, type SkillEditorFormProps } from "./SkillEditorForm";
const meta = {
  title: "Skills/Editor",
  component: SkillEditorForm,
  args: { onSave: () => {}, onCancel: () => {} },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<SkillEditorFormProps>;
export default meta;
export const NewSkill: StoryObj<SkillEditorFormProps> = {};
export const EditSkill: StoryObj<SkillEditorFormProps> = {
  args: {
    initialName: "review-notes",
    initialDescription: "Review notes for missing context",
    initialBody: "Read the selected notes and identify questions that need clarification.",
    readonlyName: true,
  },
};
export const SaveError: StoryObj<SkillEditorFormProps> = {
  args: { ...EditSkill.args, error: "The skill could not be saved. Check folder permissions." },
};
export const Loading: StoryObj<SkillEditorFormProps> = { args: { loading: true } };
