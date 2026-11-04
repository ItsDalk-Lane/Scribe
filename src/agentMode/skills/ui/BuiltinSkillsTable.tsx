import { t } from "@/lib/i18n";
import type { AgentBrand, BackendId } from "@/agentMode/session/types";
import type { AgentExtensionItem } from "@/agentMode/session/extensionInventory";
import { getExtensionSwitchState } from "@/agentMode/session/extensionAvailability";
import React from "react";
import { ExtensionAvailabilitySwitch } from "@/components/ui/extension-availability-switch";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import { SkillRowLayout } from "./SkillRowLayout";
import { sameSkillPath } from "./skillRuntimeItem";

export interface BuiltinSkillRow {
  name: string;
  description: string;
  content: string;
  filePath?: string;
}

export interface BuiltinSkillsTableProps {
  skills: readonly BuiltinSkillRow[];
  unavailableReasons?: Readonly<Record<string, string>>;
  agents: readonly AgentBrand[];
  availableAgents: readonly BackendId[];
  runtimeItems?: readonly AgentExtensionItem[];
  checking?: boolean;
  error?: string;
  isEnabled?: (name: string, agent: string) => boolean;
  onToggle?: (name: string, agent: string, enabled: boolean) => Promise<void>;
}

export function BuiltinSkillsTable({
  skills,
  unavailableReasons,
  agents,
  availableAgents,
  runtimeItems,
  checking,
  error,
  isEnabled,
  onToggle,
}: BuiltinSkillsTableProps) {
  return (
    <section aria-label={t("Built-in skills")} className="tw-group/settings tw-space-y-3">
      <div role="heading" aria-level={3} className="tw-text-left tw-text-sm tw-font-semibold">
        {t("Built-in skills")}
      </div>
      {error && (
        <div role="alert" className="tw-text-ui-smaller tw-text-error">
          {error}
        </div>
      )}
      <div className="tw-space-y-1.5">
        {skills.map((skill) => (
          <BuiltinSkillItem
            key={skill.name}
            skill={skill}
            unavailableReason={unavailableReasons?.[skill.name]}
            available={agents.some((agent) => availableAgents.includes(agent.id))}
            agents={agents}
            runtimeItems={runtimeItems}
            checking={checking}
            isEnabled={isEnabled}
            onToggle={onToggle}
          />
        ))}
        {skills.length === 0 && (
          <p className="tw-text-ui-smaller tw-text-muted">
            {t("No built-in skills match your search.")}
          </p>
        )}
      </div>
    </section>
  );
}

interface BuiltinSkillItemProps {
  skill: BuiltinSkillRow;
  unavailableReason?: string;
  available: boolean;
  agents: readonly AgentBrand[];
  runtimeItems?: readonly AgentExtensionItem[];
  checking?: boolean;
  isEnabled?: (name: string, agent: string) => boolean;
  onToggle?: (name: string, agent: string, enabled: boolean) => Promise<void>;
}

const BuiltinSkillItem = React.memo(function BuiltinSkillItem({
  skill,
  unavailableReason,
  available,
  agents,
  runtimeItems,
  checking,
  isEnabled,
  onToggle,
}: BuiltinSkillItemProps) {
  const enabledFor = (agent: string): boolean => isEnabled?.(skill.name, agent) ?? true;
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const matches = runtimeItems?.filter(
    (item) =>
      !item.parentPluginId &&
      (item.runtimeName ?? item.name) === skill.name &&
      (skill.filePath
        ? sameSkillPath(item.location ?? item.target?.path, skill.filePath)
        : !item.location && !item.target?.path)
  );
  const observed = matches?.length === 1 ? matches[0] : undefined;
  const reason =
    unavailableReason ?? (!available ? t("Configure a chat model to use this skill.") : undefined);
  const itemFor = (agent: string): AgentExtensionItem => {
    const enabled = enabledFor(agent);
    return {
      ...observed,
      id: `builtin:${skill.name}`,
      name: skill.name,
      kind: "skill",
      source: "project",
      builtin: !onToggle,
      readOnly: !onToggle,
      availability: reason
        ? "disabled"
        : onToggle
          ? enabled
            ? (observed?.availability ?? "manual_only")
            : "disabled"
          : observed?.availability,
      unavailableReason: reason,
      canEnable: !enabled,
      canDisable: enabled,
      capabilities: { edit: false, delete: false, toggle: Boolean(onToggle) },
    };
  };
  return (
    <div>
      <SkillRowLayout
        name={skill.name}
        description={skill.description}
        controls={
          <div className="tw-flex tw-items-center tw-gap-1.5">
            {agents.map((agent) => (
              <ExtensionAvailabilitySwitch
                key={agent.id}
                label={t("Enable {name}", { name: skill.name })}
                state={getExtensionSwitchState(itemFor(agent.id), checking)}
                onToggle={
                  onToggle ? (next) => void onToggle(skill.name, agent.id, next) : undefined
                }
              />
            ))}
          </div>
        }
        actions={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPreviewOpen(!previewOpen)}
            aria-label={t("View {p0} (read-only)", { p0: skill.name })}
          >
            <Eye className="tw-size-4" />
          </Button>
        }
      />
      {previewOpen && (
        <pre
          aria-label={t("{p0} content (read-only)", { p0: skill.name })}
          className="tw-max-h-80 tw-overflow-auto tw-whitespace-pre-wrap tw-break-all tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-transparent tw-p-3 tw-text-ui-smaller tw-leading-relaxed"
        >
          {skill.content}
        </pre>
      )}
    </div>
  );
});
