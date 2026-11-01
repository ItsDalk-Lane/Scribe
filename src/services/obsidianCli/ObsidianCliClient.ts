interface RequireContainer {
  require?: (id: string) => unknown;
}

interface ElectronModule {
  ipcRenderer: { sendSync: (channel: string, ...args: unknown[]) => unknown };
}

function getRuntimeRequire(): (id: string) => unknown {
  const container = window as unknown as RequireContainer;
  if (typeof container.require !== "function") {
    throw new Error(
      "Node require is unavailable in this runtime. Obsidian CLI commands require the desktop app."
    );
  }
  return container.require;
}

export function isObsidianCliEnabled(): boolean {
  const electron = getRuntimeRequire()("electron") as ElectronModule;
  // Obsidian keeps its per-device Command line interface toggle in the main process and has no
  // plugin API for it; a null "cli" message reads it, and releases before 1.12 do not answer.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/726
  return electron.ipcRenderer.sendSync("cli", null) === true;
}
