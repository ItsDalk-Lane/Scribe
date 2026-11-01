import { ReactModal } from "@/components/modals/ReactModal";
import { cn } from "@/lib/utils";
import type { App } from "obsidian";

const openDetails = new WeakMap<App, Map<string, AgentDetailModal>>();

export abstract class AgentDetailModal extends ReactModal {
  private reopening = false;
  constructor(
    app: App,
    readonly detailKey: string,
    title: string
  ) {
    super(app, title);
    this.modalEl.addClass(
      ...cn("tw-flex tw-h-[80vh] tw-w-[90vw] tw-max-w-5xl tw-flex-col").split(" ")
    );
    this.contentEl.addClass(
      ...cn("tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-hidden").split(" ")
    );
    this.modalEl.tabIndex = -1;
  }

  bringToFront(): void {
    const ownerWindow = this.containerEl.win;
    this.reopening = true;
    try {
      ownerWindow.focus();
      this.close();
      ownerWindow.focus();
      activeAgentDetailModal(this.app)?.modalEl.focus({ preventScroll: true });
      this.open();
    } finally {
      this.reopening = false;
    }
    this.modalEl.focus({ preventScroll: true });
  }

  onOpen(): void {
    if (!this.reopening) super.onOpen();
  }

  onClose(): void {
    if (this.reopening) return;
    try {
      super.onClose();
    } finally {
      const modals = openDetails.get(this.app);
      if (modals?.get(this.detailKey) === this) modals.delete(this.detailKey);
    }
  }
}

export function openAgentDetailModal<T extends AgentDetailModal>(
  app: App,
  key: string,
  create: () => T
): T {
  const modals = openDetails.get(app) ?? new Map<string, AgentDetailModal>();
  openDetails.set(app, modals);
  const existing = modals.get(key);
  if (existing) {
    existing.bringToFront();
    return existing as T;
  }
  const modal = create();
  modals.set(key, modal);
  try {
    modal.open();
    return modal;
  } catch (error) {
    modal.close();
    modals.delete(key);
    throw error;
  }
}

export function activeAgentDetailModal(app: App): AgentDetailModal | null {
  const modals = [...(openDetails.get(app)?.values() ?? [])];
  return (
    modals.find((modal) => {
      if (modal.containerEl.doc !== activeDocument) return false;
      const containers = modal.containerEl.doc.querySelectorAll(".modal-container");
      return containers.item(containers.length - 1) === modal.containerEl;
    }) ?? null
  );
}

export function closeAgentDetailModals(app: App): void {
  for (const modal of [...(openDetails.get(app)?.values() ?? [])].reverse()) modal.close();
}
