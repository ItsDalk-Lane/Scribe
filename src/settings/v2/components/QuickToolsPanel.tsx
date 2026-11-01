import { useChatBackendModelOptions } from "@/hooks/useChatBackendModelOptions";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { ChatModelEnableList } from "@/settings/v2/components/ChatModelEnableList";
import { QuickToolsModelSettings } from "@/settings/v2/components/ui/QuickToolsModelSettings";
import React from "react";

export const QuickToolsPanel: React.FC = () => {
  const settings = useSettingsValue();
  const { options, resolveSelectionId } = useChatBackendModelOptions(false);
  return (
    <QuickToolsModelSettings
      defaultModelId={resolveSelectionId(settings.quickCommandModelKey)}
      options={options}
      onDefaultModelChange={(value) => updateSetting("quickCommandModelKey", value || undefined)}
    >
      <ChatModelEnableList />
    </QuickToolsModelSettings>
  );
};
