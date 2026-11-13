import React from "react";
import { SettingItem } from "@/components/ui/setting-item";
import { t } from "@/lib/i18n";

interface SearchChoice {
  label: string;
  value: string;
}

export interface WebSearchSourceSettingProps {
  preferred: string;
  mcp: string;
  skill: string;
  mcpOptions: readonly SearchChoice[];
  skillOptions: readonly SearchChoice[];
  onPreferredChange: (value: string) => void;
  onMcpChange: (value: string) => void;
  onSkillChange: (value: string) => void;
}

const SOURCES = [
  { label: "Built-in search", value: "builtin" },
  { label: "MCP search", value: "mcp" },
  { label: "Skill search", value: "skill" },
];

function choices(options: readonly SearchChoice[], selected: string): SearchChoice[] {
  return [
    { label: t("Not configured"), value: "" },
    ...options,
    ...(selected && !options.some(({ value }) => value === selected)
      ? [{ label: t("Search source unavailable"), value: selected }]
      : []),
  ];
}

export function WebSearchSourceSetting(props: WebSearchSourceSettingProps) {
  return (
    <>
      <SettingItem
        type="select"
        title={t("Preferred web search source")}
        description={t(
          "Other configured sources are tried only when the previous source reports a failure."
        )}
        value={props.preferred}
        options={SOURCES.map(({ label, value }) => ({ label: t(label), value }))}
        onChange={props.onPreferredChange}
      />
      <SettingItem
        type="select"
        title={t("MCP search tool")}
        description={t("Choose a connected MCP tool and the field that accepts the search query.")}
        value={props.mcp}
        options={choices(props.mcpOptions, props.mcp)}
        onChange={props.onMcpChange}
      />
      <SettingItem
        type="select"
        title={t("Search skill")}
        description={t(
          "Choose an enabled skill that declares a search command. Use scripts you trust."
        )}
        value={props.skill}
        options={choices(props.skillOptions, props.skill)}
        onChange={props.onSkillChange}
      />
    </>
  );
}
