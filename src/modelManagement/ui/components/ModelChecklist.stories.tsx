import type { Meta, StoryObj } from "@/lib/story";
import { ModelChecklist } from "./ModelChecklist";

const meta = {
  title: "Settings/Model Checklist",
  component: ModelChecklist,
  args: {
    availableModels: [],
    selected: new Set<string>(),
    onToggle: () => {},
    onAddId: () => {},
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<React.ComponentProps<typeof ModelChecklist>>;
export default meta;

export const ManualEntry: StoryObj<React.ComponentProps<typeof ModelChecklist>> = {
  args: {
    modelInputHint: "e.g. qwen/qwen3.8-27b",
    fetchError: "Endpoint did not return a model list.",
  },
};

export const DiscoveredModels: StoryObj<React.ComponentProps<typeof ModelChecklist>> = {
  args: {
    availableModels: [
      { id: "qwen/qwen3.8-27b", displayName: "Qwen 3.8 27B" },
      { id: "text-embedding-3-small", displayName: "Text Embedding 3 Small", isEmbedding: true },
    ],
  },
};

export const NonChatModels: StoryObj<React.ComponentProps<typeof ModelChecklist>> = {
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

export const LongNames: StoryObj<React.ComponentProps<typeof ModelChecklist>> = {
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

export const Fetching: StoryObj<React.ComponentProps<typeof ModelChecklist>> = {
  args: {
    fetching: true,
  },
};

export const ManyModels: StoryObj<React.ComponentProps<typeof ModelChecklist>> = {
  args: {
    availableModels: Array.from({ length: 30 }, (_, index) => ({
      id: `chat-model-${String(index + 1).padStart(2, "0")}`,
      displayName: `通用聊天模型 ${index + 1} · 长上下文与推理能力`,
      limits: { context: 128000 },
    })),
    selected: new Set(["chat-model-01"]),
    customIds: new Set(["chat-model-01"]),
    onRemoveId: () => {},
  },
};
