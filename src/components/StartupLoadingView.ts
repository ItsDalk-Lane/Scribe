import { t } from "@/lib/i18n";
import { logError } from "@/logger";
import { ItemView, type View, type WorkspaceLeaf } from "obsidian";

export const STARTUP_LOADING_TEXT = "Starting Scribe…";

export interface ScribeStartup {
  whenStarted(): Promise<void>;
  createStartedView(viewType: string, leaf: WorkspaceLeaf): View | undefined;
}

export class StartupLoadingView extends ItemView {
  private savedState: Record<string, unknown> = {};

  constructor(
    leaf: WorkspaceLeaf,
    private readonly viewType: string,
    private readonly startup: ScribeStartup
  ) {
    super(leaf);
  }

  getViewType(): string {
    return this.viewType;
  }

  getDisplayText(): string {
    return "Scribe";
  }

  getIcon(): string {
    return "message-square";
  }

  getState(): Record<string, unknown> {
    return this.savedState;
  }

  async setState(state: Record<string, unknown>): Promise<void> {
    this.savedState = state;
  }

  async onOpen(): Promise<void> {
    this.contentEl.createDiv({
      cls: "tw-flex tw-size-full tw-items-center tw-justify-center tw-text-muted",
      text: t(STARTUP_LOADING_TEXT),
    });
    void this.replaceOnceStarted().catch((error) => {
      logError("Scribe could not open a tab restored during startup.", error);
    });
  }

  private async replaceOnceStarted(): Promise<void> {
    await this.startup.whenStarted();
    if (this.leaf.view !== this) return;
    const view = this.startup.createStartedView(this.viewType, this.leaf);
    if (!view) return;
    await this.leaf.open(view);
    await view.setState(this.savedState, { history: false });
  }
}
