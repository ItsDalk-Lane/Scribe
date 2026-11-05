import { t } from "@/lib/i18n";
import { TabContent, TabItem, type TabItem as TabItemType } from "@/components/ui/setting-tabs";
import { PluginProvider } from "@/contexts/PluginContext";
import { TabProvider, useTab } from "@/contexts/TabContext";
import ScribePlugin from "@/main";
import { ModelManagementProvider } from "@/modelManagement";
import { SCRIBE_SETTINGS_TAB_IDS, type ScribeSettingsTabId } from "@/settings/settingsTabs";
import { useSkillLoadErrorCount } from "@/settings/skillLoadErrorState";
import React from "react";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { AboutSettingsPanel } from "./components/AboutSettingsPanel";
import { BasicSettings } from "./components/BasicSettings";
import { ModelsAndProvidersPanel } from "@/modelManagement";
import { CommandSettings } from "./components/CommandSettings";
import { DesktopOnlySettingsPanel } from "./components/DesktopOnlySettingsPanel";

const LazyExtensionsSettings = React.lazy(() =>
  import("@/agentMode").then((module) => ({ default: module.AgentExtensionsSettings }))
);

interface ExtensionsSettingsPanelProps {
  kind: "skill" | "command" | "subagent";
}

const ExtensionsSettingsPanel: React.FC<ExtensionsSettingsPanelProps> = ({ kind }) => {
  if (!isDesktopRuntime())
    return <DesktopOnlySettingsPanel message={t("Agent extensions are available on desktop.")} />;
  return (
    <React.Suspense fallback={null}>
      <LazyExtensionsSettings kind={kind} />
    </React.Suspense>
  );
};

const components: Record<ScribeSettingsTabId, React.FC> = {
  basic: BasicSettings,
  about: AboutSettingsPanel,
  quickActions: ModelsAndProvidersPanel,
  myCommands: CommandSettings,
  command: () => <ExtensionsSettingsPanel kind="command" />,
  skills: () => <ExtensionsSettingsPanel kind="skill" />,
  subagents: () => <ExtensionsSettingsPanel kind="subagent" />,
};

const TAB_LABELS: Record<ScribeSettingsTabId, string> = {
  basic: "Agent configuration",
  quickActions: "Models",
  myCommands: "My commands",
  command: "Commands",
  skills: "Skills",
  subagents: "Subagents",
  about: "About",
};

const tabs = SCRIBE_SETTINGS_TAB_IDS.map((id) => ({
  id,
  icon: null,
  label: TAB_LABELS[id],
})) satisfies TabItemType[];

const SettingsContent: React.FC = () => {
  const { selectedTab, setSelectedTab } = useTab();
  const skillLoadErrorCount = useSkillLoadErrorCount();

  return (
    <div className="tw-flex tw-flex-col">
      <div role="tablist" aria-label={t("Settings")} className="tw-flex tw-flex-wrap tw-gap-0.5">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={{
              ...tab,
              label: t(tab.label),
              warningLabel:
                tab.id === "skills" && skillLoadErrorCount > 0
                  ? t("Some skills failed to load")
                  : undefined,
            }}
            isSelected={selectedTab === tab.id}
            onClick={() => setSelectedTab(tab.id)}
          />
        ))}
      </div>
      <div className="tw-w-full tw-border-0 tw-border-t tw-border-solid tw-border-border" />

      <div>
        {SCRIBE_SETTINGS_TAB_IDS.map((id) => {
          const Component = components[id];
          return (
            <TabContent key={id} id={id} isSelected={selectedTab === id}>
              <Component />
            </TabContent>
          );
        })}
      </div>
    </div>
  );
};

interface SettingsMainV2Props {
  plugin: ScribePlugin;
  initialTab?: ScribeSettingsTabId;
}

const SettingsMainV2: React.FC<SettingsMainV2Props> = ({ plugin, initialTab = "basic" }) => {
  React.useEffect(() => {
    void plugin.skills?.refresh();
  }, [plugin]);

  return (
    <PluginProvider plugin={plugin}>
      <ModelManagementProvider api={plugin.modelManagement}>
        <TabProvider initialTab={initialTab}>
          <div className="tw-group/settings tw-mx-auto tw-max-w-[860px] tw-text-normal">
            <SettingsContent />
          </div>
        </TabProvider>
      </ModelManagementProvider>
    </PluginProvider>
  );
};

export default SettingsMainV2;
