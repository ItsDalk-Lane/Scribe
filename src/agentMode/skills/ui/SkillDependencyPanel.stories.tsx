import type { Meta, StoryObj } from "@/lib/story";
import type React from "react";
import { SkillDependencyPanel } from "@/agentMode/skills/ui/SkillDependencyPanel";

type PanelProps = React.ComponentProps<typeof SkillDependencyPanel>;

const meta = {
  title: "Agent Mode/Skills/Skill Dependency Panel",
  component: SkillDependencyPanel,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<PanelProps>;

export default meta;

export const AllReady: StoryObj<PanelProps> = {
  args: {
    dependencies: [
      { type: "command", name: "ffmpeg" },
      { type: "python-package", name: "pandas", note: "Data analysis" },
    ],
    probes: {
      resolveCommand: async () => "/opt/homebrew/bin/ffmpeg",
      pythonVersion: async () => "2.2.3",
    },
  },
};

export const SomeMissing: StoryObj<PanelProps> = {
  args: {
    dependencies: [
      { type: "command", name: "ffmpeg" },
      { type: "obsidian-plugin", name: "obsidian-excalidraw" },
    ],
    probes: {
      resolveCommand: async () => null,
      pluginVersion: () => undefined,
    },
  },
};
