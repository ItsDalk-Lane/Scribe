import { t } from "@/lib/i18n";
import { App, Modal } from "obsidian";
import React, { useState } from "react";
import { Root } from "react-dom/client";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { CommandEditorForm } from "@/commands/ui/CommandEditorForm";
import { CustomCommand } from "@/commands/type";
import { validateCommandName } from "@/commands/customCommandUtils";
import { useChatBackendModelOptions } from "@/hooks/useChatBackendModelOptions";

interface CustomCommandSettingsModalContentProps {
  commands: CustomCommand[];
  command: CustomCommand;
  onConfirm: (command: CustomCommand) => Promise<void>;
  onCancel: () => void;
}

function CustomCommandSettingsModalContent({
  commands,
  command,
  onConfirm,
  onCancel,
}: CustomCommandSettingsModalContentProps) {
  const { options, resolveSelectionId } = useChatBackendModelOptions(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const save = async (updated: CustomCommand) => {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await onConfirm(updated);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("Could not save configuration."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <CommandEditorForm
      command={{ ...command, modelKey: resolveSelectionId(command.modelKey) ?? command.modelKey }}
      modelOptions={options}
      validateName={(name) => validateCommandName(name, commands, command.title)}
      onConfirm={(updated) => void save(updated)}
      onCancel={onCancel}
      saving={saving}
      error={error}
    />
  );
}

export class CustomCommandSettingsModal extends Modal {
  private root: Root;

  constructor(
    app: App,
    private commands: CustomCommand[],
    private command: CustomCommand,
    private onUpdate: (command: CustomCommand) => void | Promise<void>
  ) {
    super(app);
    // @ts-ignore
    this.setTitle(t("Edit command"));
  }

  onOpen() {
    const { contentEl } = this;
    this.root = createPluginRoot(contentEl, this.app);

    const handleConfirm = async (command: CustomCommand) => {
      await this.onUpdate(command);
      this.close();
    };

    this.root.render(
      <CustomCommandSettingsModalContent
        commands={this.commands}
        command={this.command}
        onConfirm={handleConfirm}
        onCancel={() => this.close()}
      />
    );
  }

  onClose() {
    this.root.unmount();
  }
}
