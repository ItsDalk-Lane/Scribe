import { SettingItem } from "@/components/ui/setting-item";
import { t } from "@/lib/i18n";
import React from "react";

export interface ChatAutosaveSettingProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function ChatAutosaveSetting({ checked, onCheckedChange }: ChatAutosaveSettingProps) {
  return (
    <SettingItem
      type="switch"
      className="sm:[&>div:last-child]:tw-w-auto sm:[&>div:last-child]:tw-flex-none"
      title={t("Autosave chats as Markdown")}
      description={t(
        "Automatically saves chats as notes in your vault. When off, no new automatic saves are scheduled for chats without a linked note; linked chats and already scheduled saves may still be saved. Agent chats still appear in Recent chats."
      )}
      checked={checked}
      onCheckedChange={onCheckedChange}
    />
  );
}
