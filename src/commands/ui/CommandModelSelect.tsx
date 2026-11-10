import { t } from "@/lib/i18n";
import { Label } from "@/components/ui/label";
import { ChevronDown } from "lucide-react";
import React from "react";

export interface CommandModelOption {
  label: string;
  value: string;
  group?: string;
}

export interface CommandModelSelectProps {
  value: string;
  options: CommandModelOption[];
  onChange: (value: string) => void;
}

export function CommandModelSelect({ value, options, onChange }: CommandModelSelectProps) {
  // optgroup 只能整段渲染，把相邻同组选项切成连续分段；无组选项保持平铺。https://github.com/ItsDalk-Lane/Scribe/issues/69
  const sections: { group?: string; options: CommandModelOption[] }[] = [];
  for (const option of options) {
    const current = sections[sections.length - 1];
    if (current && current.group === option.group) current.options.push(option);
    else sections.push({ group: option.group, options: [option] });
  }
  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <Label htmlFor="modelKey">{t("Model (optional)")}</Label>
      <div className="tw-group tw-relative tw-w-full">
        <select
          id="modelKey"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="tw-flex tw-h-9 tw-w-full tw-appearance-none tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-dropdown tw-px-3 tw-py-1 tw-pr-8 tw-text-sm tw-shadow tw-transition-colors hover:tw-bg-interactive-hover hover:tw-text-normal focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring disabled:tw-cursor-not-allowed disabled:tw-opacity-50"
        >
          <option value="">{t("Default model")}</option>
          {value && !options.some((option) => option.value === value) && (
            <option value={value} disabled>
              {value} · {t("Unavailable")}
            </option>
          )}
          {sections.map((section) => {
            const items = section.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ));
            return section.group ? (
              <optgroup key={section.group} label={section.group}>
                {items}
              </optgroup>
            ) : (
              <React.Fragment key={`ungrouped-${section.options[0]?.value ?? "empty"}`}>
                {items}
              </React.Fragment>
            );
          })}
        </select>
        <div className="tw-pointer-events-none tw-absolute tw-inset-y-0 tw-right-0 tw-flex tw-items-center tw-pr-2 tw-transition-colors group-hover:[&>svg]:tw-text-normal">
          <ChevronDown className="tw-size-4" />
        </div>
      </div>
    </div>
  );
}
