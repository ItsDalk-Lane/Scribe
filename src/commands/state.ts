import { atom, createStore } from "jotai";
import { useAtomValue } from "jotai";
import { CustomCommand } from "./type";

const customCommandsStore = createStore();
const customCommandsAtom = atom<CustomCommand[]>([]);
const pendingFileWritesAtom = new Map<string, number>();

export function addPendingFileWrite(filePath: string) {
  pendingFileWritesAtom.set(filePath, (pendingFileWritesAtom.get(filePath) ?? 0) + 1);
}

export function removePendingFileWrite(filePath: string) {
  const remaining = (pendingFileWritesAtom.get(filePath) ?? 0) - 1;
  if (remaining > 0) pendingFileWritesAtom.set(filePath, remaining);
  else pendingFileWritesAtom.delete(filePath);
}

export function isFileWritePending(filePath: string) {
  return pendingFileWritesAtom.has(filePath);
}

export function deleteCachedCommand(title: string) {
  const commands = customCommandsStore.get(customCommandsAtom);
  customCommandsStore.set(
    customCommandsAtom,
    commands.filter((command) => command.title !== title)
  );
}

export function updateCachedCommand(command: CustomCommand, prevCommandTitle: string) {
  const commands = customCommandsStore.get(customCommandsAtom);
  let updatedCommands: CustomCommand[];
  const prevIndex = prevCommandTitle ? commands.findIndex((c) => c.title === prevCommandTitle) : -1;
  if (prevIndex !== -1) {
    updatedCommands = commands.map((c) => (c.title === prevCommandTitle ? command : c));
  } else {
    updatedCommands = [...commands, command];
  }
  customCommandsStore.set(customCommandsAtom, updatedCommands);
}

export function updateCachedCommands(commands: CustomCommand[]) {
  customCommandsStore.set(customCommandsAtom, commands);
}

export function useCustomCommands(): CustomCommand[] {
  return useAtomValue(customCommandsAtom, { store: customCommandsStore });
}

export function getCachedCustomCommands(): CustomCommand[] {
  return customCommandsStore.get(customCommandsAtom);
}

export function subscribeToCustomCommands(listener: () => void): () => void {
  return customCommandsStore.sub(customCommandsAtom, listener);
}

export function isCustomCommandEnabled(command: CustomCommand): boolean {
  return (
    command.enabled !== false &&
    getCachedCustomCommands().find((current) => current.title === command.title)?.enabled !== false
  );
}
