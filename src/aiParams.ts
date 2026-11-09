import { ModelCapability, ReasoningEffort } from "@/constants";
export interface ProjectConfig {
  id: string;
  name: string;
  workspacePath?: string;
  description?: string;
  systemPrompt: string;
  contextSource: {
    inclusions?: string;
    exclusions?: string;
    webUrls?: string;
    youtubeUrls?: string;
  };
  created: number;
  UsageTimestamps: number;
}

export interface ModelConfig {
  modelName: string;
  streaming: boolean;
  maxRetries: number;
  maxConcurrency: number;
  maxTokens?: number;
  maxCompletionTokens?: number;
  openAIApiKey?: string;
  openAIOrgId?: string;
  anthropicApiKey?: string;
  cohereApiKey?: string;
  apiKey?: string;
  openAIProxyBaseUrl?: string;
  groqApiKey?: string;
  mistralApiKey?: string;
}

export interface CustomModel {
  configuredModelId?: string;
  providerDisplayName?: string;
  credentialRef?: string;
  providerCatalogId?: string;
  providerNpm?: string;
  providerOptions?: Record<string, unknown>;
  apiShape?: "responses" | "completions";
  name: string;
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  requiresApiKey?: boolean;
  enabled: boolean;
  isEmbeddingModel?: boolean;
  stream?: boolean;
  streamUsage?: boolean;
  maxTokens?: number;

  numCtx?: number;

  useResponsesApi?: boolean;

  enablePromptCaching?: boolean;

  capabilities?: ModelCapability[];
  reasoning?: boolean;
  displayName?: string;

  openAIOrgId?: string;

  reasoningEffort?: ReasoningEffort;
  reasoningEfforts?: readonly string[];
}
