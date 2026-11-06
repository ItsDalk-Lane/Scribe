import { t } from "@/lib/i18n";
import {
  SCRIBE_COMMAND_ENABLED,
  SCRIBE_COMMAND_ENABLE_TEMPLATING,
  SCRIBE_COMMAND_CONTEXT_MENU_ENABLED,
  SCRIBE_COMMAND_CONTEXT_MENU_ORDER,
  SCRIBE_COMMAND_LAST_USED,
  SCRIBE_COMMAND_MODEL_KEY,
  SCRIBE_COMMAND_SLASH_ENABLED,
  EMPTY_COMMAND,
  LEGACY_SELECTED_TEXT_PLACEHOLDER,
} from "@/commands/constants";
import { CustomCommand } from "@/commands/type";
import { parseDocument } from "yaml";
import { logWarn } from "@/logger";
import { App, Notice, TAbstractFile, TFile, Vault } from "obsidian";
import { getEffectiveCustomPromptsFolder } from "@/settings/scribeFolder";
import { updateCachedCommands, getCachedCustomCommands } from "./state";
import {
  extractTemplateNoteFiles,
  getFileContent,
  getFileName,
  getNotesFromPath,
  getNotesFromTags,
  processVariableNameForNotePath,
  stripFrontmatter,
} from "@/utils";
import { sortByStrategy } from "@/utils/recentUsageManager";
import {
  NOTE_CONTEXT_PROMPT_TAG,
  SELECTED_TEXT_TAG,
  VARIABLE_TAG,
  VARIABLE_NOTE_TAG,
} from "@/constants";

export function validateCommandName(
  name: string,
  commands: CustomCommand[],
  currentCommandName?: string
): string | null {
  const trimmedName = name.trim();

  if (!trimmedName) {
    return t("Command name cannot be empty");
  }

  if (name !== trimmedName) {
    return t("Command name cannot have leading or trailing spaces");
  }

  if (currentCommandName && name === currentCommandName) {
    return null;
  }

  // eslint-disable-next-line no-control-regex -- command paths must reject embedded control bytes
  const invalidChars = /[#<>:"/\\|?*[\]^\x00-\x1F]/g;
  if (invalidChars.test(trimmedName)) {
    return t('Command name contains invalid characters. Avoid using: < > : " / \\ | ? * [ ] ^');
  }

  if (commands.some((cmd) => cmd.title.toLowerCase() === trimmedName.toLowerCase())) {
    return t("A command with this name already exists");
  }

  return null;
}

export function getCommandId(commandName: string) {
  return encodeURIComponent(commandName.toLowerCase());
}

export function getCustomCommandsFolder(): string {
  return getEffectiveCustomPromptsFolder();
}

export function getCommandFilePath(title: string): string {
  return `${getCustomCommandsFolder()}/${title}.md`;
}

export function isCustomCommandFile(file: TAbstractFile): boolean {
  if (!(file instanceof TFile)) return false;
  if (file.extension !== "md") return false;
  const folder = getCustomCommandsFolder();
  if (!file.path.startsWith(folder + "/")) return false;
  const relativePath = file.path.slice(folder.length + 1);
  if (relativePath.includes("/")) return false;
  return true;
}

export async function parseCustomCommandFile(
  app: App,
  file: Pick<TFile, "path" | "basename">
): Promise<CustomCommand> {
  const raw = await app.vault.adapter.read(file.path);
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  const document = parseDocument(match ? match[1] : "{}");
  if (document.errors.length) throw new Error("指令属性格式不正确，请检查文件。");
  const value = <T>(key: string, fallback: T): T => {
    const found: unknown = document.get(key);
    return typeof found === typeof fallback ? (found as T) : fallback;
  };
  return {
    title: file.basename,
    content: stripFrontmatter(raw),
    enabled: value(SCRIBE_COMMAND_ENABLED, true),
    enableTemplating: value(SCRIBE_COMMAND_ENABLE_TEMPLATING, true),
    showInContextMenu: value(SCRIBE_COMMAND_CONTEXT_MENU_ENABLED, EMPTY_COMMAND.showInContextMenu),
    showInSlashMenu: value(SCRIBE_COMMAND_SLASH_ENABLED, EMPTY_COMMAND.showInSlashMenu),
    lastUsedMs: value(SCRIBE_COMMAND_LAST_USED, EMPTY_COMMAND.lastUsedMs),
    order: value(SCRIBE_COMMAND_CONTEXT_MENU_ORDER, EMPTY_COMMAND.order),
    modelKey: value(SCRIBE_COMMAND_MODEL_KEY, EMPTY_COMMAND.modelKey),
  };
}

export async function fetchAllCustomCommands(app: App): Promise<CustomCommand[]> {
  const folder = getCustomCommandsFolder();
  if (!(await app.vault.adapter.exists(folder))) return [];
  const { files } = await app.vault.adapter.list(folder);
  return Promise.all(
    files
      .filter(
        (path) =>
          path.endsWith(".md") &&
          path.startsWith(`${folder}/`) &&
          !path.slice(folder.length + 1).includes("/")
      )
      .sort()
      .map((path) =>
        parseCustomCommandFile(app, { path, basename: path.slice(folder.length + 1, -3) })
      )
  );
}

export async function loadAllCustomCommands(app: App): Promise<CustomCommand[]> {
  const commands = await fetchAllCustomCommands(app);
  updateCachedCommands(commands);
  return commands;
}

export function sortCommandsByOrder(commands: CustomCommand[]): CustomCommand[] {
  return sortByStrategy(commands, "manual", {
    getName: (command) => command.title,
    getCreatedAtMs: () => 0,
    getLastUsedAtMs: () => 0,
    getManualOrder: (command) => command.order,
  });
}

export function sortSlashCommands(commands: CustomCommand[]): CustomCommand[] {
  return sortCommandsByOrder(commands);
}

export async function processCommandPrompt(
  app: App,
  prompt: string,
  selectedText: string,
  skipAppendingSelectedText = false,
  enableTemplating = true
) {
  const result = await processPrompt(
    app,
    prompt,
    selectedText,
    app.vault,
    app.workspace.getActiveFile(),
    false,
    enableTemplating
  );

  const processedPrompt = result.processedPrompt;

  if (processedPrompt.includes(`{${SELECTED_TEXT_TAG}}`) || skipAppendingSelectedText) {
    return processedPrompt;
  }

  const index = processedPrompt.indexOf(LEGACY_SELECTED_TEXT_PLACEHOLDER);
  if (index === -1) {
    if (selectedText.trim()) {
      return (
        processedPrompt +
        "\n\n<" +
        SELECTED_TEXT_TAG +
        ">" +
        selectedText +
        "</" +
        SELECTED_TEXT_TAG +
        ">"
      );
    }
    return processedPrompt;
  }
  return (
    processedPrompt.slice(0, index) +
    selectedText +
    processedPrompt.slice(index + LEGACY_SELECTED_TEXT_PLACEHOLDER.length)
  );
}

const VARIABLE_REGEX = /\{(?!scribe-selection\}|\[\[)([^}]+)\}/g;

interface VariableProcessingResult {
  content: string;
  files: TFile[];
}

async function extractVariablesFromPrompt(
  app: App,
  customPrompt: string,
  vault: Vault,
  activeNote?: TFile | null
): Promise<{ variablesMap: Map<string, string>; includedFiles: Set<TFile> }> {
  const variablesMap = new Map<string, string>();
  const includedFiles = new Set<TFile>();
  let match: RegExpExecArray | null;

  while ((match = VARIABLE_REGEX.exec(customPrompt)) !== null) {
    const variableName = match[1].trim();
    const variableResult: VariableProcessingResult = { content: "", files: [] };

    const variableNameLower = variableName.toLowerCase();

    if (variableNameLower === "activenote") {
      if (activeNote) {
        const content = await getFileContent(activeNote, vault);
        if (content) {
          variableResult.content = `<${VARIABLE_NOTE_TAG}>\n<path>${activeNote.path}</path>\n## ${getFileName(activeNote)}\n\n${content}\n</${VARIABLE_NOTE_TAG}>`;
          variableResult.files.push(activeNote);
        }
      } else {
        new Notice(t("No active note found."));
      }
    } else if (variableNameLower === "activewebtab") {
      continue;
    } else if (variableName.startsWith("#")) {
      const tagNames = variableName
        .slice(1)
        .split(",")
        .map((tag) => tag.trim());
      const noteFiles = getNotesFromTags(app, tagNames);
      const notesContent: string[] = [];
      for (const file of noteFiles) {
        const content = await getFileContent(file, vault);
        if (content) {
          notesContent.push(
            `<${VARIABLE_NOTE_TAG}>\n<path>${file.path}</path>\n## ${getFileName(file)}\n\n${content}\n</${VARIABLE_NOTE_TAG}>`
          );
          variableResult.files.push(file);
        }
      }
      variableResult.content = notesContent.join("\n\n");
    } else {
      const processedVariableName = processVariableNameForNotePath(variableName);
      const noteFiles = getNotesFromPath(vault, processedVariableName);
      const notesContent: string[] = [];
      for (const file of noteFiles) {
        const content = await getFileContent(file, vault);
        if (content) {
          notesContent.push(
            `<${VARIABLE_NOTE_TAG}>\n<path>${file.path}</path>\n## ${getFileName(file)}\n\n${content}\n</${VARIABLE_NOTE_TAG}>`
          );
          variableResult.files.push(file);
        }
      }
      variableResult.content = notesContent.join("\n\n");
    }

    if (variableResult.content) {
      variablesMap.set(variableName, variableResult.content);
      variableResult.files.forEach((file) => includedFiles.add(file));
    } else if (variableNameLower !== "activenote" && variableNameLower !== "activewebtab") {
      if (!variableName.startsWith('"')) {
        logWarn(`No notes found for variable: ${variableName}`);
      }
    }
  }

  return { variablesMap, includedFiles };
}

export interface ProcessedPromptResult {
  processedPrompt: string;
  includedFiles: TFile[];
}

export async function processPrompt(
  app: App,
  customPrompt: string,
  selectedText: string,
  vault: Vault,
  activeNote?: TFile | null,
  skipEmptyBraces: boolean = false,
  enableTemplating: boolean = true
): Promise<ProcessedPromptResult> {
  const includedFiles = new Set<TFile>();

  if (!enableTemplating) {
    if (!skipEmptyBraces && customPrompt.includes("{}") && !selectedText && activeNote) {
      includedFiles.add(activeNote);
    }
    return {
      processedPrompt: customPrompt + "\n\n",
      includedFiles: Array.from(includedFiles),
    };
  }

  const { variablesMap, includedFiles: variableFiles } = await extractVariablesFromPrompt(
    app,
    customPrompt,
    vault,
    activeNote
  );
  variableFiles.forEach((file) => includedFiles.add(file));

  let processedPrompt = customPrompt;
  let additionalInfo = "";
  let activeNoteContent: string | null = null;

  if (!skipEmptyBraces && processedPrompt.includes("{}")) {
    processedPrompt = processedPrompt.replace(/\{\}/g, `{${SELECTED_TEXT_TAG}}`);
    if (selectedText) {
      additionalInfo += `<${SELECTED_TEXT_TAG}>\n${selectedText}\n</${SELECTED_TEXT_TAG}>`;
    } else if (activeNote) {
      activeNoteContent = await getFileContent(activeNote, vault);
      additionalInfo += `<${SELECTED_TEXT_TAG} type="active_note">\n${activeNoteContent || ""}\n</${SELECTED_TEXT_TAG}>`;
      includedFiles.add(activeNote);
    } else {
      additionalInfo += `<${SELECTED_TEXT_TAG}>\n(No selected text or active note available)\n</${SELECTED_TEXT_TAG}>`;
    }
  }

  for (const [varName, content] of variablesMap.entries()) {
    if (varName.toLowerCase() === "activenote" && activeNoteContent !== null) {
      continue;
    }
    if (additionalInfo) {
      additionalInfo += `\n\n<${VARIABLE_TAG} name="${varName}">\n${content}\n</${VARIABLE_TAG}>`;
    } else {
      additionalInfo += `<${VARIABLE_TAG} name="${varName}">\n${content}\n</${VARIABLE_TAG}>`;
    }
  }

  const noteLinkFiles = extractTemplateNoteFiles(processedPrompt, vault);
  for (const noteFile of noteLinkFiles) {
    if (!includedFiles.has(noteFile)) {
      const noteContent = await getFileContent(noteFile, vault);
      if (noteContent) {
        const stats = await vault.adapter.stat(noteFile.path);
        const ctime = stats ? new Date(stats.ctime).toISOString() : "Unknown";
        const mtime = stats ? new Date(stats.mtime).toISOString() : "Unknown";

        const noteContext = `<${NOTE_CONTEXT_PROMPT_TAG}>
<title>${noteFile.basename}</title>
<path>${noteFile.path}</path>
<ctime>${ctime}</ctime>
<mtime>${mtime}</mtime>
<content>
${noteContent}
</content>
</${NOTE_CONTEXT_PROMPT_TAG}>`;
        if (additionalInfo) {
          additionalInfo += `\n\n`;
        }
        additionalInfo += `${noteContext}`;
        includedFiles.add(noteFile);
      }
    }
  }

  return {
    processedPrompt: additionalInfo
      ? `${processedPrompt}\n\n${additionalInfo}`
      : `${processedPrompt}\n\n`,
    includedFiles: Array.from(includedFiles),
  };
}

export function generateCopyCommandName(
  originalName: string,
  existingCommands: CustomCommand[]
): string {
  const baseName = `${originalName} (copy)`;
  let copyName = baseName;
  let counter = 1;

  while (existingCommands.some((cmd) => cmd.title.toLowerCase() === copyName.toLowerCase())) {
    counter++;
    copyName = `${originalName} (copy ${counter})`;
  }

  return copyName;
}

export function getNextCustomCommandOrder(): number {
  const commands = getCachedCustomCommands();
  const lastOrder = commands.reduce(
    (prev: number, curr: CustomCommand) => (prev > curr.order ? prev : curr.order),
    0
  );
  return lastOrder === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : lastOrder + 10;
}
