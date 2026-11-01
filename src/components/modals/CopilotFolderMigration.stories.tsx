import type { Meta, StoryObj } from "@/lib/story";
import { CopilotFolderMigration, type CopilotFolderMigrationProps } from "./CopilotFolderMigration";

const meta = {
  title: "Modals/Scribe Folder Migration",
  component: CopilotFolderMigration,
  args: { migration: { status: "moved", from: ".scribe", to: "scribe", leftBehind: [] } },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CopilotFolderMigrationProps>;
export default meta;

export const Moved: StoryObj<CopilotFolderMigrationProps> = {};

export const FilesLeftBehind: StoryObj<CopilotFolderMigrationProps> = {
  args: {
    migration: {
      status: "moved",
      from: ".scribe",
      to: "scribe",
      leftBehind: [
        ".scribe/memory/User Role.md",
        ".scribe/scribe-conversations/A very long conversation title that wraps onto a second line.md",
      ],
    },
  },
};

export const Failed: StoryObj<CopilotFolderMigrationProps> = {
  args: {
    migration: {
      status: "failed",
      from: ".scribe",
      to: "scribe",
      reason: "EACCES: permission denied, rename '.scribe/memory'",
    },
  },
};
