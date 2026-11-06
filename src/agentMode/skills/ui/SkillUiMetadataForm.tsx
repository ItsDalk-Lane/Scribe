import React from "react";
import type { Skill } from "@/agentMode/skills/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingDisclosure } from "@/components/ui/setting-disclosure";
import { SettingItem } from "@/components/ui/setting-item";
import { t } from "@/lib/i18n";

export interface SkillUiMetadataFormProps {
  skill: Skill;
  disabled?: boolean;
  onSaveUiMetadata: (patch: {
    displayName?: string;
    shortDescription?: string;
    icon?: string;
    brandColor?: string;
    defaultPrompt?: string;
  }) => Promise<void>;
}

// 界面元数据编辑走字段级精确改写通道，不触碰其余元数据原文。
// https://github.com/ItsDalk-Lane/Scribe/issues/47
export function SkillUiMetadataForm({
  skill,
  disabled,
  onSaveUiMetadata,
}: SkillUiMetadataFormProps) {
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [values, setValues] = React.useState({
    displayName: skill.uiMetadata?.displayName ?? "",
    shortDescription: skill.uiMetadata?.shortDescription ?? "",
    icon: skill.uiMetadata?.icon ?? "",
    brandColor: skill.uiMetadata?.brandColor ?? "",
    defaultPrompt: skill.uiMetadata?.defaultPrompt ?? "",
  });
  React.useEffect(() => {
    setValues({
      displayName: skill.uiMetadata?.displayName ?? "",
      shortDescription: skill.uiMetadata?.shortDescription ?? "",
      icon: skill.uiMetadata?.icon ?? "",
      brandColor: skill.uiMetadata?.brandColor ?? "",
      defaultPrompt: skill.uiMetadata?.defaultPrompt ?? "",
    });
  }, [skill.uiMetadata]);
  const field = (key: keyof typeof values, label: string) => (
    <SettingItem type="custom" title={label}>
      <Input
        aria-label={label}
        value={values[key]}
        disabled={disabled || saving}
        className="tw-w-full sm:tw-w-[260px]"
        onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
      />
    </SettingItem>
  );
  return (
    <div>
      <SettingDisclosure
        open={open}
        label={t("Interface metadata")}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="tw-space-y-2">
          {field("displayName", t("Display name"))}
          {field("shortDescription", t("Short description"))}
          {field("icon", t("Icon file (inside the skill folder)"))}
          {field("brandColor", t("Brand color (#RRGGBB)"))}
          {field("defaultPrompt", t("Default prompt for Use now"))}
          {error && (
            <p role="alert" className="tw-text-ui-small tw-text-error">
              {error}
            </p>
          )}
          <Button
            disabled={disabled || saving}
            onClick={() => {
              setSaving(true);
              setError(undefined);
              onSaveUiMetadata({
                displayName: values.displayName.trim() || undefined,
                shortDescription: values.shortDescription.trim() || undefined,
                icon: values.icon.trim() || undefined,
                brandColor: values.brandColor.trim() || undefined,
                defaultPrompt: values.defaultPrompt.trim() || undefined,
              })
                .catch((failure: unknown) =>
                  setError(failure instanceof Error ? failure.message : String(failure))
                )
                .finally(() => setSaving(false));
            }}
          >
            {t("Save interface metadata")}
          </Button>
        </div>
      )}
    </div>
  );
}
