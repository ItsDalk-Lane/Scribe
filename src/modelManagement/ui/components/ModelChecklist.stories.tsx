import type { Meta, StoryObj } from "@/lib/story";
import { ModelChecklist, type ModelChecklistProps } from "./ModelChecklist";

const meta = {
  title: "Settings/Model Checklist",
  component: ModelChecklist,
  args: {
    availableModels: [],
    selected: new Set<string>(),
    onToggle: () => {},
    onAddId: () => {},
    query: "",
    onQueryChange: () => {},
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ModelChecklistProps>;
export default meta;

export const ManualEntry: StoryObj<ModelChecklistProps> = {
  args: {
    modelInputHint: "e.g. qwen/qwen3.8-27b",
    fetchError: "Endpoint did not return a model list.",
  },
};

export const DiscoveredModels: StoryObj<ModelChecklistProps> = {
  args: {
    availableModels: [
      { id: "qwen/qwen3.8-27b", displayName: "Qwen 3.8 27B" },
      { id: "text-embedding-3-small", displayName: "Text Embedding 3 Small", isEmbedding: true },
    ],
  },
};

export const NonChatModels: StoryObj<ModelChecklistProps> = {
  args: {
    availableModels: [
      { id: "chat-model", displayName: "通用聊天模型", modalities: { output: ["text"] } },
      { id: "image-model", displayName: "图片生成模型", modalities: { output: ["image"] } },
      { id: "speech-model", displayName: "语音生成模型", family: "text-to-speech" },
      { id: "rerank-model", displayName: "重排模型", family: "rerank" },
    ],
    selected: new Set(["chat-model", "image-model"]),
  },
};

export const LongNames: StoryObj<ModelChecklistProps> = {
  args: {
    availableModels: [
      {
        id: "organization/long-context-reasoning-model",
        displayName: "Long context reasoning model with a descriptive provider label",
        limits: { context: 200000 },
        releaseDate: "2026-06-01",
      },
      { id: "custom-model", displayName: "自定义模型入口与较长的说明名称" },
    ],
    customIds: new Set(["custom-model"]),
    selected: new Set(["custom-model"]),
    onRemoveId: () => {},
  },
};
