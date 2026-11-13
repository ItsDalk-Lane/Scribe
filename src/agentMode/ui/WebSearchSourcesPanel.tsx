import React from "react";
import { getMcpServerManager } from "@/agentMode/mcp/McpServerManager";
import { useManagedSkills } from "@/agentMode/skills/SkillManager";
import { useMcpServerViews } from "@/agentMode/ui/mcp/mcpUiState";
import { useApp } from "@/context";
import { setSettings, useSettingsValue } from "@/settings/model";
import { WebSearchSourceSetting } from "@/settings/v2/components/ui/WebSearchSourceSetting";
import type { WebSearchSettings } from "@/settings/webSearchProvider";
import { isRecord } from "@/utils/obsidianInternals";

const DEFAULT_WEB_SEARCH: WebSearchSettings = Object.freeze({ preferred: "builtin" });

function updateWebSearch(update: Partial<WebSearchSettings>) {
  setSettings(({ agentMode, mcp }) => {
    const nextAgentMode = {
      ...agentMode,
      webSearch: { ...(agentMode.webSearch ?? DEFAULT_WEB_SEARCH), ...update },
    };
    if (!Object.hasOwn(update, "mcp")) return { agentMode: nextAgentMode };
    const reserved = [agentMode.webSearch?.mcp, update.mcp];
    // 更换搜索来源时清除原有直调授权，避免旧授权在取消选择后复活。https://github.com/ItsDalk-Lane/Scribe/issues/70
    const servers = mcp.servers.map((entry) => {
      if (!entry.directToolApprovals) return entry;
      const remaining = Object.entries(entry.directToolApprovals).filter(
        ([name]) =>
          !reserved.some((target) => target?.serverId === entry.id && target.toolName === name)
      );
      return remaining.length === Object.keys(entry.directToolApprovals).length
        ? entry
        : {
            ...entry,
            directToolApprovals: remaining.length ? Object.fromEntries(remaining) : undefined,
          };
    });
    return {
      agentMode: nextAgentMode,
      ...(servers.some((entry, index) => entry !== mcp.servers[index]) && {
        mcp: { ...mcp, servers },
      }),
    };
  });
}

export function WebSearchSourcesPanel() {
  const app = useApp();
  const settings = useSettingsValue();
  const search = settings.agentMode.webSearch ?? DEFAULT_WEB_SEARCH;
  const skills = useManagedSkills();
  const servers = useMcpServerViews(settings.mcp.servers);
  const manager = getMcpServerManager(app);
  const mcpOptions = servers.flatMap(({ server, state }) => {
    if (!server.isActive || state.status !== "connected") return [];
    return (manager?.getTools(server.id) ?? []).flatMap((tool) => {
      if (server.disabledTools?.includes(tool.name) || !isRecord(tool.inputSchema?.properties))
        return [];
      const required = tool.inputSchema.required;
      return Object.entries(tool.inputSchema.properties)
        .filter(
          ([name, schema]) =>
            isRecord(schema) &&
            schema.type === "string" &&
            (!Array.isArray(required) || required.every((field) => field === name))
        )
        .map(([queryParameter]) => {
          const selection = { serverId: server.id, toolName: tool.name, queryParameter };
          return {
            value: JSON.stringify(selection),
            label: `${server.name} / ${tool.name} · ${queryParameter}`,
            selection,
          };
        });
    });
  });

  return (
    <WebSearchSourceSetting
      preferred={search.preferred}
      mcp={search.mcp ? JSON.stringify(search.mcp) : ""}
      skill={search.skill ?? ""}
      mcpOptions={mcpOptions}
      skillOptions={skills
        .filter(
          (skill) =>
            skill.webSearchCommand &&
            skill.location.kind === "canonical" &&
            skill.enabledAgents.includes("native") &&
            !skill.disableModelInvocation
        )
        .map((skill) => ({ value: skill.name, label: skill.name }))}
      onPreferredChange={(preferred) =>
        updateWebSearch({
          preferred: preferred === "mcp" || preferred === "skill" ? preferred : "builtin",
        })
      }
      onMcpChange={(value) =>
        updateWebSearch({ mcp: mcpOptions.find((option) => option.value === value)?.selection })
      }
      onSkillChange={(value) => updateWebSearch({ skill: value || undefined })}
    />
  );
}
