import type { Meta, StoryObj } from "@/lib/story";
import { WebSearchSourceSetting, type WebSearchSourceSettingProps } from "./WebSearchSourceSetting";

const meta = {
  title: "Settings/Web Search Sources",
  component: WebSearchSourceSetting,
  args: {
    preferred: "builtin",
    mcp: "",
    skill: "",
    mcpOptions: [],
    skillOptions: [],
    onPreferredChange: () => undefined,
    onMcpChange: () => undefined,
    onSkillChange: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<WebSearchSourceSettingProps>;
export default meta;

export const Default: StoryObj<WebSearchSourceSettingProps> = {};

export const Configured: StoryObj<WebSearchSourceSettingProps> = {
  args: {
    preferred: "mcp",
    mcp: "search",
    skill: "research",
    mcpOptions: [{ label: "Research / web_search · query", value: "search" }],
    skillOptions: [{ label: "research", value: "research" }],
  },
};

export const MissingSource: StoryObj<WebSearchSourceSettingProps> = {
  args: { preferred: "skill", skill: "removed-skill" },
};
