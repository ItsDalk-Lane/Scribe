import type { Meta, StoryObj } from "@/lib/story";
import type { Skill } from "@/agentMode/skills/types";
import { SkillDetailsView, type SkillDetailsViewProps } from "@/agentMode/skills/ui/SkillDetails";
const skill: Skill = {
  name: "review-notes",
  description: "Review notes for clarity, structure, and missing context.",
  body: "# Review notes\n\nRead the complete note. Identify unclear claims, then suggest changes without removing the author's intent.\n\n- Keep original facts.\n- Explain each important change.",
  filePath: ".scribe/skills/review-notes/SKILL.md",
  dirPath: ".scribe/skills/review-notes",
  enabledAgents: ["native"],
  location: { kind: "canonical" },
  author: "Scribe user",
  version: "1.0",
  tags: ["writing", "review"],
  source: { kind: "local", displayPath: "/Users/example/Downloads/review-notes.zip" },
};
const meta = {
  title: "Skills/Details",
  component: SkillDetailsView,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
  args: {
    skill,
    content: `---\nname: review-notes\ndescription: Review notes for clarity\n---\n${skill.body}`,
    files: ["SKILL.md", "references/guide.md", "scripts/check.py", "LICENSE"],
    onReadFile: async (path) =>
      path.endsWith(".md")
        ? "# Supporting guide\n\nRead the entire note before applying this workflow."
        : "Supporting file contents",
    onSaveFile: async () => undefined,
    onBack: () => {},
    onUse: () => {},
    onToggle: () => {},
    onUninstall: () => {},
    onRepair: () => {},
    onRestore: () => {},
    onSave: async () => undefined,
  },
} satisfies Meta<SkillDetailsViewProps>;
export default meta;
export const LocalPreview: StoryObj<SkillDetailsViewProps> = {};
export const Editable: StoryObj<SkillDetailsViewProps> = { args: { initialEditing: true } };
export const BuiltinReadonly: StoryObj<SkillDetailsViewProps> = {
  args: { skill: { ...skill, source: { kind: "builtin" } } },
};
export const Broken: StoryObj<SkillDetailsViewProps> = {
  args: {
    skill: {
      name: "broken-skill",
      filePath: ".scribe/skills/broken-skill/SKILL.md",
      dirPath: ".scribe/skills/broken-skill",
      reason: "The description is missing. Ask Agent to repair the original file.",
      source: { kind: "local" },
    },
  },
};
export const BrokenBuiltin: StoryObj<SkillDetailsViewProps> = {
  args: { ...Broken.args, skill: { ...Broken.args!.skill!, source: { kind: "builtin" } } },
};
export const Loading: StoryObj<SkillDetailsViewProps> = { args: { loading: true } };

export const AutoSaveFailure: StoryObj<SkillDetailsViewProps> = {
  args: {
    initialEditing: true,
    onSave: async () => "The file changed outside Scribe. Your draft is kept.",
  },
};
