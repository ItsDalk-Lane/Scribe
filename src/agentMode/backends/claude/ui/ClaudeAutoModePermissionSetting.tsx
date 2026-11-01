import { t } from "@/lib/i18n";
import { SettingItem } from "@/components/ui/setting-item";
import type { ClaudeAutoModePermission } from "@/settings/model";
import React from "react";

const AUTO_MODE_OPTIONS: { label: string; value: ClaudeAutoModePermission }[] = [
  { label: "Auto", value: "auto" },
  { label: "Accept edits", value: "acceptEdits" },
  { label: "Bypass permissions", value: "bypassPermissions" },
];

export interface ClaudeAutoModePermissionSettingProps {
  value: ClaudeAutoModePermission;
  onChange: (value: ClaudeAutoModePermission) => void;
}

export const ClaudeAutoModePermissionSetting: React.FC<ClaudeAutoModePermissionSettingProps> = ({
  value,
  onChange,
}) => (
  <SettingItem
    type="select"
    title={t("Auto mode permissions")}
    description={t(
      "Auto lets Claude judge each request and still ask about risky ones, Accept edits auto-approves file edits only, and Bypass permissions skips every check."
    )}
    value={value}
    options={AUTO_MODE_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
    onChange={(next) => onChange(next as ClaudeAutoModePermission)}
  />
);
