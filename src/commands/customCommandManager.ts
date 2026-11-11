import { v4 as uuidv4 } from "uuid";
import { App } from "obsidian";
import { isMap, parseDocument } from "yaml";
import {
  getCommandFilePath,
  getCustomCommandsFolder,
  getNextCustomCommandOrder,
} from "@/commands/customCommandUtils";
import { CustomCommand } from "@/commands/type";
import {
  SCRIBE_COMMAND_ENABLED,
  SCRIBE_COMMAND_ENABLE_TEMPLATING,
  SCRIBE_COMMAND_CONTEXT_MENU_ENABLED,
  SCRIBE_COMMAND_CONTEXT_MENU_ORDER,
  SCRIBE_COMMAND_LAST_USED,
  SCRIBE_COMMAND_MODEL_KEY,
  EMPTY_COMMAND,
} from "@/commands/constants";
import {
  addPendingFileWrite,
  isCustomCommandEnabled,
  deleteCachedCommand,
  removePendingFileWrite,
  updateCachedCommand,
} from "./state";
import { ensureFolderExists } from "@/utils";
import { assertScribePath, writeVaultFile } from "@/utils/vaultFileStore";

const METADATA_FIELDS = {
  enabled: SCRIBE_COMMAND_ENABLED,
  enableTemplating: SCRIBE_COMMAND_ENABLE_TEMPLATING,
  showInContextMenu: SCRIBE_COMMAND_CONTEXT_MENU_ENABLED,
  order: SCRIBE_COMMAND_CONTEXT_MENU_ORDER,
  modelKey: SCRIBE_COMMAND_MODEL_KEY,
  lastUsedMs: SCRIBE_COMMAND_LAST_USED,
} as const;
const EDITABLE_FIELDS = [
  "enabled",
  "enableTemplating",
  "content",
  "showInContextMenu",
  "modelKey",
] as const;
type CommandChanges = Partial<Omit<CustomCommand, "title">>;

export class CustomCommandManager {
  private static instance: CustomCommandManager;
  private writeQueue: Promise<unknown> = Promise.resolve();

  private constructor(private readonly app: App) {}

  static getInstance(app?: App): CustomCommandManager {
    if (!CustomCommandManager.instance) {
      if (!app) {
        throw new Error(
          "CustomCommandManager.getInstance() requires `app` on first call (seed it at plugin load)."
        );
      }
      CustomCommandManager.instance = new CustomCommandManager(app);
    }
    return CustomCommandManager.instance;
  }

  async createCommand(
    command: CustomCommand,
    options: { skipStoreUpdate?: boolean; autoOrder?: boolean } = {}
  ): Promise<void> {
    await this.enqueue(async () => {
      await this.create(
        {
          ...command,
          order: options.autoOrder === false ? command.order : getNextCustomCommandOrder(),
        },
        options.skipStoreUpdate ?? false
      );
    });
  }

  async recordUsage(command: CustomCommand): Promise<void> {
    await this.enqueue(async () => {
      if (!isCustomCommandEnabled(command)) return;
      await this.patchExisting(command.title, { lastUsedMs: Date.now() });
    });
  }

  async updateCommand(
    command: CustomCommand,
    prevCommandTitle: string,
    skipStoreUpdate = false,
    previous?: CustomCommand
  ): Promise<void> {
    const normalized = { ...command, enabled: command.enabled !== false };
    const baseline = previous ? { ...previous, enabled: previous.enabled !== false } : undefined;
    const changes: CommandChanges = {};
    for (const field of EDITABLE_FIELDS) {
      if (!baseline || normalized[field] !== baseline[field])
        Object.assign(changes, { [field]: normalized[field] });
    }
    await this.enqueue(() =>
      this.update(command.title, prevCommandTitle, changes, skipStoreUpdate, baseline)
    );
  }

  async updateCommands(commands: CustomCommand[]): Promise<void> {
    await this.enqueue(async () => {
      for (const command of commands) {
        if (await this.app.vault.adapter.exists(getCommandFilePath(command.title))) {
          await this.update(command.title, command.title, command);
        } else {
          await this.create(command);
        }
      }
    });
  }

  async reorderCommands(commands: CustomCommand[]): Promise<void> {
    await this.enqueue(async () => {
      for (const [index, command] of commands.entries()) {
        await this.patchExisting(command.title, { order: index * 10 });
      }
    });
  }

  async deleteCommand(command: CustomCommand): Promise<void> {
    await this.enqueue(async () => {
      const filePath = getCommandFilePath(command.title);
      addPendingFileWrite(filePath);
      try {
        if (await this.app.vault.adapter.exists(filePath)) {
          const trashFolder = ".scribe/trash/commands";
          const destination = `${trashFolder}/${command.title}-${uuidv4()}.md`;
          await assertScribePath(this.app.vault, filePath);
          await assertScribePath(this.app.vault, destination);
          await ensureFolderExists(this.app.vault, trashFolder);
          await this.app.vault.adapter.rename(filePath, destination);
        }
        deleteCachedCommand(command.title);
      } finally {
        removePendingFileWrite(filePath);
      }
    });
  }

  private enqueue(run: () => Promise<void>): Promise<void> {
    const task = this.writeQueue.catch(() => undefined).then(run);
    this.writeQueue = task;
    return task;
  }

  private async create(command: CustomCommand, skipStoreUpdate = false): Promise<void> {
    const filePath = getCommandFilePath(command.title);
    addPendingFileWrite(filePath);
    try {
      if (await this.app.vault.adapter.exists(filePath))
        throw new Error("同名指令已存在，未覆盖现有文件。");
      const saved = this.patchDocument("", command.title, command);
      await ensureFolderExists(this.app.vault, getCustomCommandsFolder());
      await writeVaultFile(this.app.vault, filePath, saved.text, null);
      if (!skipStoreUpdate) updateCachedCommand(saved.command, command.title);
    } finally {
      removePendingFileWrite(filePath);
    }
  }

  private async patchExisting(title: string, changes: CommandChanges): Promise<void> {
    if (!(await this.app.vault.adapter.exists(getCommandFilePath(title)))) return;
    await this.update(title, title, changes);
  }

  private async update(
    title: string,
    previousTitle: string,
    changes: CommandChanges,
    skipStoreUpdate = false,
    baseline?: CustomCommand
  ): Promise<void> {
    const oldPath = getCommandFilePath(previousTitle);
    const newPath = getCommandFilePath(title);
    const renamed = oldPath !== newPath;
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(oldPath))) throw new Error("指令文件已变化，请重新打开后编辑。");
    const original = await adapter.read(oldPath);
    const saved = this.patchDocument(original, title, changes, baseline);
    addPendingFileWrite(oldPath);
    if (renamed) addPendingFileWrite(newPath);
    try {
      await writeVaultFile(this.app.vault, newPath, saved.text, renamed ? null : original);
      if (renamed) {
        try {
          if ((await adapter.read(oldPath)) !== original) {
            throw new Error("指令已被其他操作修改，请刷新后重试。");
          }
          await adapter.remove(oldPath);
        } catch (error) {
          if ((await adapter.read(newPath)) === saved.text) await adapter.remove(newPath);
          throw error;
        }
      }
      if (!skipStoreUpdate) updateCachedCommand(saved.command, previousTitle);
    } finally {
      removePendingFileWrite(oldPath);
      if (renamed) removePendingFileWrite(newPath);
    }
  }

  private patchDocument(
    text: string,
    title: string,
    changes: CommandChanges,
    baseline?: CustomCommand
  ): { text: string; command: CustomCommand } {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    const document = parseDocument(match ? match[1] : "{}");
    if (document.errors.length || (document.contents !== null && !isMap(document.contents)))
      throw new Error("指令属性格式不正确，未保存修改。");
    const current: CustomCommand = {
      ...EMPTY_COMMAND,
      title,
      content: match ? text.slice(match[0].length) : text,
    };
    for (const [field, key] of Object.entries(METADATA_FIELDS)) {
      const value: unknown = document.get(key);
      if (typeof value === typeof EMPTY_COMMAND[field as keyof typeof METADATA_FIELDS])
        Object.assign(current, { [field]: value });
    }
    if (baseline) {
      for (const field of Object.keys(changes) as (keyof CommandChanges)[]) {
        const value = field === "content" && match ? current.content.trimStart() : current[field];
        if (value !== baseline[field] && value !== changes[field])
          throw new Error("指令已被其他操作修改，请重新打开后再保存。草稿仍保留在当前窗口。");
      }
    }
    const command = { ...current, ...changes, title, enabled: changes.enabled ?? current.enabled };
    for (const [field, key] of Object.entries(METADATA_FIELDS)) {
      document.set(key, command[field as keyof typeof METADATA_FIELDS]);
    }
    return {
      text: `---\n${document.toString()}---\n${command.content}`,
      command: { ...command, content: command.content.trimStart() },
    };
  }
}
