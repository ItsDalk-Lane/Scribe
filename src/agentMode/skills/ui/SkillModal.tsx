import type { App } from "obsidian";
import type React from "react";
import { ReactModal } from "@/components/modals/ReactModal";

export class SkillModal extends ReactModal {
  constructor(
    app: App,
    title: string,
    private readonly content: (close: () => void) => React.ReactElement,
    private readonly onClosed?: () => void
  ) {
    super(app, title);
  }

  protected renderContent(close: () => void): React.ReactElement {
    return this.content(close);
  }

  onClose(): void {
    super.onClose();
    this.onClosed?.();
  }
}
