import { getCommandId, loadAllCustomCommands } from "@/commands/customCommandUtils";
import { type App, type Editor, type Plugin } from "obsidian";
import { CustomCommandChatModal } from "@/commands/CustomCommandChatModal";
import type { CustomCommand } from "@/commands/type";
import {
  getCachedCustomCommands,
  isCustomCommandEnabled,
  subscribeToCustomCommands,
} from "@/commands/state";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { logError } from "@/logger";

export class CustomCommandRegister {
  private disposed = false;
  private readonly registeredTitles = new Set<string>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly plugin: Plugin,
    private readonly app: App
  ) {
    this.unsubscribe = subscribeToCustomCommands(() => this.registerCommands());
  }

  async initialize(): Promise<void> {
    await loadAllCustomCommands(this.app);
    this.registerCommands();
  }

  cleanup(): void {
    this.disposed = true;
    this.unsubscribe();
    for (const title of this.registeredTitles) this.removeRegisteredCommand(title);
    this.registeredTitles.clear();
  }

  private removeRegisteredCommand(title: string): void {
    (this.plugin as unknown as { removeCommand: (id: string) => void }).removeCommand(
      getCommandId(title)
    );
  }

  private registerCommands(): void {
    if (this.disposed) return;
    const commands = getCachedCustomCommands();
    for (const title of this.registeredTitles) this.removeRegisteredCommand(title);
    this.registeredTitles.clear();
    for (const command of commands) this.registerCommand(command);
  }

  private registerCommand(command: CustomCommand): void {
    if (command.enabled === false) return;
    this.plugin.addCommand({
      id: getCommandId(command.title),
      name: command.title,
      editorCallback: (editor: Editor) => {
        if (!isCustomCommandEnabled(command)) return;
        new CustomCommandChatModal(this.app, {
          selectedText: editor.getSelection(),
          command,
        }).open();
        void CustomCommandManager.getInstance()
          .recordUsage(command)
          .catch((error) => logError("recordUsage failed", error));
      },
    });
    this.registeredTitles.add(command.title);
  }
}
