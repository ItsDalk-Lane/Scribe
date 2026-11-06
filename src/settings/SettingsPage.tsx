import { t } from "@/lib/i18n";
import { STARTUP_LOADING_TEXT } from "@/components/StartupLoadingView";
import ScribePlugin from "@/main";
import { consumeRequestedScribeSettingsTab } from "@/settings/openSettings";
import { App, PluginSettingTab } from "obsidian";
import React from "react";
import type { Root } from "react-dom/client";
import SettingsMainV2 from "@/settings/v2/SettingsMainV2";
import { createPluginRoot } from "@/utils/react/createPluginRoot";

export class ScribeSettingTab extends PluginSettingTab {
  plugin: ScribePlugin;
  private root: Root | null = null;
  private displayGeneration = 0;
  private disposed = false;

  constructor(app: App, plugin: ScribePlugin) {
    super(app, plugin);
    this.plugin = plugin;
    plugin.register(() => {
      this.disposed = true;
      this.hide();
    });
  }

  getSettingDefinitions(): never[] {
    return [];
  }

  display(): void {
    this.hide();
    if (this.disposed) return;
    const generation = this.displayGeneration;
    const { containerEl } = this;
    if (!this.plugin.isStarted()) {
      containerEl.createDiv({
        cls: "tw-flex tw-items-center tw-justify-center tw-p-8 tw-text-muted",
        text: t(STARTUP_LOADING_TEXT),
      });
      void this.plugin.whenStarted().then(() => {
        if (
          !this.disposed &&
          generation === this.displayGeneration &&
          this.plugin.isStarted() &&
          containerEl.isConnected
        )
          this.display();
      });
      return;
    }
    containerEl.addClass("tw-select-text");
    const div = containerEl.createDiv("div");
    this.root = createPluginRoot(div, this.app);

    this.root.render(
      <SettingsMainV2 plugin={this.plugin} initialTab={consumeRequestedScribeSettingsTab()} />
    );
  }

  hide(): void {
    this.displayGeneration++;
    const root = this.root;
    this.root = null;
    root?.unmount();
    this.containerEl.empty();
  }
}
