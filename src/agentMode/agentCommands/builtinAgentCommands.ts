import { COMPACT_COMMAND_NAME } from "@/commands/compactCommand";

export const AGENT_BUILTIN_COMMANDS: readonly string[] = Object.freeze([COMPACT_COMMAND_NAME]);

export function isBuiltinCommandEnabled(
  settings: { agentMode?: { disabledBuiltinCommands?: readonly string[] } },
  name: string
): boolean {
  return !(settings.agentMode?.disabledBuiltinCommands ?? []).includes(name);
}
