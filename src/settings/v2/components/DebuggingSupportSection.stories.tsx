import type { Meta, StoryObj } from "@/lib/story";
import {
  DebuggingSupportSection,
  type DebuggingSupportSectionProps,
} from "./DebuggingSupportSection";

const meta = {
  title: "Settings/Debugging & Support Section",
  component: DebuggingSupportSection,
  args: {
    debug: false,
    onDebugChange: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<DebuggingSupportSectionProps>;
export default meta;

export const FreshInstall: StoryObj<DebuggingSupportSectionProps> = {};

export const DebugModeOn: StoryObj<DebuggingSupportSectionProps> = {
  args: { debug: true },
};
