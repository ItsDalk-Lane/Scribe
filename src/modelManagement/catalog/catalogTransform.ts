import { logWarn } from "@/logger";

import type {
  CatalogProvider,
  ModelInfo,
  ModelStatus,
  ProviderType,
} from "@/modelManagement/types/catalog";
import { isPlainObject, type WireModel, type WireProvider } from "./modelsDevWire";

const EMBEDDING_TOKEN = /(^|[-_/.\s])embed(ding)?($|[-_/.\s])/i;

const MODEL_STATUSES: readonly ModelStatus[] = ["alpha", "beta", "deprecated"];

export function looksLikeEmbeddingModel(idOrHaystack: string): boolean {
  return EMBEDDING_TOKEN.test(idOrHaystack);
}

const UNROUTABLE_PROVIDER_NPM: ReadonlySet<string> = new Set([
  "@ai-sdk/amazon-bedrock",
  "@ai-sdk/azure",
]);

function isUnroutableProvider(wire: unknown): boolean {
  if (!isPlainObject(wire)) return false;
  const npm = (wire as { npm?: unknown }).npm;
  return typeof npm === "string" && UNROUTABLE_PROVIDER_NPM.has(npm);
}

function mapNpmToProviderType(npm: string | undefined): ProviderType {
  switch (npm) {
    case "@ai-sdk/anthropic":
      return "anthropic";
    case "@ai-sdk/google":
      return "google";
    default:
      return "openai-compatible";
  }
}

function transformModel(wire: WireModel): ModelInfo | null {
  if (typeof wire.id !== "string") return null;
  const info: ModelInfo = {
    id: wire.id,
    displayName: wire.name ?? wire.id,
  };

  if (typeof wire.family === "string") info.family = wire.family;
  if (isPlainObject(wire.provider)) {
    const provider: NonNullable<ModelInfo["provider"]> = {};
    if (typeof wire.provider.npm === "string") provider.npm = wire.provider.npm;
    if (typeof wire.provider.api === "string") provider.api = wire.provider.api;
    if (wire.provider.shape === "responses" || wire.provider.shape === "completions") {
      provider.shape = wire.provider.shape;
    }
    if (Object.keys(provider).length > 0) info.provider = provider;
  }

  const modInput = Array.isArray(wire.modalities?.input) ? wire.modalities.input : undefined;
  const modOutput = Array.isArray(wire.modalities?.output) ? wire.modalities.output : undefined;
  if (modInput || modOutput) {
    info.modalities = {
      ...(modInput ? { input: modInput } : {}),
      ...(modOutput ? { output: modOutput } : {}),
    };
  }

  if (wire.limit) {
    const { context, output, input } = wire.limit;
    const limits: NonNullable<ModelInfo["limits"]> = {};
    if (typeof context === "number") limits.context = context;
    if (typeof output === "number") limits.output = output;
    if (typeof input === "number") limits.input = input;
    if (Object.keys(limits).length > 0) info.limits = limits;
  }

  if (typeof wire.reasoning === "boolean") info.reasoning = wire.reasoning;
  if (typeof wire.tool_call === "boolean") info.toolCall = wire.tool_call;
  if (typeof wire.attachment === "boolean") info.attachment = wire.attachment;
  if (typeof wire.structured_output === "boolean") info.structuredOutput = wire.structured_output;
  if (typeof wire.temperature === "boolean") info.temperature = wire.temperature;
  const efforts = parseReasoningEffortValues(wire.reasoning_options);
  if (efforts.length > 0) info.reasoningEfforts = efforts;
  if (
    typeof wire.status === "string" &&
    (MODEL_STATUSES as readonly string[]).includes(wire.status)
  ) {
    info.status = wire.status as ModelStatus;
  }
  if (looksLikeEmbeddingModel(`${wire.id} ${typeof wire.family === "string" ? wire.family : ""}`)) {
    info.isEmbedding = true;
  }
  if (typeof wire.release_date === "string") info.releaseDate = wire.release_date;

  if (wire.cost) {
    const { input, output, cache_read, cache_write } = wire.cost;
    const cost: NonNullable<ModelInfo["cost"]> = {};
    if (typeof input === "number") cost.input = input;
    if (typeof output === "number") cost.output = output;
    if (typeof cache_read === "number") cost.cacheRead = cache_read;
    if (typeof cache_write === "number") cost.cacheWrite = cache_write;
    if (Object.keys(cost).length > 0) info.cost = cost;
  }

  return info;
}

// 目录档位声明是结构化列表（effort 档位 / 开关 / 预算），编辑界面只呈现档位值，收集全部 effort 取值即可。https://github.com/ItsDalk-Lane/Scribe/issues/67
function parseReasoningEffortValues(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const values: string[] = [];
  for (const option of options) {
    if (!isPlainObject(option) || option.type !== "effort") continue;
    if (!Array.isArray(option.values)) continue;
    for (const value of option.values) {
      if (typeof value !== "string" || value.length === 0) continue;
      if (!values.includes(value)) values.push(value);
    }
  }
  return values;
}

function transformProvider(providerKey: string, wire: unknown): CatalogProvider | null {
  if (!isPlainObject(wire)) return null;
  if (typeof (wire as { id?: unknown }).id !== "string") return null;
  const wireProv = wire as unknown as WireProvider;

  const models: Record<string, ModelInfo> = {};
  const wireModels = isPlainObject(wireProv.models) ? wireProv.models : {};
  for (const [modelKey, wireModel] of Object.entries(wireModels)) {
    if (!isPlainObject(wireModel)) {
      logWarn(
        `[modelsCatalog] dropping model "${modelKey}" under provider "${providerKey}": not an object`
      );
      continue;
    }
    const model = transformModel(wireModel);
    if (model) {
      models[model.id] = model;
    } else {
      logWarn(
        `[modelsCatalog] dropping model "${modelKey}" under provider "${providerKey}": invalid id`
      );
    }
  }
  const result: CatalogProvider = {
    id: wireProv.id,
    displayName: wireProv.name ?? wireProv.id,
    providerType: mapNpmToProviderType(wireProv.npm),
    models,
  };
  if (typeof wireProv.npm === "string") result.npm = wireProv.npm;
  if (Array.isArray(wireProv.env)) {
    const env = wireProv.env.filter((value): value is string => typeof value === "string");
    if (env.length > 0) result.env = env;
  }
  if (typeof wireProv.api === "string" && wireProv.api.length > 0) {
    result.defaultBaseUrl = wireProv.api;
  }
  return result;
}

export function transformWireToCatalog(wire: unknown): CatalogProvider[] {
  if (!isPlainObject(wire)) return [];
  const providers: CatalogProvider[] = [];
  for (const [key, wireProvider] of Object.entries(wire)) {
    if (isUnroutableProvider(wireProvider)) continue;
    const provider = transformProvider(key, wireProvider);
    if (provider) {
      providers.push(provider);
    } else if (isPlainObject(wireProvider) && "id" in wireProvider) {
      logWarn(`[modelsCatalog] dropping provider "${key}": invalid id`);
    }
  }
  providers.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return providers;
}
