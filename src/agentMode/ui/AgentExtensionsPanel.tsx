import type {
  AgentExtensionGroup,
  AgentExtensionItem,
  AgentExtensionKind,
} from "@/agentMode/session/extensionInventory";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ExtensionAvailabilitySwitch } from "@/components/ui/extension-availability-switch";
import { ExtensionAvailabilityDot } from "@/components/ui/extension-availability-dot";
import {
  getExtensionDotState,
  getExtensionSwitchState,
  isExtensionToggleable,
} from "@/agentMode/session/extensionAvailability";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  Bot,
  ChevronDown,
  Network,
  Pencil,
  Puzzle,
  Terminal,
  Trash2,
  Wand2,
  Webhook,
} from "lucide-react";
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
  forceExpanded?: boolean;
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

// Section collapse choices live only for the current app session and never reach persisted
// settings; a fresh Obsidian start collapses every section again.
// https://github.com/ItsDalk-Lane/Scribe/issues/4
let sessionExpandedSections: ReadonlySet<string> = new Set<string>();

export function resetExpandedExtensionSectionsForTests(): void {
  sessionExpandedSections = new Set<string>();
}

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
  forceExpanded = false,
}: AgentExtensionsPanelProps) {
  const [expandedSections, setExpandedSections] = React.useState<ReadonlySet<string>>(
    () => sessionExpandedSections
  );
  const toggleSection = (key: string, open: boolean): void => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      sessionExpandedSections = next;
      return next;
    });
  };
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
            {[...sections].map(([name, items]) => {
              const key = `${group.kind}:${name}`;
              const open = forceExpanded || expandedSections.has(key);
              return (
                <Collapsible
                  key={name}
                  open={open}
                  onOpenChange={(next) => toggleSection(key, next)}
                  className="tw-w-full tw-overflow-hidden tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-@container"
                >
                  <h3 className="!tw-m-0 !tw-p-0">
                    <CollapsibleTrigger asChild>
                      {/* Obsidian's button stylesheet outranks per-element overrides here, so the
                          header is a plain div trigger whose values apply verbatim.
                          https://github.com/ItsDalk-Lane/Scribe/issues/4 */}
                      <div
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.currentTarget.click();
                          }
                        }}
                        className="tw-flex tw-w-full tw-cursor-pointer tw-items-center tw-justify-start tw-gap-2 tw-bg-transparent tw-px-3 tw-py-1 tw-text-left tw-text-normal focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-inset focus-visible:tw-ring-ring"
                      >
                        {/* The chevron sits in the same icon slot a row uses, so its left edge
                            aligns with the row icons structurally instead of by measured offsets.
                            https://github.com/ItsDalk-Lane/Scribe/issues/4 */}
                        <div className="tw-flex tw-w-6 tw-shrink-0 tw-items-center tw-justify-center @sm:tw-w-9">
                          <ChevronDown
                            aria-hidden="true"
                            className={cn(
                              "tw-size-4 tw-text-muted tw-transition-transform @sm:tw-size-5",
                              !open && "tw--rotate-90"
                            )}
                          />
                        </div>
                        <span className="tw-text-ui-small tw-font-medium">{name}</span>
                        <span className="tw-text-ui-smaller tw-font-normal tw-text-muted">
                          {items.length}
                        </span>
                      </div>
                    </CollapsibleTrigger>
                  </h3>
                  <CollapsibleContent>
                    <div>
                      {items.map((item) => {
                        return (
                          <article
                            key={`${item.id}:${item.target?.scope.kind === "project" ? item.target.scope.cwd : ""}`}
                            aria-label={item.name}
                            onClick={(event) => {
                              if (!(event.target as HTMLElement).closest("button, [role=switch]"))
                                onOpen?.(item);
                            }}
                            className="tw-flex tw-min-w-0 tw-items-center tw-gap-2 tw-px-3 tw-py-1.5"
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
                                  state={getExtensionSwitchState(
                                    { ...item, kind: group.kind },
                                    loading
                                  )}
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
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
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
