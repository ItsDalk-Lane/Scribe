import React from "react";
import type { App } from "obsidian";
import type CopilotPlugin from "@/main";
import { NativeSettingsForm } from "@/agentMode/backends/native/ui/NativeSettingsForm";
import { getNativeEnabledModelEntries } from "@/agentMode/backends/native/nativeModels";
import {
  updateAgentModeBackendFields,
  useSettingsValue,
  type NativeBackendSettings,
} from "@/settings/model";

const EMPTY_NATIVE_SETTINGS: NativeBackendSettings = Object.freeze({});

export function NativeSettingsPanel(_props: { plugin: CopilotPlugin; app: App }) {
  const settings = useSettingsValue();
  return (
    <NativeSettingsForm
      settings={settings.agentMode.backends.native ?? EMPTY_NATIVE_SETTINGS}
      models={getNativeEnabledModelEntries(settings)}
      onChange={(patch) => updateAgentModeBackendFields("native", patch)}
    />
  );
}
