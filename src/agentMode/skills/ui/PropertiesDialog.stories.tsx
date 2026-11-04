import {
  PropertiesModalBody,
  type PropertiesModalBodyProps,
} from "@/agentMode/skills/ui/PropertiesDialog";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Skills/Native Skill Properties",
  component: PropertiesModalBody,
  args: {
    skill: {
      name: "note-review",
      body: "Review the supplied note.",
      description: "Review the structure and clarity of a note.",
      filePath: "/vault/scribe/skills/note-review/SKILL.md",
      dirPath: "/vault/scribe/skills/note-review",
      enabledAgents: ["native"],
      location: { kind: "canonical" },
    },
    skillsFolderRel: "scribe/skills",
    collisionError: false,
    saving: false,
    onCancel: () => undefined,
    onSave: () => undefined,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<PropertiesModalBodyProps>;
export default meta;
export const Default: StoryObj<PropertiesModalBodyProps> = {};
export const ManualInvocationOnly: StoryObj<PropertiesModalBodyProps> = {
  args: { skill: { ...meta.args.skill, disableModelInvocation: true } },
};
export const HiddenFromMenu: StoryObj<PropertiesModalBodyProps> = {
  args: { skill: { ...meta.args.skill, userInvocable: false } },
};
export const Saving: StoryObj<PropertiesModalBodyProps> = { args: { saving: true } };
