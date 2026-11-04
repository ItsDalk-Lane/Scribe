import type { Meta, StoryObj } from "@/lib/story";
import {
  ScribeFolderChangeNotice,
  type ScribeFolderChangeNoticeProps,
} from "./ScribeFolderChangeNotice";

const meta = {
  title: "Settings/Scribe Folder Change Notice",
  component: ScribeFolderChangeNotice,
  args: {
    oldRoot: "scribe",
    newRoot: "90 System/scribe",
    containsMarkdown: false,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ScribeFolderChangeNoticeProps>;
export default meta;

export const EmptyFolder: StoryObj<ScribeFolderChangeNoticeProps> = {};

export const FolderWithMarkdown: StoryObj<ScribeFolderChangeNoticeProps> = {
  args: { containsMarkdown: true },
};
