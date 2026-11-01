import { t } from "@/lib/i18n";
import { TabContent, TabItem, type TabItem as TabItemType } from "@/components/ui/setting-tabs";
import { PluginProvider } from "@/contexts/PluginContext";
import { TabProvider, useTab } from "@/contexts/TabContext";
import CopilotPlugin from "@/main";
import { ModelManagementProvider } from "@/modelManagement";
import { COPILOT_SETTINGS_TAB_IDS, type CopilotSettingsTabId } from "@/settings/settingsTabs";
import { useSkillLoadErrorCount } from "@/settings/skillLoadErrorState";
import React from "react";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { GeneralSettings } from "./components/GeneralSettings";
import { QuickActionsSettings } from "./components/QuickActionsSettings";
import { DesktopOnlySettingsPanel } from "./components/DesktopOnlySettingsPanel";

const LazyAgentSettings = React.lazy(() =>
  import("@/settings/v2/components/AgentSettings").then((module) => ({
    default: module.AgentSettings,
  }))
);

const LazyExtensionsSettings = React.lazy(() =>
  import("@/agentMode").then((module) => ({ default: module.AgentExtensionsSettings }))
);

interface ExtensionsSettingsPanelProps {
  kind: "plugin" | "skill" | "command" | "hook" | "mcp" | "subagent";
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

const AgentSettingsPanel: React.FC = () => {
  if (!isDesktopRuntime()) {
    return <DesktopOnlySettingsPanel message={t("Agent settings are available on desktop.")} />;
  }
  return (
    <React.Suspense fallback={null}>
      <LazyAgentSettings />
    </React.Suspense>
  );
};

const components: Record<CopilotSettingsTabId, React.FC> = {
  basic: GeneralSettings,
  quickActions: QuickActionsSettings,
  agents: AgentSettingsPanel,
  plugins: () => <ExtensionsSettingsPanel kind="plugin" />,
  command: () => <ExtensionsSettingsPanel kind="command" />,
  skills: () => <ExtensionsSettingsPanel kind="skill" />,
  hooks: () => <ExtensionsSettingsPanel kind="hook" />,
  mcp: () => <ExtensionsSettingsPanel kind="mcp" />,
  subagents: () => <ExtensionsSettingsPanel kind="subagent" />,
};

const TAB_LABELS: Record<CopilotSettingsTabId, string> = {
  basic: "Common",
  quickActions: "Quick actions",
  agents: "Agents",
  plugins: "Plugins",
  command: "Commands",
  skills: "Skills",
  hooks: "Hooks",
  mcp: "MCP",
  subagents: "Subagents",
};

const tabs = COPILOT_SETTINGS_TAB_IDS.map((id) => ({
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
              // https://github.com/Brevilabs/obsidian-copilot-private/issues/166
              // The tab strip stays mounted while inactive panels do not, so
              // load failures remain visible from every settings section.
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
        {COPILOT_SETTINGS_TAB_IDS.map((id) => {
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
  plugin: CopilotPlugin;
  initialTab?: CopilotSettingsTabId;
}

const SettingsMainV2: React.FC<SettingsMainV2Props> = ({ plugin, initialTab = "basic" }) => {
  React.useEffect(() => {
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/166
    // Agent repairs can change hidden files while the window stays focused and
    // the Skills panel is unmounted. Refresh when Settings next opens so its tab
    // marker never depends on visiting the Skills panel first.
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
