import React from "react";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";
import { t } from "@/lib/i18n";

export interface AgentStepLimitSettingProps {
  maxSteps?: number;
  onChange: (maxSteps: number | undefined) => void;
}

export function AgentStepLimitSetting({ maxSteps, onChange }: AgentStepLimitSettingProps) {
  // 未保存上限明确显示无限制；只有用户主动选择限制时才提供数值。https://github.com/ItsDalk-Lane/Scribe/issues/31
  return (
    <>
      <SettingItem
        type="select"
        title={t("Maximum steps per turn")}
        description={t(
          "A limited turn ends with a summary of completed work. Unlimited is the default."
        )}
        value={maxSteps === undefined ? "unlimited" : "limited"}
        options={[
          { value: "unlimited", label: t("Unlimited") },
          { value: "limited", label: t("Set a step limit") },
        ]}
        onChange={(value) => onChange(value === "unlimited" ? undefined : 50)}
      />
      {maxSteps !== undefined && (
        <SettingItem
          type="custom"
          title={t("Step limit")}
          description={t(
            "Enter a positive whole number. Clearing this field does not select Unlimited."
          )}
        >
          <Input
            type="number"
            min={1}
            step={1}
            aria-label={t("Step limit")}
            defaultValue={maxSteps}
            className="tw-w-full sm:tw-w-[200px]"
            onChange={(event) => {
              const next = Number(event.target.value);
              // 即时保存正整数，避免延迟回调在用户选择无限制后重新加回上限。https://github.com/ItsDalk-Lane/Scribe/issues/31
              if (Number.isSafeInteger(next) && next > 0) onChange(next);
            }}
          />
        </SettingItem>
      )}
    </>
  );
}
