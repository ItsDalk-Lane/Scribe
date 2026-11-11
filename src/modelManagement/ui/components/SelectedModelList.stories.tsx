import type { Meta, StoryObj } from "@/lib/story";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import { SelectedModelList } from "./SelectedModelList";

const meta = {
  title: "Settings/Selected Model List",
  component: SelectedModelList,
  args: {
    availableModels: [],
    selected: new Set<string>(),
    onToggle: () => {},
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<React.ComponentProps<typeof SelectedModelList>>;
export default meta;

const CHAT: ModelInfo = {
  id: "claude-sonnet-4-5",
  displayName: "Claude Sonnet 4.5",
  releaseDate: "2025-09-01",
  limits: { context: 200000 },
  modalities: { input: ["text"], output: ["text"] },
};
const EMBED: ModelInfo = {
  id: "text-embedding-3-small",
  displayName: "Text Embedding 3 Small",
  isEmbedding: true,
};
const IMAGE: ModelInfo = {
  id: "image-generator",
  displayName: "Image generator",
  modalities: { output: ["image"] },
};

export const Empty: StoryObj<React.ComponentProps<typeof SelectedModelList>> = {
  args: {
    availableModels: [CHAT],
    selected: new Set<string>(),
  },
};

export const AddedModels: StoryObj<React.ComponentProps<typeof SelectedModelList>> = {
  args: {
    availableModels: [CHAT, EMBED, IMAGE],
    selected: new Set([CHAT.id, IMAGE.id]),
  },
};

export const LongNames: StoryObj<React.ComponentProps<typeof SelectedModelList>> = {
  args: {
    availableModels: [
      {
        id: "organization/long-context-reasoning-model",
        displayName: "Long context reasoning model with a descriptive provider label",
        limits: { context: 200000 },
        releaseDate: "2026-06-01",
      },
      { id: "custom-model", displayName: "自定义添加的模型入口与较长的展示名称" },
    ],
    selected: new Set(["organization/long-context-reasoning-model", "custom-model"]),
  },
};
