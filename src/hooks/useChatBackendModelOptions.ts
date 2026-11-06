import {
  chatBackendPickerAtom,
  providerNeedsResolvedApiKey,
  resolveChatModelSelectionId,
} from "@/modelManagement";
import { SecretStore } from "@/services/secretStore";
import { settingsStore } from "@/settings/model";
import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";

export interface ChatBackendModelOption {
  label: string;
  value: string;
}

export interface ChatBackendModelOptions {
  options: ChatBackendModelOption[];
  resolveSelectionId: (selection: string | undefined) => string | undefined;
}

export function useChatBackendModelOptions(fallbackToFirst = true): ChatBackendModelOptions {
  const entries = useAtomValue(chatBackendPickerAtom, { store: settingsStore });
  const options = useMemo(() => {
    const result: ChatBackendModelOption[] = [];
    for (const entry of entries) {
      if (entry.state !== "ok") continue;
      // 上次配置留下的密钥引用可能在本机没有实际凭据，默认选择必须跳过它。https://github.com/ItsDalk-Lane/Scribe/issues/31
      if (providerNeedsResolvedApiKey(entry.provider)) {
        if (!entry.provider.apiKeyRef) continue;
        try {
          const status = SecretStore.getInstance().getStatus(entry.provider.apiKeyRef);
          if (status === "missing" || status === "unavailable") continue;
        } catch {
          continue;
        }
      }
      result.push({
        label: entry.configuredModel.info.displayName || entry.configuredModel.info.id,
        value: entry.configuredModelId,
      });
    }
    return result;
  }, [entries]);

  const resolveSelectionId = useCallback(
    (selection: string | undefined) =>
      resolveChatModelSelectionId(entries, selection, fallbackToFirst),
    [entries, fallbackToFirst]
  );

  return { options, resolveSelectionId };
}
