import type {
  AgentExtensionGroup,
  AgentExtensionItem,
  AgentExtensionKind,
} from "@/agentMode/session/extensionInventory";
import { Button } from "@/components/ui/button";
import { ExtensionAvailabilitySwitch } from "@/components/ui/extension-availability-switch";
import { ExtensionAvailabilityDot } from "@/components/ui/extension-availability-dot";
import {
  getExtensionDotState,
  getExtensionSwitchState,
  isExtensionToggleable,
} from "@/agentMode/session/extensionAvailability";
import { t } from "@/lib/i18n";
import { Bot, Network, Pencil, Puzzle, Terminal, Trash2, Wand2, Webhook } from "lucide-react";
import React from "react";

export interface AgentExtensionsPanelProps {
  agentName: string;
  groups: readonly AgentExtensionGroup[] | null;
  loading: boolean;
  error?: boolean;
  runtimeState?: "not_started" | "checked" | "partial" | "error";
  onRefresh: () => void;
  onOpen?: (item: AgentExtensionItem) => void;
  onToggle?: (item: AgentExtensionItem, enabled: boolean) => void;
  onDelete?: (item: AgentExtensionItem) => void;
  busy?: boolean;
}

export const EXTENSION_LABELS: Record<AgentExtensionKind, string> = {
  skill: "Skills",
  mcp: "MCP servers",
  plugin: "Plugins",
  command: "Commands",
  hook: "Hooks",
  subagent: "Subagents",
};
const ICONS = {
  skill: Wand2,
  mcp: Network,
  plugin: Puzzle,
  command: Terminal,
  hook: Webhook,
  subagent: Bot,
};

export function AgentExtensionsPanel({
  groups,
  loading,
  error,
  runtimeState = "not_started",
  onRefresh,
  onOpen,
  onToggle,
  onDelete,
  busy = false,
}: AgentExtensionsPanelProps) {
  return (
    <div className="tw-group/settings tw-space-y-5">
      {loading && (
        <p role="status" className="tw-text-ui-small tw-text-muted">
          {t("Loading extensions…")}
        </p>
      )}
      {error && (
        <div role="alert" className="tw-space-y-2 tw-text-ui-small tw-text-error">
          <p>{t("Could not read agent extensions. Refresh to try again.")}</p>
          <Button variant="secondary" onClick={onRefresh}>
            {t("Retry")}
          </Button>
        </div>
      )}
      {groups?.map((group) => {
        const sections = new Map<string, AgentExtensionItem[]>();
        for (const item of group.items) {
          const name =
            item.parentPluginId ??
            (item.builtin || item.source === "runtime" ? t("Built-in") : t("Installed"));
          const entries = sections.get(name);
          if (entries) entries.push(item);
          else sections.set(name, [item]);
        }
        const Icon = ICONS[group.kind];
        return (
          <section key={group.kind} className="tw-space-y-4">
            {group.warnings.map((warning) => (
              <p key={warning} className="tw-text-ui-smaller tw-leading-normal tw-text-muted">
                {t(warning)}
              </p>
            ))}
            {group.items.length === 0 && !loading && (
              <div className="tw-flex tw-min-h-36 tw-flex-col tw-items-center tw-justify-center tw-gap-2 tw-rounded-lg tw-border tw-border-dashed tw-border-border tw-p-5">
                <Icon className="tw-size-5 tw-text-muted" />
                <span className="tw-text-ui-small tw-font-medium">
                  {t("No entries found in the checked sources.")}
                </span>
                <span className="tw-text-ui-smaller tw-leading-normal tw-text-muted">
                  {t(EXTENSION_LABELS[group.kind])}
                </span>
              </div>
            )}
            {[...sections].map(([name, items]) => (
              <section key={name} className="tw-space-y-3">
                <h3 className="tw-m-0 tw-flex tw-items-center tw-gap-2 tw-text-ui-small tw-font-medium">
                  {name}
                  <span className="tw-text-ui-smaller tw-font-normal tw-text-muted">
                    {items.length}
                  </span>
                </h3>
                <div className="tw-divide-y tw-divide-border tw-overflow-hidden tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-transparent tw-@container">
                  {items.map((item) => {
                    return (
                      <article
                        key={item.id}
                        aria-label={item.name}
                        onClick={(event) => {
                          if (!(event.target as HTMLElement).closest("button, [role=switch]"))
                            onOpen?.(item);
                        }}
                        className="tw-flex tw-min-w-0 tw-items-center tw-gap-2 tw-p-3 @sm:tw-gap-3"
                      >
                        <div className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-bg-transparent @sm:tw-size-9">
                          <Icon
                            aria-hidden="true"
                            className="tw-size-4 tw-text-muted @sm:tw-size-5"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => onOpen?.(item)}
                          className="!tw-block !tw-h-auto tw-min-w-0 tw-flex-1 !tw-whitespace-normal !tw-border-0 !tw-bg-transparent !tw-p-0 tw-text-left tw-text-normal !tw-shadow-none focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring"
                        >
                          <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
                            <span className="tw-min-w-0 tw-truncate tw-text-ui-small tw-font-medium">
                              {item.name}
                            </span>
                            {group.kind === "plugin" && item.version && (
                              <span className="tw-shrink-0 tw-text-ui-smaller tw-text-muted">
                                {item.version}
                              </span>
                            )}
                          </span>
                          {item.description && (
                            <span className="tw-mt-1 tw-block tw-truncate tw-text-ui-smaller tw-leading-normal tw-text-muted">
                              {item.description}
                            </span>
                          )}
                        </button>
                        <div className="tw-flex tw-max-w-16 tw-shrink-0 tw-flex-wrap tw-items-center tw-justify-end tw-gap-1 @sm:tw-max-w-none @sm:tw-flex-nowrap">
                          {isExtensionToggleable({ ...item, kind: group.kind }) ? (
                            <ExtensionAvailabilitySwitch
                              label={t("Enable {name}", { name: item.name })}
                              state={
                                runtimeState === "error"
                                  ? {
                                      ...getExtensionSwitchState({ ...item, kind: group.kind }),
                                      disabled: true,
                                      phase: "unknown",
                                      reason: "Availability could not be confirmed. Check again.",
                                    }
                                  : getExtensionSwitchState({ ...item, kind: group.kind }, loading)
                              }
                              busy={busy}
                              onToggle={onToggle ? (next) => onToggle(item, next) : undefined}
                            />
                          ) : (
                            <ExtensionAvailabilityDot
                              state={getExtensionDotState({ ...item, kind: group.kind })}
                            />
                          )}
                          {item.capabilities?.edit &&
                            onOpen &&
                            (group.kind === "plugin" || group.kind === "hook") && (
                              <Button
                                size="icon"
                                variant="ghost"
                                disabled={busy}
                                aria-label={t("Edit {name}", { name: item.name })}
                                onClick={() => onOpen(item)}
                              >
                                <Pencil className="tw-size-4" />
                              </Button>
                            )}
                          {item.capabilities?.delete && onDelete && (
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={busy}
                              aria-label={t("Delete {name}", { name: item.name })}
                              className="hover:tw-text-error group-[]/settings:hover:!tw-text-error"
                              onClick={() => onDelete(item)}
                            >
                              <Trash2 className="tw-size-4" />
                            </Button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </section>
        );
      })}
      {runtimeState === "error" && (
        <p role="status" className="tw-text-ui-smaller tw-leading-normal tw-text-muted">
          {t(
            "Could not read check results. Missing status does not mean an extension was not loaded. Try checking again."
          )}
        </p>
      )}
      {runtimeState === "partial" && (
        <p role="status" className="tw-text-ui-smaller tw-leading-normal tw-text-muted">
          {t(
            "Some check results could not be read. Missing status does not mean an extension was not loaded."
          )}
        </p>
      )}
    </div>
  );
}
