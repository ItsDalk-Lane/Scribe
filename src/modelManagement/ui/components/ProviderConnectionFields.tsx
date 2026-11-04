import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { t } from "@/lib/i18n";
import type { ProviderParameter } from "@/modelManagement/providers/providerProfiles";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import { ProviderVerificationStatus } from "./ProviderVerificationStatus";
import React from "react";

export interface ProviderParameterFieldsProps {
  parameters: readonly ProviderParameter[];
  instructions?: readonly string[];
  apiFormat?: "compatible" | "native";
  onApiFormatChange?: (value: "compatible" | "native") => void;
  values: Record<string, unknown>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
}

export function ProviderParameterFields({
  parameters,
  instructions,
  apiFormat,
  onApiFormatChange,
  values,
  onChange,
  disabled,
}: ProviderParameterFieldsProps) {
  return (
    <>
      {instructions?.map((instruction) => (
        <p key={instruction} className="tw-m-0 tw-text-sm tw-text-muted">
          {t(instruction)}
        </p>
      ))}

      {apiFormat !== undefined && (
        <FormField label={t("API format")}>
          <select
            aria-label={t("API format")}
            value={apiFormat}
            disabled={disabled}
            onChange={(event) => onApiFormatChange?.(event.target.value as "compatible" | "native")}
            className="tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-2 tw-py-1 tw-text-normal"
          >
            <option value="compatible">{t("OpenAI-compatible API (recommended)")}</option>
            <option value="native">{t("Provider-native API")}</option>
          </select>
          <p className="tw-m-0 tw-text-xs tw-text-muted">
            {t("When selecting the provider-native API, enter the provider's native base URL.")}
          </p>
        </FormField>
      )}
      {parameters.map((parameter) => {
        const value = values[parameter.key];
        return (
          <FormField key={parameter.key} label={t(parameter.label)} required={parameter.required}>
            <Input
              aria-label={t(parameter.label)}
              value={typeof value === "string" ? value : (parameter.defaultValue ?? "")}
              placeholder={parameter.placeholder}
              disabled={disabled}
              onChange={(event) => onChange(parameter.key, event.target.value)}
            />
          </FormField>
        );
      })}
    </>
  );
}

export interface ProviderChatConnectionTestProps {
  models: readonly ModelInfo[];
  modelId: string;
  onModelChange: (modelId: string) => void;
  onTest: () => void;
  testing: boolean;
  result: VerificationResult | null;
  disabled?: boolean;
}

export function ProviderChatConnectionTest({
  models,
  modelId,
  onModelChange,
  onTest,
  testing,
  result,
  disabled,
}: ProviderChatConnectionTestProps) {
  return (
    <div className="tw-flex tw-flex-col tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-3">
      {models.length > 1 && (
        <FormField label={t("Test model")}>
          <select
            aria-label={t("Test model")}
            value={modelId}
            onChange={(event) => onModelChange(event.target.value)}
            disabled={disabled}
            className="tw-w-full tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-2 tw-py-1 tw-text-normal"
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName || model.id}
              </option>
            ))}
          </select>
        </FormField>
      )}
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
        <Button variant="secondary" onClick={onTest} disabled={disabled || testing || !modelId}>
          {testing ? t("Testing chat connection…") : t("Test chat connection")}
        </Button>
        {result && <ProviderVerificationStatus purpose="chat" result={result} />}
      </div>
      <p className="tw-m-0 tw-text-xs tw-text-muted">
        {models.length === 0
          ? t("Select a chat model before testing this connection.")
          : t("This sends one short message using the selected model.")}
      </p>
      {result?.ok === false && (
        <p role="status" className="tw-m-0 tw-break-words tw-text-xs tw-text-error">
          {result.message || t("Chat connection failed")}
        </p>
      )}
    </div>
  );
}
