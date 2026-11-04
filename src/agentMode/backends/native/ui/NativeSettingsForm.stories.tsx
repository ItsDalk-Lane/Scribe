import {
  NativeSettingsForm,
  type NativeSettingsFormProps,
} from "@/agentMode/backends/native/ui/NativeSettingsForm";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Native Agent Settings",
  component: NativeSettingsForm,
  args: {
    settings: {},
    models: [
      { baseModelId: "local-model", name: "本地笔记助手", credentialState: "ok" },
      { baseModelId: "custom-model", name: "自定义聊天模型", credentialState: "ok" },
    ],
    onChange: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<NativeSettingsFormProps>;
export default meta;

export const Default: StoryObj<NativeSettingsFormProps> = {};
export const PlanMode: StoryObj<NativeSettingsFormProps> = {
  args: {
    settings: {
      defaultModel: { baseModelId: "custom-model", effort: null },
      defaultMode: "plan",
      maxSteps: 100,
    },
  },
};
export const NoModels: StoryObj<NativeSettingsFormProps> = { args: { models: [] } };
export const UnavailableModel: StoryObj<NativeSettingsFormProps> = {
  args: { settings: { defaultModel: { baseModelId: "removed-model", effort: null } }, models: [] },
};
