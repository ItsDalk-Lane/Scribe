import { TabContent, TabItem } from "@/components/ui/setting-tabs";
import { t } from "@/lib/i18n";
import React from "react";

export const QUICK_ACTIONS_SECTIONS = [
  { id: "models", label: "Models and providers" },
  { id: "tools", label: "Tool configuration" },
  { id: "commands", label: "My commands" },
] as const;

export type QuickActionsSection = (typeof QUICK_ACTIONS_SECTIONS)[number]["id"];

interface QuickActionsTabsProps {
  section: QuickActionsSection;
  onSectionChange: (section: QuickActionsSection) => void;
  children: React.ReactNode;
}

export const QuickActionsTabs: React.FC<QuickActionsTabsProps> = ({
  section,
  onSectionChange,
  children,
}) => (
  <div>
    <div
      role="tablist"
      aria-label={t("Quick actions settings")}
      className="tw-flex tw-flex-wrap tw-gap-0.5 tw-border-0 tw-border-b tw-border-solid tw-border-border"
    >
      {QUICK_ACTIONS_SECTIONS.map((item) => (
        <TabItem
          key={item.id}
          tab={{ id: `quick-actions-${item.id}`, label: t(item.label), icon: null }}
          isSelected={section === item.id}
          onClick={() => onSectionChange(item.id)}
          variant="inline"
        />
      ))}
    </div>
    <TabContent id={`quick-actions-${section}`} isSelected variant="inline">
      {children}
    </TabContent>
  </div>
);
