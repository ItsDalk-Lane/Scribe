import type { ModelInfo, ProviderType } from "./catalog";

type RetiredPersistedAgentType = "claude";

export type AgentType = RetiredPersistedAgentType | "native";

export type BackendType = AgentType | "chat";

export type ProviderOrigin =
  | {
      kind: "byok";
      catalogProviderId?: string;
    }
  | { kind: "agent"; agentType: AgentType };

export interface Provider {
  providerId: string;
  providerType: ProviderType;
  displayName: string;
  baseUrl?: string;
  apiKeyRef?: string | null;
  requiresApiKey?: boolean;
  // 关闭供应商只让它的模型退出各界面选择器，配置与密钥保持原样；缺省视为包含，旧 data.json 无需改写。https://github.com/ItsDalk-Lane/Scribe/issues/69
  enabled?: boolean;
  extras?: Record<string, unknown>;
  origin: ProviderOrigin;
  addedAt: number;
}

export interface ConfiguredModel {
  configuredModelId: string;
  providerId: string;
  info: ModelInfo;
  configuredAt: number;
}

export interface BackendConfig {
  enabledModels: string[];
}
