import type { Meta, StoryObj } from "@/lib/story";
import { AddProviderContent, type AddProviderContentProps } from "./AddProviderDialog";

const meta = {
  title: "Settings/Add Provider",
  component: AddProviderContent,
  args: {
    catalogProviders: [
      {
        id: "google-vertex",
        displayName: "Google Vertex AI",
        providerType: "google",
        npm: "@ai-sdk/google-vertex",
        models: {},
      },
      {
        id: "cloudflare-workers-ai",
        displayName: "Cloudflare Workers AI",
        providerType: "openai-compatible",
        npm: "@ai-sdk/openai-compatible",
        models: {},
      },
      {
        id: "sap-ai-core",
        displayName: "SAP AI Core",
        providerType: "openai-compatible",
        npm: "@jerome-benoit/sap-ai-provider-v2",
        models: {},
      },
    ],
    localTemplates: [
      {
        id: "ollama",
        displayName: "Ollama",
        providerType: "openai-compatible",
        defaultBaseUrl: "http://localhost:11434/v1",
        requiresApiKey: false,
        modelInputHint: "本地模型 ID",
      },
    ],
    customTemplate: {
      id: "custom",
      displayName: "自定义模型服务",
      providerType: "openai-compatible",
      requiresApiKey: false,
      modelInputHint: "模型 ID",
    },
    onPick: () => undefined,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<AddProviderContentProps>;
export default meta;

export const AllProviderFamilies: StoryObj<AddProviderContentProps> = {};
