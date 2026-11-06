import React, { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { t } from "@/lib/i18n";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { ReactModal } from "@/components/modals/ReactModal";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import {
  SubagentManager,
  useSubagents,
  type SubagentDefinition,
} from "@/agentMode/subagents/SubagentManager";
import { SubagentEditorForm } from "./SubagentEditorForm";
import { SubagentList } from "./SubagentList";

export interface SubagentsSettingsProps {
  query?: string;
  onChanged?: () => Promise<void>;
}

export function SubagentsSettings({ query = "", onChanged }: SubagentsSettingsProps) {
  const app = useApp();
  const manager = SubagentManager.getInstance(app);
  const items = useSubagents();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void manager.refresh().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      active = false;
    };
  }, [manager]);

  const mutate = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
      await onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const edit = (definition?: SubagentDefinition) => {
    const id = definition?.id ?? uuidv4();
    class EditorModal extends ReactModal {
      protected renderContent(close: () => void): React.ReactElement {
        return (
          <SubagentEditorForm
            initialValue={definition}
            onCancel={close}
            onSave={async (value) => {
              await manager.save({ ...definition, ...value, id });
              close();
              await onChanged?.();
            }}
          />
        );
      }
    }
    new EditorModal(app, t(definition ? "Edit subagent" : "New subagent")).open();
  };

  const normalizedQuery = query.toLowerCase().trim();
  const visible = items.filter((item) =>
    `${item.name} ${item.description}`.toLowerCase().includes(normalizedQuery)
  );
  return (
    <section className="tw-flex tw-flex-col tw-gap-3" aria-label={t("Custom subagents")}>
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <h3 className="tw-m-0 tw-text-sm tw-font-medium">{t("Custom subagents")}</h3>
        <div className="tw-flex tw-gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              void mutate(async () => {
                await manager.refresh();
              })
            }
          >
            {t("Refresh")}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => edit()}>
            {t("New subagent")}
          </Button>
        </div>
      </div>
      <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
        {t("Without a custom subagent, general delegation remains available.")}
      </p>
      {error && (
        <p role="alert" className="tw-m-0 tw-text-sm tw-text-error">
          {error}
        </p>
      )}
      <SubagentList
        items={visible}
        busy={busy}
        onEdit={edit}
        onToggle={(item, enabled) => void mutate(() => manager.save({ ...item, enabled }))}
        onRemove={(item) => {
          new ConfirmModal(
            app,
            () => mutate(() => manager.remove(item.id)),
            t("Delete subagent {name}? Existing chats and task results are kept.", {
              name: item.name,
            }),
            t("Delete subagent"),
            t("Delete"),
            t("Cancel")
          ).open();
        }}
      />
    </section>
  );
}
