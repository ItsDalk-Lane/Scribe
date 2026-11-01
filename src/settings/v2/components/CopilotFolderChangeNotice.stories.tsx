import type { Meta, StoryObj } from "@/lib/story";
import {
  CopilotFolderChangeNotice,
  type CopilotFolderChangeNoticeProps,
} from "./CopilotFolderChangeNotice";

const meta = {
  title: "Settings/Scribe Folder Change Notice",
  component: CopilotFolderChangeNotice,
  args: {
    oldRoot: "scribe",
    newRoot: "90 System/scribe",
    containsMarkdown: false,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CopilotFolderChangeNoticeProps>;
export default meta;

export const EmptyFolder: StoryObj<CopilotFolderChangeNoticeProps> = {};

export const FolderWithMarkdown: StoryObj<CopilotFolderChangeNoticeProps> = {
  args: { containsMarkdown: true },
};
