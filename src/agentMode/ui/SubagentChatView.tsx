import { t } from "@/lib/i18n";
import { getSettings, type ScribeSettings } from "@/settings/model";
import { CHAT_AGENT_VIEWTYPE, SUBAGENT_CHAT_VIEW_TYPE } from "@/constants";
import { ChatViewEventTarget, EventTargetContext } from "@/context";
import { DraggableModal } from "@/components/command-ui/draggable-modal";
import { Button } from "@/components/ui/button";
import { SubagentChatPanel } from "@/agentMode/ui/SubagentChatPanel";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import * as Tooltip from "@radix-ui/react-tooltip";
import { App, ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { Root } from "react-dom/client";
import type ScribePlugin from "@/main";

export interface SubagentChatViewState {
  parentSessionId: string;
  subagentId: string;
}

export type SubagentChatOpenArea = NonNullable<ScribeSettings["agentMode"]["subagentChatOpenArea"]>;

const SubagentChatContent: React.FC<{
  plugin: ScribePlugin;
  state: SubagentChatViewState;
  onBack: () => void;
}> = ({ plugin, state, onBack }) => {
  const manager = plugin.agentSessionManager;
  const parentBackend = manager?.getChatUIState(state.parentSessionId) ?? null;
  if (!manager || !parentBackend) {
    return (
      <div className="tw-flex tw-size-full tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-p-6">
        <p className="tw-m-0 tw-text-sm tw-text-muted">
          {t("The parent chat of this child session is closed.")}
        </p>
        <Button variant="secondary" size="fit" onClick={onBack}>
          {t("Back to chat")}
        </Button>
      </div>
    );
  }
  return (
    <SubagentChatPanel
      app={plugin.app}
      plugin={plugin}
      manager={manager}
      parentBackend={parentBackend}
      subagentId={state.subagentId}
      onBack={onBack}
    />
  );
};

export class SubagentChatView extends ItemView {
  private root: Root | null = null;
  private state: SubagentChatViewState | null = null;
  private readonly eventTarget = new ChatViewEventTarget();

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: ScribePlugin
  ) {
    super(leaf);
    this.app = plugin.app;
  }

  getViewType(): string {
    return SUBAGENT_CHAT_VIEW_TYPE;
  }

  getIcon(): string {
    return "bot";
  }

  getDisplayText(): string {
    return t("Subagent chat");
  }

  getState(): Record<string, unknown> {
    return {};
  }

  async setState(state: SubagentChatViewState): Promise<void> {
    if (!state?.subagentId) return;
    this.state = state;
    this.renderRoot();
  }

  async onOpen(): Promise<void> {
    this.renderRoot();
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }

  private renderRoot(): void {
    if (!this.state) return;
    const contentEl = this.containerEl.children[1];
    if (!this.root) {
      contentEl.empty();
      const rootEl = contentEl.createDiv();
      this.root = createPluginRoot(rootEl, this.app);
    }
    this.root.render(
      <EventTargetContext.Provider value={this.eventTarget}>
        <Tooltip.Provider delayDuration={0}>
          <SubagentChatContent
            plugin={this.plugin}
            state={this.state}
            onBack={() => closeSubagentChat(this.app)}
          />
        </Tooltip.Provider>
      </EventTargetContext.Provider>
    );
  }
}

interface FloatingSubagentChat {
  container: HTMLElement;
  root: Root;
  eventTarget: ChatViewEventTarget;
}

let floatingChat: FloatingSubagentChat | null = null;

export function closeFloatingSubagentChat(): void {
  if (!floatingChat) return;
  floatingChat.root.unmount();
  floatingChat.container.remove();
  floatingChat = null;
}

function openFloatingSubagentChat(plugin: ScribePlugin, state: SubagentChatViewState): void {
  const app = plugin.app;
  if (!floatingChat) {
    const container = document.body.createDiv("scribe-subagent-floating-host");
    floatingChat = {
      container,
      root: createPluginRoot(container, app),
      eventTarget: new ChatViewEventTarget(),
    };
  }
  const chat = floatingChat;
  const onBack = () => closeSubagentChat(app);
  chat.root.render(
    <EventTargetContext.Provider value={chat.eventTarget}>
      <Tooltip.Provider delayDuration={0}>
        <DraggableModal
          open
          onClose={onBack}
          width="min(560px, 92%)"
          resizable
          minHeight={320}
          className="tw-h-[32rem]"
        >
          <SubagentChatContent plugin={plugin} state={state} onBack={onBack} />
        </DraggableModal>
      </Tooltip.Provider>
    </EventTargetContext.Provider>
  );
}

export async function openSubagentChat(
  plugin: ScribePlugin,
  state: SubagentChatViewState
): Promise<void> {
  const app = plugin.app;
  const area: SubagentChatOpenArea = getSettings().agentMode.subagentChatOpenArea ?? "right";
  if (area === "floating") {
    closeFloatingSubagentChat();
    openFloatingSubagentChat(plugin, state);
    return;
  }
  closeFloatingSubagentChat();
  const existing = app.workspace.getLeavesOfType(SUBAGENT_CHAT_VIEW_TYPE)[0];
  if (existing) {
    await (existing.view as SubagentChatView).setState(state);
    app.workspace.revealLeaf(existing);
    return;
  }
  const leaf =
    area === "left" ? app.workspace.getLeftLeaf(false) : app.workspace.getRightLeaf(false);
  if (!leaf) return;
  await leaf.setViewState({ type: SUBAGENT_CHAT_VIEW_TYPE, active: true });
  const view = leaf.view;
  if (view instanceof SubagentChatView) await view.setState(state);
  app.workspace.revealLeaf(leaf);
}

export function closeSubagentChat(app: App): void {
  closeFloatingSubagentChat();
  for (const leaf of app.workspace.getLeavesOfType(SUBAGENT_CHAT_VIEW_TYPE)) leaf.detach();
  const mainLeaf = app.workspace.getLeavesOfType(CHAT_AGENT_VIEWTYPE)[0];
  if (mainLeaf) app.workspace.revealLeaf(mainLeaf);
}
