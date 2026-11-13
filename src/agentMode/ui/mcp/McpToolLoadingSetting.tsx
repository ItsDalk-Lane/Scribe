import { t } from "@/lib/i18n";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  DEFAULT_MCP_TOOL_LOADING_THRESHOLD_CHARS,
  type McpToolLoadingMode,
} from "@/agentMode/mcp/toolLoadingPolicy";
import React, { useState } from "react";

const LOADING_MODES: readonly McpToolLoadingMode[] = Object.freeze(["auto", "always", "off"]);

const MODE_LABELS: Record<McpToolLoadingMode, string> = {
  auto: "Auto",
  always: "Always deferred",
  off: "Off",
};

const MODE_HINTS: Record<McpToolLoadingMode, string> = {
  auto: "Small setups register confirmed non-search tools directly; large catalogs use tool search.",
  always: "Confirmed non-search tools are listed in the catalog and registered on demand.",
  off: "All enabled and confirmed non-search tools are registered directly.",
};

export interface McpToolLoadingSettingProps {
  mode: McpToolLoadingMode;
  thresholdChars?: number;
  disabled?: boolean;
  onModeChange: (mode: McpToolLoadingMode) => void;
  onThresholdChange: (chars: number) => void;
}

export const McpToolLoadingSetting: React.FC<McpToolLoadingSettingProps> = ({
  mode,
  thresholdChars,
  disabled,
  onModeChange,
  onThresholdChange,
}) => {
  // 输入保持本地草稿，只有合法数值才上抛，避免输入中途覆盖已保存阈值。https://github.com/ItsDalk-Lane/Scribe/issues/65
  const [thresholdDraft, setThresholdDraft] = useState<string>(() =>
    String(thresholdChars ?? DEFAULT_MCP_TOOL_LOADING_THRESHOLD_CHARS)
  );

  const changeThreshold = (raw: string): void => {
    setThresholdDraft(raw);
    const parsed = Number(raw);
    if (raw.trim() === "" || !Number.isSafeInteger(parsed) || parsed <= 0) return;
    onThresholdChange(parsed);
  };

  return (
    <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
        <span className="tw-text-sm tw-text-normal">{t("MCP tool loading")}</span>
        <HelpTooltip content={t(MODE_HINTS[mode])} />
        {mode === "auto" && (
          <label className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted">
            <span>
              {t("Threshold (characters, default {default}):", {
                default: DEFAULT_MCP_TOOL_LOADING_THRESHOLD_CHARS,
              })}
            </span>
            <input
              type="number"
              min={1}
              step={1}
              disabled={disabled}
              value={thresholdDraft}
              onChange={(event) => changeThreshold(event.target.value)}
              className="tw-w-24 tw-rounded tw-border tw-border-solid tw-border-border tw-bg-transparent tw-px-2 tw-py-1 tw-text-xs tw-text-normal"
              aria-label={t("Deferral threshold in characters")}
            />
          </label>
        )}
      </div>
      <SegmentedControl
        aria-label={t("MCP tool loading")}
        value={mode}
        disabled={disabled}
        options={LOADING_MODES.map((value) => ({ value, label: t(MODE_LABELS[value]) }))}
        onChange={onModeChange}
      />
    </div>
  );
};
