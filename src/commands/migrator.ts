import { t } from "@/lib/i18n";
import { App } from "obsidian";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { getCustomCommandsFolder, validateCommandName } from "@/commands/customCommandUtils";
import { CustomCommand } from "@/commands/type";
import { getSettings, updateSetting } from "@/settings/model";
import { ensureFolderExists } from "@/utils";
import {
  SCRIBE_COMMAND_CONTEXT_MENU_ORDER,
  SCRIBE_COMMAND_LAST_USED,
  SCRIBE_COMMAND_MODEL_KEY,
  SCRIBE_COMMAND_SLASH_ENABLED,
  DEFAULT_COMMANDS,
} from "@/commands/constants";
import { SCRIBE_COMMAND_CONTEXT_MENU_ENABLED } from "@/commands/constants";
import { getCachedCustomCommands } from "@/commands/state";
import type { StartupMigrationItem } from "@/services/startupMigration";

async function saveUnsupportedCommands(app: App, commands: CustomCommand[]) {
  const folderPath = getCustomCommandsFolder();
  const unsupportedFolderPath = `${folderPath}/unsupported`;
  await ensureFolderExists(app.vault, unsupportedFolderPath);
  return Promise.all(
    commands.map(async (command) => {
      const filePath = `${unsupportedFolderPath}/${command.title}.md`;
      const file = await app.vault.create(filePath, command.content);
      await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        frontmatter[SCRIBE_COMMAND_CONTEXT_MENU_ENABLED] = command.showInContextMenu;
        frontmatter[SCRIBE_COMMAND_SLASH_ENABLED] = command.showInSlashMenu;
        frontmatter[SCRIBE_COMMAND_CONTEXT_MENU_ORDER] = command.order;
        frontmatter[SCRIBE_COMMAND_MODEL_KEY] = command.modelKey;
        frontmatter[SCRIBE_COMMAND_LAST_USED] = 0;
      });
    })
  );
}

export async function migrateCommands(app: App): Promise<StartupMigrationItem | null> {
  const legacyCommands = getSettings().inlineEditCommands;
  if (!legacyCommands || legacyCommands.length === 0) {
    return null;
  }
  const commandsToMigrate: CustomCommand[] = [];
  const unsupportedCommands: CustomCommand[] = [];
  const existingCommands = getCachedCustomCommands();

  const commands = legacyCommands.map((command, index) => ({
    title: command.name,
    content: command.prompt,
    showInContextMenu: command.showInContextMenu,
    showInSlashMenu: false,
    order: index * 10,
    modelKey: command.modelKey ?? "",
    lastUsedMs: 0,
  }));

  for (const command of commands) {
    const error = validateCommandName(command.title, existingCommands);
    if (error) {
      unsupportedCommands.push({
        ...command,
        title: encodeURIComponent(command.title),
        content: `> ${error} \n\nOriginal name: ${command.title} \n\n${command.content}`,
      });
    } else {
      commandsToMigrate.push(command);
    }
  }

  await CustomCommandManager.getInstance().updateCommands([
    ...existingCommands.map((command) => ({
      ...command,
      showInSlashMenu: true,
    })),
    ...commandsToMigrate,
  ]);

  const details = [t("Stored in {folder}.", { folder: getCustomCommandsFolder() })];
  if (unsupportedCommands.length > 0) {
    await saveUnsupportedCommands(app, unsupportedCommands);
    details.push(
      t(
        unsupportedCommands.length === 1
          ? "{count} unsupported command was saved in {folder}/unsupported. Resolve the errors, then move each note out of that folder."
          : "{count} unsupported commands were saved in {folder}/unsupported. Resolve the errors, then move each note out of that folder.",
        { count: unsupportedCommands.length, folder: getCustomCommandsFolder() }
      )
    );
  }

  updateSetting("inlineEditCommands", []);

  return {
    id: "custom-commands",
    title: t("Custom commands"),
    status: unsupportedCommands.length > 0 ? "action-required" : "success",
    summary: t(
      commandsToMigrate.length === 1
        ? "{count} command was migrated to note files."
        : "{count} commands were migrated to note files.",
      { count: commandsToMigrate.length }
    ),
    details,
  };
}

export async function generateDefaultCommands(): Promise<void> {
  const existingCommands = getCachedCustomCommands();
  const defaultCommands = DEFAULT_COMMANDS.filter(
    (command) => !existingCommands.some((c) => c.title === command.title)
  );
  const newCommands = [...existingCommands, ...defaultCommands];
  await CustomCommandManager.getInstance().updateCommands(newCommands);
}
