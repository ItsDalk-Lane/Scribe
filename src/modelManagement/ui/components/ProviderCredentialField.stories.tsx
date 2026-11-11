import type { Meta, StoryObj } from "@/lib/story";
import {
  ProviderCredentialField,
  type ProviderCredentialFieldProps,
} from "./ProviderCredentialField";

const meta = {
  title: "Settings/Provider Credential",
  component: ProviderCredentialField,
  args: {
    label: "API key",
    value: "",
    hasSavedKey: false,
    clearRequested: false,
    required: true,
    editableExisting: true,
    saving: false,
    onChange: () => undefined,
    onClear: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ProviderCredentialFieldProps>;
export default meta;
export const Missing: StoryObj<ProviderCredentialFieldProps> = {};
export const SavedEncrypted: StoryObj<ProviderCredentialFieldProps> = {
  args: { hasSavedKey: true },
};
export const Replacing: StoryObj<ProviderCredentialFieldProps> = {
  args: { hasSavedKey: true, value: "synthetic-new-key" },
};
export const Clearing: StoryObj<ProviderCredentialFieldProps> = {
  args: { hasSavedKey: true, clearRequested: true },
};
export const Saving: StoryObj<ProviderCredentialFieldProps> = {
  args: { hasSavedKey: true, saving: true },
};
