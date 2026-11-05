import type { Meta, StoryObj } from "@/lib/story";
import { KeyStorageSection, type KeyStorageSectionProps } from "./KeyStorageSection";

const meta = {
  title: "Settings/API key storage",
  component: KeyStorageSection,
  args: { keychainAvailable: true, forgetting: false, onForget: () => {} },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<KeyStorageSectionProps>;
export default meta;

export const StorageInfo: StoryObj<KeyStorageSectionProps> = {};

export const Unavailable: StoryObj<KeyStorageSectionProps> = {
  args: { keychainAvailable: false },
};

export const Removing: StoryObj<KeyStorageSectionProps> = {
  args: { forgetting: true },
};
