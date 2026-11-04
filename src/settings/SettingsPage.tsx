import { t } from "@/lib/i18n";
import { STARTUP_LOADING_TEXT } from "@/components/StartupLoadingView";
import ScribePlugin from "@/main";
import { consumeRequestedScribeSettingsTab } from "@/settings/openSettings";
import { App, PluginSettingTab } from "obsidian";
import React from "react";
import SettingsMainV2 from "@/settings/v2/SettingsMainV2";
import { createPluginRoot } from "@/utils/react/createPluginRoot";

export class ScribeSettingTab extends PluginSettingTab {
  plugin: ScribePlugin;

  constructor(app: App, plugin: ScribePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): never[] {
    return [];
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    if (!this.plugin.isStarted()) {
      containerEl.createDiv({
        cls: "tw-flex tw-items-center tw-justify-center tw-p-8 tw-text-muted",
        text: t(STARTUP_LOADING_TEXT),
      });
      void this.plugin.whenStarted().then(() => {
        if (this.plugin.isStarted() && containerEl.isConnected) this.display();
      });
      return;
    }
    containerEl.addClass("tw-select-text");
    const div = containerEl.createDiv("div");
    const sections = createPluginRoot(div, this.app);

    sections.render(
      <SettingsMainV2 plugin={this.plugin} initialTab={consumeRequestedScribeSettingsTab()} />
    );
  }
}
