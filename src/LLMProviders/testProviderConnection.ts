import { RequestRedactor } from "@/LLMProviders/requestRedaction";
import {
  type Provider,
  type ModelInfo,
  type VerificationResult,
  configuredModelToCustomModel,
  providerNeedsResolvedApiKey,
} from "@/modelManagement";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { getProviderSessionOptions } from "@/LLMProviders/providerSession";
import { t } from "@/lib/i18n";

export interface TestProviderConnectionInput {
  provider: Provider;
  model: ModelInfo;
  apiKey: string | null;
  signal?: AbortSignal;
}

export async function testProviderConnection(
  input: TestProviderConnectionInput
): Promise<VerificationResult> {
  if (input.signal?.aborted) {
    return {
      ok: false,
      code: "cancelled",
      message: t("Connection test cancelled."),
      checkedAt: Date.now(),
    };
  }
  if (
    providerNeedsResolvedApiKey(input.provider) &&
    !input.apiKey?.trim() &&
    !input.provider.apiKeyRef
  ) {
    return {
      ok: false,
      code: "missing_api_key",
      message: t("Enter an API key to verify this provider."),
      checkedAt: Date.now(),
    };
  }
  const controller = new AbortController();
  const relayAbort = (): void => controller.abort();
  input.signal?.addEventListener("abort", relayAbort, { once: true });
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 90000);
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => reject(new Error("Connection test aborted")),
      { once: true }
    );
  });
  try {
    const operation = async (): Promise<VerificationResult> => {
      const configuredModel = {
        configuredModelId: "connection-test",
        providerId: input.provider.providerId,
        info: input.model,
        configuredAt: 0,
      };
      const customModel = configuredModelToCustomModel({
        provider: input.provider,
        configuredModel,
        apiKey: input.apiKey,
      });
      const model =
        await ChatModelManager.getInstance().createModelInstanceFromBridged(customModel);
      if (controller.signal.aborted) throw new Error("Connection test aborted");
      const session = getProviderSessionOptions(customModel, configuredModel);
      const stream = model.stream(
        {
          messages: [{ role: "user", content: "Reply with OK.", timestamp: Date.now() }],
        },
        {
          signal: controller.signal,
          maxRetries: 0,
          headers: session?.options.headers,
        }
      );
      let reply = "";
      for await (const event of stream) {
        if (controller.signal.aborted) throw new Error("Connection test aborted");
        if (event.type === "text_delta") reply += event.delta;
      }
      return reply.trim()
        ? {
            ok: true,
            message: t("Chat connection verified with {model}.", {
              model: input.model.displayName || input.model.id,
            }),
            checkedAt: Date.now(),
          }
        : {
            ok: false,
            code: "empty_response",
            message: t("The model returned no reply text. Check its output settings."),
            checkedAt: Date.now(),
          };
    };
    return await Promise.race([operation(), aborted]);
  } catch (error) {
    const data = error as { status?: number; statusCode?: number; message?: unknown } | null;
    const status = data?.status ?? data?.statusCode;
    const raw = error instanceof Error ? error.message : String(error);
    const message = new RequestRedactor([input.apiKey ?? ""]).redact(raw);
    return {
      ok: false,
      code: timedOut
        ? "timeout"
        : controller.signal.aborted
          ? "cancelled"
          : status === 401
            ? "invalid_api_key"
            : status === 403
              ? "permission_denied"
              : "chat_error",
      message: timedOut
        ? t("Connection test timed out after 90 seconds.")
        : controller.signal.aborted
          ? t("Connection test cancelled.")
          : message,
      checkedAt: Date.now(),
    };
  } finally {
    window.clearTimeout(timeout);
    input.signal?.removeEventListener("abort", relayAbort);
  }
}
