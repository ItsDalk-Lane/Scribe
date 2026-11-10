import type { Meta, StoryObj } from "@/lib/story";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import type { CatalogProvider } from "@/modelManagement/types/catalog";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import { ModelManagementProvider } from "@/modelManagement/ui/ModelManagementContext";
import { ModelConfigForm } from "./ModelConfigDialog";
import React from "react";

const catalogProvider: CatalogProvider = {
  id: "gallery-provider",
  displayName: "目录条目示例",
  providerType: "openai-compatible",
  models: {
    "gallery-model": {
      id: "gallery-model",
      displayName: "目录示例模型",
      modalities: { input: ["text", "image", "pdf"], output: ["text", "image"] },
      limits: { context: 1000000, input: 1000000, output: 384000 },
      reasoning: true,
      reasoningEfforts: ["low", "medium", "high"],
      toolCall: true,
      attachment: true,
      structuredOutput: true,
      temperature: true,
      cost: { input: 2.4, output: 9.6, cacheRead: 1.2, cacheWrite: 2.4 },
    },
  },
};

const provider: Provider = {
  providerId: "p-gallery",
  providerType: "openai-compatible",
  displayName: "画廊服务商",
  origin: { kind: "byok", catalogProviderId: catalogProvider.id },
  addedAt: 0,
};

const configured: ConfiguredModel = {
  configuredModelId: "cm-gallery",
  providerId: provider.providerId,
  info: catalogProvider.models["gallery-model"],
  configuredAt: 0,
};

const subscriptionModel: ConfiguredModel = {
  configuredModelId: "cm-subscription",
  providerId: provider.providerId,
  info: { id: "subscription-model", displayName: "订阅计费模型" },
  configuredAt: 0,
};

const deprecatedModel: ConfiguredModel = {
  configuredModelId: "cm-deprecated",
  providerId: provider.providerId,
  info: { ...configured.info, id: "old-model", displayName: "已弃用模型", status: "deprecated" },
  configuredAt: 0,
};

const fixtureApi = {
  catalogService: {
    ensureLoaded: async () => undefined,
    onChange: () => () => undefined,
    getProvider: (id: string) => (id === catalogProvider.id ? catalogProvider : undefined),
    getAllProviders: () => [],
  },
  configuredModelRegistry: { update: async () => undefined },
} as unknown as ModelManagementApi;

type ModelConfigStoryProps = React.ComponentProps<typeof ModelConfigForm>;

const renderStory = (configuredModel: ConfiguredModel): React.ReactElement => (
  <ModelManagementProvider api={fixtureApi}>
    <ModelConfigForm
      provider={provider}
      configuredModel={configuredModel}
      onClose={() => undefined}
    />
  </ModelManagementProvider>
);

const meta = {
  title: "Settings/Model config",
  component: ModelConfigForm,
  parameters: { gallery: { host: "modal", layout: "fullscreen", modalClass: "tw-max-h-[85vh]" } },
} satisfies Meta<ModelConfigStoryProps>;
export default meta;

export const PopulatedFromCatalog: StoryObj<ModelConfigStoryProps> = {
  render: () => renderStory(configured),
};

export const SubscriptionWithoutCost: StoryObj<ModelConfigStoryProps> = {
  render: () => renderStory(subscriptionModel),
};

export const NoReasoningEfforts: StoryObj<ModelConfigStoryProps> = {
  render: () =>
    renderStory({
      ...configured,
      info: { ...configured.info, reasoningEfforts: [] },
    }),
};

export const DeprecatedModel: StoryObj<ModelConfigStoryProps> = {
  render: () => renderStory(deprecatedModel),
};

export const LongModelName: StoryObj<ModelConfigStoryProps> = {
  render: () =>
    renderStory({
      ...configured,
      info: { ...configured.info, displayName: "用于检查长名称显示效果的示例模型配置名称" },
    }),
};
