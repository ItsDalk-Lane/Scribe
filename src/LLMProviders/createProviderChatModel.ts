import type { Api, Model, StreamOptions } from "@earendil-works/pi-ai";
import type { CustomModel } from "@/aiParams";
import {
  ChatModelProviders,
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  ModelCapability,
  ProviderInfo,
  ReasoningEffort,
} from "@/constants";
import { createProviderFetch } from "@/LLMProviders/providerTransport";
import { createPiChatModel, type ProviderChatModel } from "@/LLMProviders/piChatModel";
import { createHttpProviderChatModel } from "@/LLMProviders/createHttpProviderChatModel";
import { anthropicHostBaseUrl, groqHostBaseUrl } from "@/utils/providerBaseUrl";
import { isRecord } from "@/utils/obsidianInternals";
import { t } from "@/lib/i18n";
import { withModelCredentials } from "@/LLMProviders/modelCredentials";
import { resolveModelThinking } from "@/LLMProviders/modelThinking";

const LEGACY_PROTOCOLS: Record<ChatModelProviders, string> = {
  [ChatModelProviders.OPENAI]: "@ai-sdk/openai",
  [ChatModelProviders.ANTHROPIC]: "@ai-sdk/anthropic",
  [ChatModelProviders.GOOGLE]: "@ai-sdk/google",
  [ChatModelProviders.OPENROUTERAI]: "@openrouter/ai-sdk-provider",
  [ChatModelProviders.OLLAMA]: "scribe-ollama",
  [ChatModelProviders.LM_STUDIO]: "@ai-sdk/openai-compatible",
  [ChatModelProviders.OPENAI_FORMAT]: "@ai-sdk/openai-compatible",
  [ChatModelProviders.COHEREAI]: "@ai-sdk/openai-compatible",
  [ChatModelProviders.XAI]: "@ai-sdk/xai",
  [ChatModelProviders.GROQ]: "@ai-sdk/groq",
  [ChatModelProviders.MISTRAL]: "@ai-sdk/mistral",
  [ChatModelProviders.DEEPSEEK]: "@ai-sdk/deepseek",
  [ChatModelProviders.SILICONFLOW]: "@ai-sdk/openai-compatible",
};

const HTTP_PROTOCOLS = new Set([
  "@ai-sdk/google",
  "@ai-sdk/cohere",
  "@ai-sdk/google-vertex",
  "@ai-sdk/google-vertex/anthropic",
  "gitlab-ai-provider",
  "@jerome-benoit/sap-ai-provider-v2",
  "scribe-ollama",
]);

const ANTHROPIC_OUTPUT_DEFAULTS = [
  ["claude-opus-5", 16384],
  ["claude-fable-5", 16384],
  ["claude-mythos-5", 16384],
  ["claude-mythos-preview", 16384],
  ["claude-sonnet-4", 16384],
  ["claude-opus-4", 16384],
  ["claude-haiku-4-5", 16384],
  ["claude-3-7-sonnet", 8192],
  ["claude-3-5-sonnet", 8192],
  ["claude-3-5-haiku", 8192],
] as const;

export async function createProviderChatModel(input: CustomModel): Promise<ProviderChatModel> {
  const legacy = !input.providerNpm;
  const provider = input.provider as ChatModelProviders;
  const npm = input.providerNpm || LEGACY_PROTOCOLS[provider];
  if (!npm) throw new Error(`Unknown provider: ${input.provider} for model: ${input.name}`);
  const model: CustomModel = {
    ...input,
    providerNpm: npm,
    baseUrl:
      input.baseUrl?.trim() ||
      (legacy && provider !== ChatModelProviders.OPENAI_FORMAT
        ? ProviderInfo[provider]?.curlBaseURL
        : undefined),
  };
  if (legacy && provider === ChatModelProviders.GROQ)
    model.baseUrl = `${groqHostBaseUrl(model.baseUrl)}/openai/v1`;
  if (npm === "@ai-sdk/google") {
    const base = model.baseUrl?.replace(/\/+$/, "") || "https://generativelanguage.googleapis.com";
    model.baseUrl = /\/v1(?:beta)?$/.test(base) ? base : `${base}/v1beta`;
  }
  if (npm === "@ai-sdk/cohere") model.baseUrl ||= "https://api.cohere.com/v2";
  if (npm === "@ai-sdk/anthropic") model.baseUrl = anthropicHostBaseUrl(model.baseUrl);
  if (!model.baseUrl && !HTTP_PROTOCOLS.has(npm))
    throw new Error(t("A base URL is required for this provider."));

  const anthropic = npm === "@ai-sdk/anthropic" || npm === "@ai-sdk/google-vertex/anthropic";
  const openRouter = npm === "@openrouter/ai-sdk-provider";
  const responses =
    model.apiShape === "responses" ||
    (model.apiShape !== "completions" &&
      (npm === "@ai-sdk/openai" ||
        (legacy && provider === ChatModelProviders.LM_STUDIO && model.useResponsesApi !== false)));
  const api: Api = anthropic
    ? "anthropic-messages"
    : npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex"
      ? "google-generative-ai"
      : npm === "@ai-sdk/cohere"
        ? "scribe-cohere"
        : npm === "@jerome-benoit/sap-ai-provider-v2"
          ? "scribe-sap"
          : npm === "scribe-ollama"
            ? "scribe-ollama"
            : responses
              ? "openai-responses"
              : "openai-completions";
  const openRouterOptions =
    openRouter || (legacy && provider === ChatModelProviders.LM_STUDIO && !responses);
  const thinking = resolveModelThinking(model, api);
  const descriptor: Model<Api> = {
    id: model.name,
    name: model.displayName || model.name,
    api,
    provider: model.providerCatalogId || (openRouter ? "openrouter" : model.provider),
    baseUrl: model.baseUrl || "",
    // 能力未知的来源（手填、无目录元数据）保持宽松；已声明无视觉能力的模型必须如实声明，让下层降级历史图片。https://github.com/ItsDalk-Lane/Scribe/issues/56
    input:
      model.capabilities === undefined || model.capabilities.includes(ModelCapability.VISION)
        ? ["text", "image"]
        : ["text"],
    reasoning: thinking.reasoning,
    thinkingLevelMap: thinking.thinkingLevelMap,
    contextWindow: model.numCtx ?? 0,
    maxTokens:
      model.maxTokens ??
      (npm === "@ai-sdk/anthropic"
        ? (ANTHROPIC_OUTPUT_DEFAULTS.find(([prefix]) => model.name.startsWith(prefix))?.[1] ?? 4096)
        : anthropic
          ? 4096
          : 0),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {
      // SDK 按目录中的协议能力选择自适应思考，不能在工厂里丢掉能力再退回旧式预算。https://github.com/ItsDalk-Lane/Scribe/issues/56
      ...thinking.compat,
      supportsDeveloperRole: api === "openai-responses" && npm === "@ai-sdk/openai",
      supportsStore: false,
      supportsUsageInStreaming: openRouterOptions || (model.streamUsage ?? false),
      supportsReasoningEffort: thinking.compat?.supportsReasoningEffort ?? false,
      maxTokensField: "max_tokens",
      thinkingFormat: thinking.compat?.thinkingFormat ?? "openai",
    },
  };
  const defaults: StreamOptions = {
    maxRetries: 3,
    cacheRetention: "none",
    // SDK 的默认请求超时在此显式固化；SDK 的计时只保护到响应头，流空闲期限由统一调用层补足。https://github.com/ItsDalk-Lane/Scribe/issues/59
    timeoutMs: DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
    ...((api === "openai-responses" || npm === "gitlab-ai-provider") && model.reasoningEffort
      ? { reasoningEffort: model.reasoningEffort }
      : {}),
    ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
  };
  if (
    anthropic ||
    npm === "gitlab-ai-provider" ||
    npm === "@ai-sdk/google-vertex" ||
    npm === "watsonx-ai-provider" ||
    model.providerCatalogId === "google-vertex" ||
    model.providerCatalogId === "google-vertex-anthropic" ||
    model.providerCatalogId === "watsonx"
  ) {
    defaults.apiKey = "provider-managed-auth";
  }
  if (legacy && provider === ChatModelProviders.GOOGLE) {
    defaults.onPayload = (payload) => {
      if (!isRecord(payload)) throw new Error(t("Unexpected response"));
      return {
        ...payload,
        safetySettings: [
          "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          "HARM_CATEGORY_HATE_SPEECH",
          "HARM_CATEGORY_DANGEROUS_CONTENT",
          "HARM_CATEGORY_HARASSMENT",
        ].map((category) => ({ category, threshold: "BLOCK_NONE" })),
      };
    };
  }
  if (HTTP_PROTOCOLS.has(npm)) return createHttpProviderChatModel(model, descriptor, defaults);

  const headers: Record<string, string> = {};
  if (model.openAIOrgId) headers["OpenAI-Organization"] = model.openAIOrgId;
  if (openRouter) {
    headers["HTTP-Referer"] = "https://obsidiancopilot.com";
    headers["X-Title"] = "Obsidian Scribe";
  }
  defaults.headers = headers;
  defaults.onPayload = (payload) => {
    if (!isRecord(payload)) throw new Error(t("Unexpected response"));
    if (openRouterOptions) {
      if (descriptor.reasoning)
        payload.reasoning = model.reasoningEffort
          ? {
              effort:
                model.reasoningEffort === ReasoningEffort.MINIMAL ? "low" : model.reasoningEffort,
            }
          : { max_tokens: 1024 };
      if (
        (model.enablePromptCaching ?? true) &&
        new URL(descriptor.baseUrl).hostname === "openrouter.ai"
      )
        payload.cache_control = { type: "ephemeral" };
    }
    if (legacy && provider === ChatModelProviders.LM_STUDIO && responses) {
      payload.text = { format: { type: "text" } };
      for (const key of ["tools", "tool_choice", "parallel_tool_calls"])
        if (payload[key] == null) delete payload[key];
    }
    return payload;
  };
  const implementation =
    api === "anthropic-messages"
      ? await import("@earendil-works/pi-ai/api/anthropic-messages")
      : api === "openai-responses"
        ? await import("@earendil-works/pi-ai/api/openai-responses")
        : await import("@earendil-works/pi-ai/api/openai-completions");
  return createPiChatModel(
    descriptor,
    async (options) => {
      options.signal?.throwIfAborted();
      return withModelCredentials(model, async (requestModel) => {
        options.signal?.throwIfAborted();
        const redactionValues = [requestModel.apiKey ?? ""];
        return {
          redactionValues,
          observesDispatch: true,
          stream: implementation.stream,
          options: {
            ...defaults,
            apiKey: defaults.apiKey ?? requestModel.apiKey ?? "keyless-endpoint",
            fetch: createProviderFetch(requestModel, redactionValues, options.onProviderDispatch),
            headers: {
              ...headers,
              ...(anthropic ? { "x-api-key": requestModel.apiKey || "" } : {}),
            },
          },
        };
      });
    },
    model.configuredModelId,
    model.providerDisplayName
  );
}
