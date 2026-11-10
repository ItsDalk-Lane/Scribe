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
  group?: string;
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
        group: entry.provider.displayName,
      });
    }
    // 原生下拉按相邻同名分组渲染，先按供应商排序保证组内连续。https://github.com/ItsDalk-Lane/Scribe/issues/69
    result.sort((a, b) => {
      const aGroup = a.group ?? "";
      const bGroup = b.group ?? "";
      return aGroup === bGroup ? 0 : aGroup < bGroup ? -1 : 1;
    });
    return result;
  }, [entries]);

  const resolveSelectionId = useCallback(
    (selection: string | undefined) =>
      resolveChatModelSelectionId(entries, selection, fallbackToFirst),
    [entries, fallbackToFirst]
  );

  return { options, resolveSelectionId };
}
