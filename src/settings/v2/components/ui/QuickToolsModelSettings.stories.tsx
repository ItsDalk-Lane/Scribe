import { ModelEnableList, type ModelEnableGroup } from "@/components/ui/ModelEnableList";
import { t } from "@/lib/i18n";
import type { Meta, StoryObj } from "@/lib/story";
import { QuickToolsModelSettings } from "./QuickToolsModelSettings";
import React from "react";

interface QuickToolsModelSettingsStoryProps {
  empty: boolean;
}

const OPTIONS = [{ label: "GPT-4.1", value: "gpt-4.1" }];
const EMPTY_OPTIONS: typeof OPTIONS = [];
const GROUPS: ModelEnableGroup[] = [
  {
    key: "byok",
    label: "OpenAI",
    badge: "BYOK",
    rows: [
      { id: "gpt-4.1", label: "GPT-4.1", enabled: true },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini", enabled: false },
    ],
  },
];
const EMPTY_GROUPS: ModelEnableGroup[] = [];

function QuickToolsModelSettingsStory({ empty }: QuickToolsModelSettingsStoryProps) {
  return (
    <QuickToolsModelSettings
      defaultModelId={empty ? undefined : "gpt-4.1"}
      options={empty ? EMPTY_OPTIONS : OPTIONS}
      onDefaultModelChange={() => undefined}
    >
      <ModelEnableList
        groups={empty ? EMPTY_GROUPS : GROUPS}
        onToggle={() => undefined}
        query=""
        onQueryChange={() => undefined}
        searchPlaceholder={t("Search quick-tool models…")}
        emptyState={
          <span>
            {t("No models yet. Add a provider on the ")}
            <span className="tw-font-medium">{t("Models")}</span>{" "}
            {t(" tab to use it in Quick tools.")}
          </span>
        }
      />
    </QuickToolsModelSettings>
  );
}

const meta = {
  title: "Settings/Quick tools models",
  component: QuickToolsModelSettingsStory,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<QuickToolsModelSettingsStoryProps>;
export default meta;

export const Configured: StoryObj<QuickToolsModelSettingsStoryProps> = { args: { empty: false } };
export const Empty: StoryObj<QuickToolsModelSettingsStoryProps> = { args: { empty: true } };
