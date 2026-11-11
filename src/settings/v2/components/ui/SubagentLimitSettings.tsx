import React from "react";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";
import { t } from "@/lib/i18n";

export interface SubagentLimitSettingsProps {
  values: { maxConcurrent: number; maxQueued: number; maxTaskRequests: number };
  onChange: (values: SubagentLimitSettingsProps["values"]) => void;
}

const FIELDS = [
  { key: "maxConcurrent", title: "Concurrent subagents", min: 1 },
  { key: "maxQueued", title: "Queued subagents", min: 0 },
  { key: "maxTaskRequests", title: "Model requests per task", min: 1 },
] as const;

export function SubagentLimitSettings({ values, onChange }: SubagentLimitSettingsProps) {
  return (
    <>
      {FIELDS.map(({ key, title, min }) => (
        <SettingItem
          key={key}
          type="custom"
          title={t(title)}
          description={t(
            key === "maxTaskRequests"
              ? "Counts model requests from the main chat and its subagents, including retries and compaction. Reaching the limit preserves progress and stops new requests."
              : "Shared by all chats in this vault. Waiting for approval or input still uses an active slot."
          )}
        >
          <Input
            type="number"
            min={min}
            step={1}
            aria-label={t(title)}
            defaultValue={values[key]}
            className="tw-w-full sm:tw-w-[200px]"
            onChange={(event) => {
              const value = Number(event.target.value);
              // 清空或无效输入保留已保存的运行保护，避免意外取消限制。https://github.com/ItsDalk-Lane/Scribe/issues/50
              if (event.target.value !== "" && Number.isSafeInteger(value) && value >= min)
                onChange({ ...values, [key]: value });
            }}
          />
        </SettingItem>
      ))}
    </>
  );
}
