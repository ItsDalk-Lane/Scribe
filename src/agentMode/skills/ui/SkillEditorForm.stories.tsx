import type { Meta, StoryObj } from "@/lib/story";
import { SkillEditorForm, type SkillEditorFormProps } from "@/agentMode/skills/ui/SkillEditorForm";
const meta = {
  title: "Skills/Editor",
  component: SkillEditorForm,
  args: {
    initialContent:
      '---\nname: review-notes\ndescription: Review notes\nlicense: MIT\ncompatibility: Obsidian desktop\nallowed-tools: Read\nmetadata:\n  author: Alice\n  version: "1.0"\n  tags: [notes, review]\n---\n# Review notes\n\nRead the complete note and suggest a clearer structure.',
    onSave: () => {},
    onCancel: () => {},
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<SkillEditorFormProps>;
export default meta;
export const CompleteFile: StoryObj<SkillEditorFormProps> = {};
export const SaveError: StoryObj<SkillEditorFormProps> = {
  args: { error: "The file changed outside Scribe. Your draft is kept; refresh before retrying." },
};
export const Saving: StoryObj<SkillEditorFormProps> = { args: { saving: true } };
