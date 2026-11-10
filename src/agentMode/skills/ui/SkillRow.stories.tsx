import type { Meta, StoryObj } from "@/lib/story";
import { SkillRow, type SkillRowProps } from "@/agentMode/skills/ui/SkillRow";
const meta = {
  title: "Skills/Managed row",
  component: SkillRow,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
  args: {
    skill: {
      name: "review-notes",
      description: "Review structure, clarity, and supporting evidence in your notes.",
      body: "Read the note",
      filePath: ".scribe/skills/review-notes/SKILL.md",
      dirPath: ".scribe/skills/review-notes",
      enabledAgents: ["native"],
      location: { kind: "canonical" },
      source: { kind: "local" },
    },
    onUse: () => {},
    onToggle: () => {},
    onUninstall: () => {},
    onOpen: () => {},
  },
} satisfies Meta<SkillRowProps>;
export default meta;
export const Local: StoryObj<SkillRowProps> = {};
export const Busy: StoryObj<SkillRowProps> = { args: { busy: true } };
// 存在界面元数据时优先渲染显示名与短描述。https://github.com/ItsDalk-Lane/Scribe/issues/47
export const WithInterfaceMetadata: StoryObj<SkillRowProps> = {
  args: {
    skill: {
      ...meta.args.skill,
      uiMetadata: {
        displayName: "Review Notes",
        shortDescription: "Structure, clarity, evidence.",
      },
    },
  },
};
export const Builtin: StoryObj<SkillRowProps> = {
  args: { skill: { ...meta.args.skill, source: { kind: "builtin" } } },
};
export const AgentCreated: StoryObj<SkillRowProps> = {
  args: { skill: { ...meta.args.skill, source: { kind: "agent" } } },
};
export const DisabledSystemImport: StoryObj<SkillRowProps> = {
  args: {
    skill: {
      ...meta.args.skill,
      enabledAgents: [],
      source: { kind: "system", displayPath: "/Users/example/.agents/skills/review-notes" },
    },
  },
};
export const ManualUseUnavailable: StoryObj<SkillRowProps> = {
  args: { skill: { ...meta.args.skill, userInvocable: false } },
};
export const BrokenSkill: StoryObj<SkillRowProps> = {
  args: {
    skill: {
      name: "broken-skill",
      filePath: ".scribe/skills/broken-skill/SKILL.md",
      dirPath: ".scribe/skills/broken-skill",
      reason: "The skill description is missing.",
      source: { kind: "local" },
    },
  },
};
