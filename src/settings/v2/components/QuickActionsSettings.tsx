import { ModelsAndProvidersPanel } from "@/modelManagement";
import { CommandSettings } from "@/settings/v2/components/CommandSettings";
import { QuickToolsPanel } from "@/settings/v2/components/QuickToolsPanel";
import {
  QuickActionsTabs,
  type QuickActionsSection,
} from "@/settings/v2/components/ui/QuickActionsTabs";
import React, { useState } from "react";

export const QuickActionsSettings: React.FC = () => {
  const [section, setSection] = useState<QuickActionsSection>("models");

  return (
    <QuickActionsTabs section={section} onSectionChange={setSection}>
      {section === "models" ? (
        <ModelsAndProvidersPanel />
      ) : section === "tools" ? (
        <QuickToolsPanel />
      ) : (
        <CommandSettings embedded />
      )}
    </QuickActionsTabs>
  );
};
