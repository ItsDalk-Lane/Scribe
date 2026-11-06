import { CustomCommandManager } from "@/commands/customCommandManager";
import { DEFAULT_COMMANDS } from "@/commands/constants";
import { getCachedCustomCommands } from "@/commands/state";

export async function generateDefaultCommands(): Promise<void> {
  const existingCommands = getCachedCustomCommands();
  const defaultCommands = DEFAULT_COMMANDS.filter(
    (command) => !existingCommands.some((c) => c.title === command.title)
  );
  const newCommands = [...existingCommands, ...defaultCommands];
  await CustomCommandManager.getInstance().updateCommands(newCommands);
}
