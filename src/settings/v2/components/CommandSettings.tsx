import { AgentConfigurationHeader } from "@/components/ui/AgentConfigurationHeader";
import { CommandConfigurationRow } from "@/commands/ui/CommandConfigurationRow";
import { t } from "@/lib/i18n";
import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useCustomCommands } from "@/commands/state";
import { GripVertical, Plus } from "lucide-react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { PromptSortStrategy } from "@/types";
import { EMPTY_COMMAND } from "@/commands/constants";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { CustomCommandSettingsModal } from "@/commands/CustomCommandSettingsModal";
import { generateCopyCommandName, sortCommandsByOrder } from "@/commands/customCommandUtils";
import { generateDefaultCommands } from "@/commands/migrator";
import type { CustomCommand } from "@/commands/type";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { deriveCustomPromptsFolder } from "@/settings/copilotFolder";
import { useApp } from "@/context";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { Notice } from "obsidian";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

interface SortableCommandRowProps {
  command: CustomCommand;
  commands: CustomCommand[];
  onUpdate: (command: CustomCommand, previousTitle: string) => Promise<void>;
  onRemove: (command: CustomCommand) => Promise<void>;
  onCopy: (command: CustomCommand) => Promise<void>;
}

function SortableCommandRow({
  command,
  commands,
  onUpdate,
  onRemove,
  onCopy,
}: SortableCommandRowProps) {
  const app = useApp();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: command.title,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "tw-relative tw-z-dragged-item tw-bg-secondary tw-shadow-lg")}
    >
      <CommandConfigurationRow
        command={command}
        dragHandle={
          <Button
            {...attributes}
            {...listeners}
            type="button"
            variant="ghost"
            size="icon"
            className="tw-cursor-grab"
            aria-label={t("Reorder {name}", { name: command.title })}
          >
            <GripVertical aria-hidden="true" className="tw-size-4" />
          </Button>
        }
        onEnabledChange={safeAsyncHandler(async (enabled) =>
          onUpdate({ ...command, enabled }, command.title)
        )}
        onEdit={() =>
          new CustomCommandSettingsModal(app, commands, command, (updated) =>
            onUpdate(updated, command.title)
          ).open()
        }
        onCopy={safeAsyncHandler(async () => onCopy(command))}
        onDelete={() =>
          new ConfirmModal(
            app,
            () => onRemove(command),
            t(
              'Are you sure you want to delete the command "{title}"? This will permanently remove the command file and cannot be undone.',
              { title: command.title }
            ),
            t("Delete Command"),
            t("Delete"),
            t("Cancel")
          ).open()
        }
      />
    </div>
  );
}

export interface CommandSettingsProps {
  embedded?: boolean;
  query?: string;
  children?: React.ReactNode;
}

export const CommandSettings: React.FC<CommandSettingsProps> = ({
  embedded = false,
  query,
  children,
}) => {
  const app = useApp();
  const rawCommands = useCustomCommands();
  const commands = useMemo(() => {
    return sortCommandsByOrder([...rawCommands]);
  }, [rawCommands]);

  const [localQuery, setLocalQuery] = useState("");
  const search = (query ?? localQuery).trim().toLowerCase();
  const visibleCommands = useMemo(
    () =>
      commands.filter((command) =>
        `${command.title} ${command.content}`.toLowerCase().includes(search)
      ),
    [commands, search]
  );

  const settings = useSettingsValue();
  const customPromptsFolder = deriveCustomPromptsFolder(settings);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleUpdate = async (newCommand: CustomCommand, prevCommandTitle: string) => {
    await CustomCommandManager.getInstance().updateCommand(
      newCommand,
      prevCommandTitle,
      false,
      commands.find((command) => command.title === prevCommandTitle)
    );
  };

  const handleCreate = async (newCommand: CustomCommand) => {
    await CustomCommandManager.getInstance().createCommand(newCommand);
  };

  const handleRemove = async (command: CustomCommand) => {
    try {
      await CustomCommandManager.getInstance().deleteCommand(command);

      new Notice(t('Command "{title}" deleted successfully!', { title: command.title }));
    } catch (error) {
      logError("Failed to delete command:", error);
      new Notice(t("Failed to delete command. Please try again."));
      throw error;
    }
  };

  const handleCopy = async (command: CustomCommand) => {
    try {
      const copyName = generateCopyCommandName(command.title, commands);
      const copiedCommand: CustomCommand = {
        ...command,
        title: copyName,
      };
      await CustomCommandManager.getInstance().createCommand(copiedCommand, {
        autoOrder: false,
      });
    } catch (error) {
      logError("Failed to duplicate command:", error);
      new Notice(t("Failed to duplicate command. Please try again."));
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const activeIndex = commands.findIndex((command) => command.title === active.id);
    const overIndex = commands.findIndex((command) => command.title === over.id);

    if (activeIndex === -1 || overIndex === -1) {
      return;
    }

    const newCommands = [...commands];
    const [movedCommand] = newCommands.splice(activeIndex, 1);
    newCommands.splice(overIndex, 0, movedCommand);

    await CustomCommandManager.getInstance().reorderCommands(newCommands);
  };

  return (
    <div className="tw-space-y-5">
      {!embedded && (
        <AgentConfigurationHeader
          agents={[{ id: "native", label: "Scribe" }]}
          selectedAgent="native"
          query={query ?? localQuery}
          onQueryChange={setLocalQuery}
          searchPlaceholder={t("Search commands…")}
          label={t("Custom commands")}
          count={commands.length}
        />
      )}
      <details className="tw-rounded-lg tw-border tw-border-solid tw-border-border">
        <summary className="tw-cursor-pointer tw-p-4 tw-text-sm tw-font-medium tw-text-muted">
          {t("Command options")}
        </summary>
        <div className="tw-space-y-4 tw-border-0 tw-border-t tw-border-solid tw-border-border tw-px-4 tw-pb-4">
          <SettingSection>
            <SettingItem
              type="switch"
              title={t("Command templating")}
              description={t(
                "Fill in variables like {activenote}, {foldername}, or {#tag} in commands. Turn off to send commands exactly as written."
              )}
              checked={settings.enableCustomPromptTemplating}
              onCheckedChange={(checked) => updateSetting("enableCustomPromptTemplating", checked)}
            />
            <SettingItem
              type="select"
              title={t("Command sort order")}
              description={t("How commands are ordered in the slash menu.")}
              value={settings.promptSortStrategy}
              onChange={(value) => updateSetting("promptSortStrategy", value)}
              options={[
                { label: t("Recency"), value: PromptSortStrategy.TIMESTAMP },
                { label: t("Alphabetical"), value: PromptSortStrategy.ALPHABETICAL },
                { label: t("Manual"), value: PromptSortStrategy.MANUAL },
              ]}
            />
          </SettingSection>
          <p className="tw-m-0 tw-break-words tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
            {t(
              "Commands load automatically from the Markdown files in your custom commands folder"
            )}{" "}
            <strong>{customPromptsFolder}</strong>
            {t(". Editing a file updates its command.")}
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              new ConfirmModal(
                app,
                generateDefaultCommands,
                t(
                  "This will add default commands to your custom prompts folder. Do you want to continue?"
                ),
                t("Generate default commands")
              ).open()
            }
          >
            {t("Generate defaults")}
          </Button>
        </div>
      </details>
      <section className="tw-space-y-3" aria-label={t("My commands")}>
        <div className="tw-group/extension-actions tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
          <h3 className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold">
            {t("My commands")}
            <span className="tw-text-xs tw-font-normal tw-text-muted">{commands.length}</span>
          </h3>
          <Button
            type="button"
            className="tw-gap-2"
            onClick={() =>
              new CustomCommandSettingsModal(app, commands, { ...EMPTY_COMMAND }, (updated) =>
                handleCreate(updated)
              ).open()
            }
          >
            <Plus aria-hidden="true" className="tw-size-4" />
            {t("Add command")}
          </Button>
        </div>
        <p className="tw-m-0 tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
          {t("These commands are saved in the current vault.")}
        </p>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={safeAsyncHandler(handleDragEnd)}
        >
          <SortableContext
            items={visibleCommands.map((command) => command.title)}
            strategy={verticalListSortingStrategy}
          >
            <div className="tw-divide-y tw-divide-border tw-overflow-hidden tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-transparent">
              {visibleCommands.map((command) => (
                <SortableCommandRow
                  key={command.title}
                  command={command}
                  commands={commands}
                  onUpdate={handleUpdate}
                  onRemove={handleRemove}
                  onCopy={handleCopy}
                />
              ))}
              {visibleCommands.length === 0 && (
                <p className="tw-m-0 tw-p-6 tw-text-center tw-text-sm tw-text-muted">
                  {t(search ? "No matching commands." : "No custom commands yet.")}
                </p>
              )}
            </div>
          </SortableContext>
        </DndContext>
      </section>
      {children}
    </div>
  );
};
