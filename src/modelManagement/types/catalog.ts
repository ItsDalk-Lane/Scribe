export type ProviderType = "anthropic" | "openai-compatible" | "google";

// 目录生命周期状态：deprecated 不可新增选择，alpha/beta 仅展示徽章。https://github.com/ItsDalk-Lane/Scribe/issues/67
export type ModelStatus = "alpha" | "beta" | "deprecated";

export type ModelCostCurrency = "USD" | "CNY";

export interface ModelInfo {
  id: string;
  displayName: string;
  family?: string;
  provider?: { npm?: string; api?: string; shape?: "responses" | "completions" };
  description?: string;
  modalities?: { input?: string[]; output?: string[] };
  limits?: { context?: number; output?: number; input?: number };
  reasoning?: boolean;
  reasoningEfforts?: readonly string[];
  toolCall?: boolean;
  attachment?: boolean;
  structuredOutput?: boolean;
  temperature?: boolean;
  temperatureValue?: number;
  status?: ModelStatus;
  isEmbedding?: boolean;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    currency?: ModelCostCurrency;
  };
  releaseDate?: string;
}

export interface CatalogProvider {
  id: string;
  npm?: string;
  env?: readonly string[];
  displayName: string;
  defaultBaseUrl?: string;
  providerType: ProviderType;
  models: Record<string, ModelInfo>;
}
