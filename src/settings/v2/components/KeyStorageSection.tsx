import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { t } from "@/lib/i18n";
import { Info, Trash2 } from "lucide-react";
import React from "react";

export interface KeyStorageSectionProps {
  keychainAvailable: boolean;
  forgetting: boolean;
  onForget: React.MouseEventHandler<HTMLButtonElement>;
}

export function KeyStorageSection({
  keychainAvailable,
  forgetting,
  onForget,
}: KeyStorageSectionProps) {
  return (
    <SettingSection>
      <SettingItem
        type="custom"
        title={t("API key storage")}
        description={
          keychainAvailable
            ? t(
                "Scribe uses this device’s Obsidian Keychain for API keys. Each device has its own Keychain. To check or change a key, open the relevant provider in Models and providers."
              )
            : t(
                "Obsidian Keychain is unavailable in this Obsidian session. Check your Obsidian version or use a device where it is available."
              )
        }
      >
        <div className="tw-flex tw-flex-col tw-items-start tw-gap-2 sm:tw-items-end">
          <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-muted">
            <Info className="tw-size-4" />
            {t(keychainAvailable ? "Obsidian Keychain" : "Unavailable")}
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={onForget}
            disabled={forgetting || !keychainAvailable}
            title={
              keychainAvailable
                ? undefined
                : t("Keychain is unavailable. Check your Obsidian version or use another device.")
            }
            className="tw-gap-1.5"
          >
            <Trash2 className="tw-size-4" />
            {forgetting ? t("Removing...") : t("Delete All Keys")}
          </Button>
        </div>
      </SettingItem>
    </SettingSection>
  );
}
