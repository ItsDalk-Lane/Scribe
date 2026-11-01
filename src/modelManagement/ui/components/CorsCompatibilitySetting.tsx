import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import React from "react";

export interface CorsCompatibilitySettingProps {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export const CORS_COMPATIBILITY_TOOLTIP =
  "Some Quick tools models require CORS compatibility to connect. When enabled, responses appear only after they finish instead of streaming token by token.";

export const CorsCompatibilitySetting: React.FC<CorsCompatibilitySettingProps> = ({
  checked,
  onCheckedChange,
  disabled,
}) => (
  <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
    <div className="tw-inline-flex tw-items-center tw-gap-1">
      <span className="tw-text-sm tw-font-medium tw-text-normal">{t("Enable CORS")}</span>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("About Quick tools CORS compatibility")}
              className="tw-size-6 tw-p-0 tw-text-muted hover:tw-bg-transparent hover:tw-text-normal"
            >
              <Info className="tw-size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="tw-w-72">
            {t(CORS_COMPATIBILITY_TOOLTIP)}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
    <SettingSwitch
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      aria-label={t("Enable CORS")}
    />
  </div>
);
