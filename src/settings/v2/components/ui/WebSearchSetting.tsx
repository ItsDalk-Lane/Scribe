import React from "react";
import { SettingItem } from "@/components/ui/setting-item";
import { t } from "@/lib/i18n";

interface SearchProviderOption {
  providerId: string;
  displayName: string;
}

export interface WebSearchSettingProps {
  providerId?: string;
  providers: SearchProviderOption[];
  onChange: (providerId: string | undefined) => void;
}

export function WebSearchSetting({ providerId, providers, onChange }: WebSearchSettingProps) {
  const options = [
    { label: "DuckDuckGo", value: "" },
    ...providers.map(({ providerId: id, displayName }) => ({
      label: displayName === "DeepSeek" ? displayName : `DeepSeek · ${displayName}`,
      value: id,
    })),
  ];
  if (providerId && !providers.some((provider) => provider.providerId === providerId))
    options.push({ label: t("DeepSeek (account unavailable)"), value: providerId });

  return (
    <SettingItem
      type="select"
      title={t("Web search engine")}
      description={t(
        providers.length
          ? "Choose which service receives web search queries. DeepSeek charges per successful search with results."
          : "To use DeepSeek, save an API key for the official DeepSeek provider under Models."
      )}
      value={providerId ?? ""}
      options={options}
      onChange={(value) => onChange(value || undefined)}
    />
  );
}
