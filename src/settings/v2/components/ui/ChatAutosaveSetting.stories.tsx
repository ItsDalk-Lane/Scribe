import type { Meta, StoryObj } from "@/lib/story";
import { ChatAutosaveSetting, type ChatAutosaveSettingProps } from "./ChatAutosaveSetting";

const meta = {
  title: "Settings/Chat Autosave",
  component: ChatAutosaveSetting,
  args: { checked: true, onCheckedChange: () => {} },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ChatAutosaveSettingProps>;
export default meta;

export const AutomaticNotesOn: StoryObj<ChatAutosaveSettingProps> = {};

export const AutomaticNotesOff: StoryObj<ChatAutosaveSettingProps> = {
  args: { checked: false },
};
