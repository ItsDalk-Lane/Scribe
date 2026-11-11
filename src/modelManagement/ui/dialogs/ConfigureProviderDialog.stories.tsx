import type { Meta, StoryObj } from "@/lib/story";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import type { CatalogProvider } from "@/modelManagement/types/catalog";
import { ModelManagementProvider } from "@/modelManagement/ui/ModelManagementContext";
import { ConfigureProviderForm } from "./ConfigureProviderDialog";
import React from "react";

const provider: CatalogProvider = {
  id: "gallery-provider",
  displayName: "长模型列表配置预览",
  providerType: "openai-compatible",
  models: Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => {
      const id = `chat-model-${String(index + 1).padStart(2, "0")}`;
      return [
        id,
        {
          id,
          displayName: `通用聊天模型 ${index + 1} · 长上下文与推理能力`,
          limits: { context: 128000 },
          modalities: { input: ["text"], output: ["text"] },
        },
      ];
    })
  ),
};
const fixtureApi = {
  catalogService: {
    ensureLoaded: async () => undefined,
    onChange: () => () => undefined,
    getProvider: (id: string) => (id === provider.id ? provider : undefined),
    getAllProviders: () => [],
  },
  providerRegistry: { getApiKeyStatus: () => "missing" },
  setup: {
    byok: { setupProvider: async () => ({ providerId: "fixture", configuredModelIds: [] }) },
  },
} as unknown as ModelManagementApi;

type ConfigureProviderStoryProps = React.ComponentProps<typeof ConfigureProviderForm>;
const meta = {
  title: "Settings/Configure Provider",
  component: ConfigureProviderForm,
  args: {
    state: {
      mode: "new",
      source: {
        id: provider.id,
        catalogProviderId: provider.id,
        displayName: provider.displayName,
        providerType: provider.providerType,
        requiresApiKey: true,
        modelInputHint: "模型 ID",
      },
    },
    onClose: () => undefined,
  },
  parameters: { gallery: { host: "modal", layout: "fullscreen", modalClass: "tw-max-h-[85vh]" } },
} satisfies Meta<ConfigureProviderStoryProps>;
export default meta;

export const LongCatalog: StoryObj<ConfigureProviderStoryProps> = {
  render: (args) => (
    <ModelManagementProvider api={fixtureApi}>
      <div className="tw-flex tw-min-h-0 tw-flex-col tw-overflow-hidden">
        <ConfigureProviderForm
          state={args.state ?? meta.args.state}
          onClose={args.onClose ?? meta.args.onClose}
        />
      </div>
    </ModelManagementProvider>
  ),
};

export const CustomEndpoint: StoryObj<ConfigureProviderStoryProps> = {
  render: LongCatalog.render,
  args: {
    state: {
      mode: "new",
      source: {
        id: "custom-endpoint",
        displayName: "本地或自定义模型服务",
        providerType: "openai-compatible",
        requiresApiKey: false,
        modelInputHint: "模型 ID",
      },
    },
  },
};

export const PresetVersionGrid: StoryObj<ConfigureProviderStoryProps> = {
  render: LongCatalog.render,
  args: {
    state: {
      mode: "new",
      source: {
        id: "kimi",
        presetId: "kimi",
        catalogProviderId: "moonshotai",
        displayName: "Kimi",
        providerType: "openai-compatible",
        defaultBaseUrl: "https://api.moonshot.cn/v1",
        requiresApiKey: true,
        modelInputHint: "模型 ID",
      },
    },
  },
};

export const PresetVersionList: StoryObj<ConfigureProviderStoryProps> = {
  render: LongCatalog.render,
  args: {
    state: {
      mode: "new",
      source: {
        id: "sudo-code-chat",
        presetId: "sudo-code-chat",
        catalogProviderId: "openai",
        displayName: "SudoCode",
        providerType: "openai-compatible",
        defaultBaseUrl: "https://api.sudocode.chat/v1",
        requiresApiKey: true,
        modelInputHint: "模型 ID",
      },
    },
  },
};
