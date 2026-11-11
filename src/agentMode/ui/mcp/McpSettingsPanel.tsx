import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchBar } from "@/components/ui/SearchBar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { useApp } from "@/context";
import { logError } from "@/logger";
import { Notice } from "obsidian";
import React, { useMemo, useState } from "react";
import { Check, ChevronDown, ClipboardCopy, FileJson, GripVertical, Plus } from "lucide-react";
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

import { exportMcpServersJson } from "@/agentMode/mcp/configSchema";
import type { McpServerConfig, McpServerStatus, McpServerType } from "@/agentMode/mcp/types";
import { getSettings } from "@/settings/model";
import { useSettingsValue } from "@/settings/model";
import { McpJsonImportModal } from "./McpJsonImportDialog";
import { McpServerEditorModal } from "./McpServerEditorDialog";
import { McpToolLoadingSetting } from "./McpToolLoadingSetting";
import { setMcpToolLoadingMode, setMcpToolLoadingThresholdChars } from "./mcpToolLoadingUi";
import { useMcpServerViews, writeMcpServers, type McpServerView } from "./mcpUiState";

const EMPTY_TYPE_FILTER: ReadonlySet<string> = Object.freeze(new Set<string>());

type McpStatusFilter = "all" | "enabled" | "disabled";

const TYPE_LABELS: Record<McpServerType, string> = {
  stdio: "STDIO",
  sse: "SSE",
  streamableHttp: "HTTP",
};

const TYPE_FILTER_VALUES: readonly string[] = Object.freeze(["stdio", "sse", "streamableHttp"]);

export const McpSettingsPanel: React.FC = () => {
  const app = useApp();
  const settings = useSettingsValue();
  const views = useMcpServerViews(settings.mcp.servers);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<McpStatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<ReadonlySet<string>>(EMPTY_TYPE_FILTER);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return views.filter(({ server }) => {
      if (statusFilter === "enabled" && !server.isActive) return false;
      if (statusFilter === "disabled" && server.isActive) return false;
      if (typeFilter.size > 0 && !typeFilter.has(server.type)) return false;
      if (!q) return true;
      const haystack = [server.name, server.description, ...(server.tags ?? [])]
        .filter((part): part is string => typeof part === "string")
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [views, query, statusFilter, typeFilter]);

  const handleToggle = (server: McpServerConfig, checked: boolean): void => {
    void writeMcpServers(app, (servers) =>
      servers.map((entry) =>
        entry.id === server.id
          ? { ...entry, isActive: checked, updatedAt: new Date().toISOString() }
          : entry
      )
    ).catch((error) => {
      logError("[MCP] failed to toggle server", error);
      new Notice(t("Failed to save the MCP server configuration."));
    });
  };

  const handleReorder = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    void writeMcpServers(app, (servers) => {
      const from = servers.findIndex((server) => server.id === active.id);
      const to = servers.findIndex((server) => server.id === over.id);
      if (from === -1 || to === -1) return servers;
      const next = [...servers];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    }).catch((error) => {
      logError("[MCP] failed to reorder servers", error);
      new Notice(t("Failed to save the MCP server configuration."));
    });
  };

  const handleExport = async (): Promise<void> => {
    const servers = getSettings().mcp.servers;
    if (servers.length === 0) {
      new Notice(t("There are no MCP servers to export yet."));
      return;
    }
    try {
      await navigator.clipboard.writeText(exportMcpServersJson(servers));
      new Notice(t("Copied the MCP servers JSON to the clipboard."));
    } catch (error) {
      logError("[MCP] failed to export servers", error);
      new Notice(t("Failed to copy the MCP servers JSON."));
    }
  };

  const toggleTypeFilter = (type: string): void => {
    setTypeFilter((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  return (
    <div className="tw-relative tw-flex tw-flex-col tw-gap-4 tw-py-4">
      <div className="tw-flex tw-items-start tw-justify-between tw-gap-4">
        <div className="tw-flex tw-flex-col tw-gap-1">
          <div className="tw-text-base tw-font-semibold tw-text-normal">{t("MCP servers")}</div>
          <div className="tw-max-w-xl tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
            {t("Connect Model Context Protocol servers and offer their tools to Scribe's agent.")}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="tw-shrink-0">
              <Plus className="tw-size-4" />
              {t("Add server")}
              <ChevronDown className="tw-size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => new McpServerEditorModal(app, {}).open()}>
              {t("Quick create")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => new McpJsonImportModal(app, {}).open()}>
              <FileJson aria-hidden="true" />
              {t("Import from JSON")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void handleExport()}>
              <ClipboardCopy aria-hidden="true" />
              {t("Export as JSON")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <McpToolLoadingSetting
        mode={settings.agentMode.mcpToolLoading ?? "auto"}
        thresholdChars={settings.agentMode.mcpToolLoadingThresholdChars}
        onModeChange={setMcpToolLoadingMode}
        onThresholdChange={setMcpToolLoadingThresholdChars}
      />

      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
        <SegmentedControl<McpStatusFilter>
          options={[
            { label: t("All"), value: "all" },
            { label: t("Enabled"), value: "enabled" },
            { label: t("Disabled"), value: "disabled" },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
          aria-label={t("Filter servers by state")}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" className="tw-gap-1.5">
              {t("Filter")}
              {typeFilter.size > 0 && (
                <span className="tw-rounded-full tw-bg-secondary-alt tw-px-1.5 tw-text-xs">
                  {typeFilter.size}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {TYPE_FILTER_VALUES.map((type) => (
              <DropdownMenuItem key={type} onSelect={() => toggleTypeFilter(type)}>
                {typeFilter.has(type) ? (
                  <Check aria-hidden="true" />
                ) : (
                  <span className="tw-size-4" />
                )}
                {TYPE_LABELS[type as McpServerType]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="tw-min-w-52 tw-flex-1">
          <SearchBar value={query} onChange={setQuery} placeholder={t("Search MCP servers…")} />
        </div>
      </div>

      <McpServerList
        views={filtered}
        sensors={sensors}
        onEdit={(serverId) => new McpServerEditorModal(app, { serverId }).open()}
        onToggle={handleToggle}
        onReorder={handleReorder}
        emptyMessage={
          views.length === 0
            ? t("No MCP servers configured yet.")
            : t("No servers match the current filters.")
        }
      />
    </div>
  );
};

export interface McpServerListProps {
  views: readonly McpServerView[];
  sensors?: Parameters<typeof DndContext>[0]["sensors"];
  onEdit: (serverId: string) => void;
  onToggle: (server: McpServerConfig, checked: boolean) => void;
  onReorder: (event: DragEndEvent) => void;
  emptyMessage: string;
}

export const McpServerList: React.FC<McpServerListProps> = ({
  views,
  sensors,
  onEdit,
  onToggle,
  onReorder,
  emptyMessage,
}) => {
  if (views.length === 0) {
    return (
      <div className="tw-rounded-lg tw-border tw-border-solid tw-border-border tw-px-4 tw-py-8 tw-text-center tw-text-sm tw-text-muted">
        {emptyMessage}
      </div>
    );
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
      <SortableContext
        items={views.map(({ server }) => server.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-2 tw-p-0">
          {views.map((view) => (
            <SortableMcpServerRow
              key={view.server.id}
              view={view}
              onEdit={onEdit}
              onToggle={onToggle}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
};

interface SortableMcpServerRowProps {
  view: McpServerView;
  onEdit: (serverId: string) => void;
  onToggle: (server: McpServerConfig, checked: boolean) => void;
}

const SortableMcpServerRow: React.FC<SortableMcpServerRowProps> = ({ view, onEdit, onToggle }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: view.server.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "tw-relative tw-z-dragged-item tw-bg-secondary tw-shadow-lg")}
    >
      <McpServerRow
        server={view.server}
        state={view.state}
        onEdit={onEdit}
        onToggle={onToggle}
        dragHandle={
          <Button
            {...attributes}
            {...listeners}
            type="button"
            variant="ghost"
            size="icon"
            className="tw-cursor-grab"
            aria-label={t("Reorder {name}", { name: view.server.name })}
          >
            <GripVertical aria-hidden="true" className="tw-size-4" />
          </Button>
        }
      />
    </li>
  );
};

export interface McpServerRowProps {
  server: McpServerConfig;
  state?: { status: McpServerStatus; lastError?: string; version?: string };
  onEdit: (serverId: string) => void;
  onToggle: (server: McpServerConfig, checked: boolean) => void;
  dragHandle?: React.ReactNode;
}

export const McpServerRow: React.FC<McpServerRowProps> = ({
  server,
  state,
  onEdit,
  onToggle,
  dragHandle,
}) => {
  const dotColors: Record<McpServerStatus, string> = {
    connected: "tw-bg-success",
    connecting: "tw-bg-warning",
    error: "tw-bg-modifier-error",
    disabled: "tw-bg-[--background-modifier-border-hover]",
  };
  const status = state?.status ?? "disabled";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onEdit(server.id)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onEdit(server.id);
        }
      }}
      className={cn(
        "tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-px-2 tw-py-1.5",
        "hover:tw-bg-modifier-hover"
      )}
      title={status === "error" ? state?.lastError : undefined}
    >
      {dragHandle}
      <span
        aria-hidden="true"
        className={cn("tw-size-2 tw-shrink-0 tw-rounded-full", dotColors[status])}
      />
      <span
        className={cn(
          "tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm",
          server.isActive ? "tw-text-normal" : "tw-text-muted"
        )}
      >
        {server.name}
      </span>
      <span className="tw-shrink-0 tw-text-xs tw-text-muted">
        {status === "connected" && state?.version ? state.version : "—"}
      </span>
      <span className="tw-shrink-0 tw-rounded tw-bg-secondary-alt tw-px-1.5 tw-py-0.5 tw-font-mono tw-text-smallest tw-text-muted">
        {TYPE_LABELS[server.type]}
      </span>
      <span onClick={(event) => event.stopPropagation()}>
        <SettingSwitch
          checked={server.isActive}
          onCheckedChange={(checked) => onToggle(server, checked)}
          aria-label={t("Enable {name}", { name: server.name })}
        />
      </span>
    </div>
  );
};
