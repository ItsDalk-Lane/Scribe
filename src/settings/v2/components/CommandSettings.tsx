import { CommandConfigurationRow } from "@/commands/ui/CommandConfigurationRow";
import { t } from "@/lib/i18n";
import React, { useEffect, useMemo } from "react";
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
import { useSettingsValue } from "@/settings/model";
import { EMPTY_COMMAND } from "@/commands/constants";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { CustomCommandSettingsModal } from "@/commands/CustomCommandSettingsModal";
import {
  generateCopyCommandName,
  sortCommandsByOrder,
  loadAllCustomCommands,
} from "@/commands/customCommandUtils";
import { generateDefaultCommands } from "@/commands/migrator";
import type { CustomCommand } from "@/commands/type";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { deriveCustomPromptsFolder } from "@/settings/scribeFolder";
import { useApp } from "@/context";
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
              'Are you sure you want to delete the command "{title}"? Its file will be moved to Scribe’s trash.',
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
  children?: React.ReactNode;
}

export const CommandSettings: React.FC<CommandSettingsProps> = ({ children }) => {
  const app = useApp();
  useEffect(() => {
    void loadAllCustomCommands(app).catch((error) => {
      logError("Failed to refresh commands.", error);
      new Notice(t("Failed to load commands."));
    });
  }, [app]);
  const rawCommands = useCustomCommands();
  const commands = useMemo(() => {
    return sortCommandsByOrder([...rawCommands]);
  }, [rawCommands]);

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
      <p className="tw-m-0 tw-break-words tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
        {t("Commands load automatically from the Markdown files in your custom commands folder")}{" "}
        <strong>{customPromptsFolder}</strong>
        {t(". Reopen this page to reload files edited outside Scribe.")}
      </p>
      <section className="tw-space-y-3" aria-label={t("My commands")}>
        <div className="tw-group/extension-actions tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
          <h3 className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold">
            {t("My commands")}
            <span className="tw-text-xs tw-font-normal tw-text-muted">{commands.length}</span>
          </h3>
          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
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
            items={commands.map((command) => command.title)}
            strategy={verticalListSortingStrategy}
          >
            <div className="tw-divide-y tw-divide-border tw-overflow-hidden tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-transparent">
              {commands.map((command) => (
                <SortableCommandRow
                  key={command.title}
                  command={command}
                  commands={commands}
                  onUpdate={handleUpdate}
                  onRemove={handleRemove}
                  onCopy={handleCopy}
                />
              ))}
              {commands.length === 0 && (
                <p className="tw-m-0 tw-p-6 tw-text-center tw-text-sm tw-text-muted">
                  {t("No custom commands yet.")}
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
