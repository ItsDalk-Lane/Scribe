import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CustomModel } from "@/aiParams";
import {
  createChatChain,
  createChatMemory,
  type ChatChain,
  type ChatMemory,
} from "@/commands/customCommandChatEngine";
import { compactAssistantOutput } from "@/context/ChatHistoryCompactor";
import { ThinkBlockStreamer } from "@/LLMProviders/chainRunner/utils/ThinkBlockStreamer";
import { ABORT_REASON } from "@/constants";
import { logError } from "@/logger";
import { useRafThrottledCallback } from "@/hooks/use-raf-throttled-callback";
import { getProviderSessionOptions } from "@/LLMProviders/providerSession";

export interface StreamingChatTurnContext {
  signal: AbortSignal;
  isFirstTurn: boolean;
}

export interface UseStreamingChatSessionParams {
  model: CustomModel | null;
  systemPrompt: string;
  excludeThinking?: boolean;
  onNoModel?: () => void;
  onNonAbortError?: (error: unknown) => void;
  onTruncated?: () => void;
}

export interface StreamingChatSessionApi {
  isStreaming: boolean;
  streamingText: string;

  getIsFirstTurn: () => boolean;

  runTurn: (
    getPrompt: (ctx: StreamingChatTurnContext) => Promise<string>
  ) => Promise<string | null>;

  stop: (reason?: ABORT_REASON) => void;

  reset: () => void;

  getMemory: () => ChatMemory | null;

  getLatestStreamingText: () => string;
}

interface ChainAndMemory {
  chain: ChatChain;
  memory: ChatMemory;
}

function shouldSkipPersistOnAbort(signal: AbortSignal): boolean {
  if (!signal.aborted) return false;

  const reason = signal.reason;
  if (typeof reason !== "string") return true;

  const typedReason = reason as ABORT_REASON;
  return typedReason === ABORT_REASON.NEW_CHAT || typedReason === ABORT_REASON.UNMOUNT;
}

export function useStreamingChatSession(
  params: UseStreamingChatSessionParams
): StreamingChatSessionApi {
  const {
    model,
    systemPrompt,
    excludeThinking = true,
    onNoModel,
    onNonAbortError,
    onTruncated,
  } = params;

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  const isMountedRef = useRef(true);
  const isStreamingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const streamingTextRef = useRef("");
  const hasSavedContextOnceRef = useRef(false);
  const turnIdRef = useRef(0);

  const onNoModelRef = useRef(onNoModel);
  const onNonAbortErrorRef = useRef(onNonAbortError);
  const onTruncatedRef = useRef(onTruncated);
  useEffect(() => {
    onNoModelRef.current = onNoModel;
    onNonAbortErrorRef.current = onNonAbortError;
    onTruncatedRef.current = onTruncated;
  }, [onNoModel, onNonAbortError, onTruncated]);

  const memoryRef = useRef<ChatMemory | null>(null);
  const chainRef = useRef<ChatChain | null>(null);
  const currentModelKeyRef = useRef<string | null>(null);
  const currentSystemPromptRef = useRef<string | null>(null);

  // 完整模型快照覆盖连接、能力和预算，任何请求配置变化都应让下一轮重建链路。https://github.com/ItsDalk-Lane/Scribe/issues/62
  const modelKey = useMemo(() => (model ? JSON.stringify(model) : null), [model]);

  const setStreamingTextThrottled = useRafThrottledCallback((text: string) => {
    if (!isMountedRef.current) return;
    setStreamingText(text);
  });

  const handleDelta = useCallback(
    (text: string): void => {
      if (!isMountedRef.current) return;
      streamingTextRef.current = text;
      setStreamingTextThrottled(text);
    },
    [setStreamingTextThrottled]
  );

  const getOrCreateChain = useCallback(
    async (signal: AbortSignal): Promise<ChainAndMemory | null> => {
      if (!model || !modelKey) {
        onNoModelRef.current?.();
        return null;
      }

      const needsRecreate =
        !chainRef.current ||
        currentModelKeyRef.current !== modelKey ||
        currentSystemPromptRef.current !== systemPrompt;

      if (needsRecreate) {
        if (!memoryRef.current) {
          memoryRef.current = createChatMemory();
        }

        const nextChain = await createChatChain(model, systemPrompt, memoryRef.current);

        if (signal.aborted) return null;

        chainRef.current = nextChain;
        currentModelKeyRef.current = modelKey;
        currentSystemPromptRef.current = systemPrompt;
      }

      if (!chainRef.current || !memoryRef.current) return null;
      return { chain: chainRef.current, memory: memoryRef.current };
    },
    [model, modelKey, systemPrompt]
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort(ABORT_REASON.UNMOUNT);
      abortControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isStreamingRef.current) {
      abortControllerRef.current?.abort(ABORT_REASON.NEW_CHAT);
    }
    chainRef.current = null;
    currentModelKeyRef.current = null;
    currentSystemPromptRef.current = null;
  }, [modelKey, systemPrompt]);

  const getIsFirstTurn = useCallback((): boolean => {
    return !hasSavedContextOnceRef.current;
  }, []);

  const getMemory = useCallback((): ChatMemory | null => {
    return memoryRef.current;
  }, []);

  const getLatestStreamingText = useCallback((): string => {
    return streamingTextRef.current;
  }, []);

  const stop = useCallback((reason: ABORT_REASON = ABORT_REASON.USER_STOPPED): void => {
    abortControllerRef.current?.abort(reason);
  }, []);

  const reset = useCallback((): void => {
    abortControllerRef.current?.abort(ABORT_REASON.NEW_CHAT);
    abortControllerRef.current = null;

    chainRef.current = null;
    currentModelKeyRef.current = null;
    currentSystemPromptRef.current = null;

    memoryRef.current = createChatMemory();
    hasSavedContextOnceRef.current = false;

    turnIdRef.current += 1;

    streamingTextRef.current = "";
    isStreamingRef.current = false;

    if (isMountedRef.current) {
      setStreamingText("");
      setStreamingTextThrottled("");
      setIsStreaming(false);
    }
  }, [setStreamingTextThrottled]);

  const runTurn = useCallback(
    async (
      getPrompt: (ctx: StreamingChatTurnContext) => Promise<string>
    ): Promise<string | null> => {
      if (isStreamingRef.current) return null;

      isStreamingRef.current = true;
      if (isMountedRef.current) setIsStreaming(true);

      const currentTurnId = ++turnIdRef.current;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      streamingTextRef.current = "";
      if (isMountedRef.current) {
        setStreamingText("");
        setStreamingTextThrottled("");
      }

      const turnScopedDelta = (text: string): void => {
        if (turnIdRef.current !== currentTurnId) return;
        handleDelta(text);
      };

      const thinkStreamer = new ThinkBlockStreamer(turnScopedDelta, excludeThinking);

      let didNonAbortError = false;
      let chain: ChatChain | null = null;
      let prompt = "";
      let committed: string | null = null;
      let stopReason: "stop" | "length" = "stop";

      try {
        const isFirstTurn = !hasSavedContextOnceRef.current;

        if (!model) {
          onNoModelRef.current?.();
          return null;
        }

        prompt = await getPrompt({ signal: abortController.signal, isFirstTurn });
        if (abortController.signal.aborted) return null;

        if (!prompt.trim()) return null;

        const chainAndMemory = await getOrCreateChain(abortController.signal);
        if (!chainAndMemory) return null;

        chain = chainAndMemory.chain;
        const providerSession = getProviderSessionOptions(model, chainAndMemory.memory.chatHistory);
        const stream = chain.stream(prompt, {
          signal: abortController.signal,
          headers: providerSession?.options.headers,
        });

        for await (const event of stream) {
          if (event.type === "text_delta") thinkStreamer.processChunk({ content: event.delta });
          else if (event.type === "thinking_delta")
            thinkStreamer.processChunk({
              content: [{ type: "thinking", thinking: event.delta }],
            });
          // 达到输出上限仍要保留已生成内容，但不能把终态改写成自然完成。https://github.com/ItsDalk-Lane/Scribe/issues/64
          if (event.type === "done" && event.message.stopReason === "length") stopReason = "length";
          if (abortController.signal.aborted) break;
        }
      } catch (error) {
        // 供应商内部中止不能冒充用户停止，否则失败提示和重试入口都会丢失。https://github.com/ItsDalk-Lane/Scribe/issues/58
        const isAbort = abortController.signal.aborted;

        if (!isAbort) {
          didNonAbortError = true;
          onNonAbortErrorRef.current?.(error);
        }
      } finally {
        const result = thinkStreamer.close().content.trim();

        const shouldSkip = shouldSkipPersistOnAbort(abortController.signal);
        const isStale = turnIdRef.current !== currentTurnId;

        if (!didNonAbortError && result && !shouldSkip && !isStale) {
          committed = result;

          if (chain) {
            try {
              const compactedResult = compactAssistantOutput(result);
              chain.saveContext(
                prompt,
                typeof compactedResult === "string" ? compactedResult : result,
                stopReason
              );
              hasSavedContextOnceRef.current = true;
            } catch (error) {
              logError("Error saving chat context:", error);
            }
          }
        }

        if (
          !didNonAbortError &&
          !isStale &&
          !abortController.signal.aborted &&
          stopReason === "length"
        )
          onTruncatedRef.current?.();

        if (!isStale) {
          streamingTextRef.current = "";
          isStreamingRef.current = false;
        }

        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }

        if (isMountedRef.current && !isStale) {
          setStreamingText("");
          setStreamingTextThrottled("");
          setIsStreaming(false);
        }
      }

      return committed;
    },
    [excludeThinking, getOrCreateChain, handleDelta, model, setStreamingTextThrottled]
  );

  return {
    isStreaming,
    streamingText,
    getIsFirstTurn,
    runTurn,
    stop,
    reset,
    getMemory,
    getLatestStreamingText,
  };
}
