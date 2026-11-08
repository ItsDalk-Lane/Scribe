import type { Api, Model, ModelThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/models";
import type { CustomModel } from "@/aiParams";
import { ModelCapability } from "@/constants";
import catalog from "@/LLMProviders/nativeSdk/modelThinkingCatalog.json";

interface ThinkingModel {
  id: string;
  provider: string;
  baseUrl: string;
  api: Api;
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  compat?: Pick<
    NonNullable<Model<"openai-completions">["compat"]>,
    "supportsReasoningEffort" | "thinkingFormat"
  >;
}

const MODELS = catalog as unknown as readonly ThinkingModel[];
const LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const EMPTY_LEVELS: readonly ModelThinkingLevel[] = Object.freeze([]);

const THINKING_LEVEL_MAP_OVERRIDES: Readonly<Record<string, ThinkingLevelMap>> = Object.freeze({
  "zai-coding-cn": Object.freeze({ max: "high" } as ThinkingLevelMap),
});

function urlHost(url?: string): string | undefined {
  try {
    return new URL(url ?? "").host;
  } catch {
    return undefined;
  }
}

export function resolveModelThinking(input: CustomModel, api?: Api) {
  const host = urlHost(input.baseUrl);
  const candidates = MODELS.filter(
    (model) => model.id === input.name && (!api || model.api === api)
  );
  const known =
    candidates.find((model) => model.provider === input.providerCatalogId) ??
    candidates.find((model) => host && urlHost(model.baseUrl) === host) ??
    candidates[0];
  const reasoning =
    known?.reasoning ?? input.capabilities?.includes(ModelCapability.REASONING) ?? false;
  const thinkingLevelMap: ThinkingLevelMap = {
    ...(known?.thinkingLevelMap ?? { off: null }),
    ...(known ? THINKING_LEVEL_MAP_OVERRIDES[known.provider] : undefined),
  };
  const advertised = input.reasoningEfforts?.map((level) => (level === "none" ? "off" : level));
  const levels = advertised
    ? advertised.filter((level): level is ModelThinkingLevel => LEVELS.includes(level))
    : reasoning
      ? getSupportedThinkingLevels({ reasoning, thinkingLevelMap } as Model<Api>)
      : EMPTY_LEVELS;
  return { reasoning, thinkingLevelMap, levels, compat: known?.compat };
}
