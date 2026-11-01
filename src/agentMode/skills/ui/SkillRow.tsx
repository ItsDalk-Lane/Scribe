import { t } from "@/lib/i18n";
import { SkillRowLayout } from "./SkillRowLayout";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Edit3, FolderSearch, MoreVertical, Move, Settings, Trash2 } from "lucide-react";
import { Notice, type App } from "obsidian";
import React from "react";
import type { AgentBrand, BackendId } from "@/agentMode/session/types";
import type { AgentExtensionItem } from "@/agentMode/session/extensionInventory";
import { getExtensionSwitchState } from "@/agentMode/session/extensionAvailability";
import { Button } from "@/components/ui/button";
import { ExtensionAvailabilitySwitch } from "@/components/ui/extension-availability-switch";
import { useApp } from "@/context";
import { logError } from "@/logger";
import { getEffectiveSkillsFolder } from "@/settings/copilotFolder";
import { SkillManager } from "@/agentMode/skills/SkillManager";
import { decideToggleAction } from "@/agentMode/skills/toggleDecision";
import { formatSkillDisplayName } from "@/agentMode/skills/mergeDiscovery";
import type { Skill } from "@/agentMode/skills/types";
import {
  MigrateSkillConfirmModal,
  type MigrateActionLine,
  type MigrateConfirmVariant,
} from "./MigrateSkillConfirmModal";
import { skillRuntimeItem } from "./skillRuntimeItem";

interface SkillRowProps {
  skill: Skill;
  agents: ReadonlyArray<AgentBrand>;
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  onEditSkillMd?: () => void;
  onEditProperties?: () => void;
  onRevealInVault?: () => void;
  onDelete?: () => void;
  containerRef: React.RefObject<HTMLDivElement>;
  runtimeItems?: readonly AgentExtensionItem[];
  checking?: boolean;
  onChanged?: () => Promise<void>;
}

export const SkillRow: React.FC<SkillRowProps> = ({
  skill,
  agents,
  agentDirsProjectRel,
  onEditSkillMd,
  onEditProperties,
  onRevealInVault,
  onDelete,
  containerRef,
  runtimeItems,
  checking,
  onChanged,
}) => {
  const app = useApp();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const displayName = formatSkillDisplayName(skill);
  const locationLabel = buildLocationLabel(skill, agentDirsProjectRel);

  const lockdownCount = skill.location.kind === "project" ? skill.location.agentDirs.length : 0;
  const mirroredLockdown = lockdownCount >= 2;
  const lockdownTooltip = mirroredLockdown
    ? t("This skill is duplicated in {p0} agent folders. ", { p0: lockdownCount }) +
      t("Editing one copy would silently diverge from the others. ") +
      t("Migrate it to your shared folder first to enable edits.")
    : null;

  const handleToggleAgent = React.useCallback(
    async (agent: BackendId, willBeEnabled: boolean): Promise<void> => {
      setBusy(true);
      try {
        const manager = SkillManager.getInstance();
        const decision = decideToggleAction(skill, agent, willBeEnabled);
        switch (decision.kind) {
          case "no-op":
            return;
          case "canonical-toggle": {
            const result = await manager.toggleAgent(skill, agent, decision.enabled);
            if (!result.ok && result.code !== "eperm") {
              new Notice(
                t("Could not {p0} {p1}: {p2}", {
                  p0: decision.enabled ? t("enable") : t("disable"),
                  p1: agent,
                  p2: result.message,
                })
              );
              return;
            }
            await onChanged?.();
            return;
          }
          case "mirrored-remove-one": {
            const result = await manager.removeProjectAgentDir(skill, decision.agent);
            if (!result.ok) {
              new Notice(
                t("Could not remove {p0} from {p1}: {p2}", {
                  p0: skill.name,
                  p1: decision.agent,
                  p2: result.message,
                })
              );
              return;
            }
            const survivors = (
              skill.location.kind === "project" ? skill.location.agentDirs : []
            ).filter((a) => a !== decision.agent);
            const survivorLabel = survivors.length === 1 ? survivors[0] : survivors.join(", ");
            new Notice(
              t("Removed {p0} from {p1} project folder; still active in {p2}.", {
                p0: skill.name,
                p1: decision.agent,
                p2: survivorLabel,
              })
            );
            await onChanged?.();
            return;
          }
          case "migrate-confirm": {
            await runMigration({
              app,
              skill,
              agentDirsProjectRel,
              variant: decision.variant,
              targetAgent: decision.targetAgent,
              targetAgentDisplayName: agentDisplayName(agents, decision.targetAgent),
              action: decision.action,
              onChanged,
            });
            return;
          }
          default: {
            const _exhaustive: never = decision;
            void _exhaustive;
            return;
          }
        }
      } catch (error) {
        logError("Could not update skill availability", error);
        new Notice(error instanceof Error ? error.message : t("Could not save configuration."));
      } finally {
        setBusy(false);
      }
    },
    [agents, agentDirsProjectRel, app, onChanged, skill]
  );

  const handleProactiveConsolidate = React.useCallback(() => {
    void runProactiveConsolidate({
      app,
      skill,
      agentDirsProjectRel,
      onChanged,
    });
  }, [agentDirsProjectRel, app, onChanged, skill]);

  return (
    <SkillRowLayout
      name={displayName}
      description={skill.description}
      menuOpen={menuOpen}
      onOpen={mirroredLockdown ? undefined : onEditSkillMd}
      annotations={
        <>
          {locationLabel !== null && (
            <span className="tw-truncate tw-text-ui-smaller tw-text-faint">{locationLabel}</span>
          )}
        </>
      }
      controls={
        <div className="tw-flex tw-items-center tw-gap-1.5">
          {agents.map((agent) => {
            const item = skillRuntimeItem(skill, agent.id, runtimeItems);
            return (
              <ExtensionAvailabilitySwitch
                key={agent.id}
                label={t("Enable {name}", { name: skill.name })}
                state={getExtensionSwitchState(item, checking)}
                busy={busy}
                onToggle={(next) => {
                  void handleToggleAgent(agent.id, next);
                }}
              />
            );
          })}
        </div>
      }
      actions={
        // Non-modal: a modal menu can strand Radix's wheel listener after Reveal in vault.
        // https://github.com/logancyang/obsidian-copilot-preview/issues/118
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              title={t("More actions")}
              aria-label={t("More actions for {p0}", { p0: skill.name })}
            >
              <MoreVertical className="tw-size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="tw-min-w-[180px]"
            container={containerRef.current}
          >
            {mirroredLockdown ? (
              <MirroredLockdownMenu
                tooltip={lockdownTooltip ?? ""}
                onMigrate={handleProactiveConsolidate}
                onRevealInVault={onRevealInVault}
              />
            ) : (
              <>
                <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onEditSkillMd}>
                  <Edit3 className="tw-size-3.5" aria-hidden="true" />

                  {t("Edit SKILL.md")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="tw-gap-2.5 tw-text-ui-small"
                  onSelect={onEditProperties}
                >
                  <Settings className="tw-size-3.5" aria-hidden="true" />

                  {t("Properties…")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="tw-gap-2.5 tw-text-ui-small"
                  onSelect={onRevealInVault}
                >
                  <FolderSearch className="tw-size-3.5" aria-hidden="true" />

                  {t("Reveal in vault")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="tw-gap-2.5 tw-text-ui-small tw-text-error focus:tw-bg-modifier-error-rgb/15 focus:tw-text-error"
                  onSelect={onDelete}
                >
                  <Trash2 className="tw-size-3.5" aria-hidden="true" />

                  {t("Delete…")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
};

function buildLocationLabel(
  skill: Skill,
  agentDirsProjectRel: Readonly<Record<BackendId, string>>
): string | null {
  if (skill.location.kind !== "project") return null;
  const dirs = skill.location.agentDirs;
  if (dirs.length === 0) return null;
  if (dirs.length === 1) {
    const rel = agentDirsProjectRel[dirs[0]];
    return rel !== undefined ? t("in {p0}", { p0: rel }) : null;
  }
  const parents = dirs
    .map((id) => agentDirsProjectRel[id])
    .filter((p): p is string => typeof p === "string")
    .map(parentDotFolder);
  if (parents.length === 0) return null;
  return t("mirrored in {p0}", { p0: parents.join(", ") });
}

function parentDotFolder(rel: string): string {
  const trimmed = rel.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(0, idx);
}

function agentDisplayName(agents: ReadonlyArray<AgentBrand>, id: BackendId): string {
  return agents.find((a) => a.id === id)?.displayName ?? id;
}

const MirroredLockdownMenu: React.FC<{
  tooltip: string;
  onMigrate: () => void;
  onRevealInVault?: () => void;
}> = ({ tooltip, onMigrate, onRevealInVault }) => {
  const mutedClass = cn(
    "tw-cursor-not-allowed tw-gap-2.5 tw-text-ui-small tw-text-faint",
    "data-[highlighted]:tw-bg-transparent data-[highlighted]:tw-text-faint"
  );
  return (
    <TooltipProvider delayDuration={120}>
      <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onMigrate}>
        <Move className="tw-size-3.5" aria-hidden="true" />

        {t("Migrate to shared folder")}
      </DropdownMenuItem>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuItem
            className={mutedClass}
            aria-disabled="true"
            onSelect={(e) => e.preventDefault()}
          >
            <Edit3 className="tw-size-3.5" aria-hidden="true" />

            {t("Edit SKILL.md")}
          </DropdownMenuItem>
        </TooltipTrigger>
        <TooltipContent side="left">{tooltip}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuItem
            className={mutedClass}
            aria-disabled="true"
            onSelect={(e) => e.preventDefault()}
          >
            <Settings className="tw-size-3.5" aria-hidden="true" />

            {t("Properties…")}
          </DropdownMenuItem>
        </TooltipTrigger>
        <TooltipContent side="left">{tooltip}</TooltipContent>
      </Tooltip>
      <DropdownMenuItem className="tw-gap-2.5 tw-text-ui-small" onSelect={onRevealInVault}>
        <FolderSearch className="tw-size-3.5" aria-hidden="true" />

        {t("Reveal in vault")}
      </DropdownMenuItem>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuItem
            className={cn(mutedClass, "tw-text-error/60")}
            aria-disabled="true"
            onSelect={(e) => e.preventDefault()}
          >
            <Trash2 className="tw-size-3.5" aria-hidden="true" />

            {t("Delete…")}
          </DropdownMenuItem>
        </TooltipTrigger>
        <TooltipContent side="left">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

interface RunMigrationArgs {
  app: App;
  skill: Skill;
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  variant: MigrateConfirmVariant;
  targetAgent: BackendId;
  targetAgentDisplayName: string;
  action: "expandToNewAgent" | "disableLastAgent";
  onChanged?: () => Promise<void>;
}

function runMigration(args: RunMigrationArgs): Promise<void> {
  const manager = SkillManager.getInstance();
  const canonicalFolderRel = resolveCanonicalSkillsFolderRel();
  let resolvedName: string;
  try {
    resolvedName = manager.resolveCanonicalNameForMigration(args.skill.name);
  } catch (err) {
    new Notice(
      t("Could not migrate {p0}: {p1}", {
        p0: args.skill.name,
        p1: err instanceof Error ? err.message : String(err),
      })
    );
    return Promise.resolve();
  }
  const lines = buildToggleMigrationActionLines({
    skill: args.skill,
    canonicalFolderRel,
    agentDirsProjectRel: args.agentDirsProjectRel,
    targetAgent: args.targetAgent,
    resolvedName,
    variant: args.variant,
  });
  const duplicates = args.skill.location.kind === "project" ? args.skill.location.agentDirs : [];

  const commit = async (suppressFuture: boolean): Promise<void> => {
    if (suppressFuture) manager.setSuppressMigrationConfirm(true);
    const result = await manager.migrateProjectSkillForToggle(
      args.skill,
      args.action === "expandToNewAgent" ? args.targetAgent : null,
      args.action
    );
    if (!result.ok && result.reason !== "eperm") {
      new Notice(t("Could not migrate {p0}: {p1}", { p0: args.skill.name, p1: result.reason }));
      return;
    }
    await args.onChanged?.();
    if (args.action === "expandToNewAgent") {
      new Notice(
        t("Moved {p0} to {p1}/ and enabled {p2}.", {
          p0: args.skill.name,
          p1: canonicalFolderRel,
          p2: args.targetAgentDisplayName,
        })
      );
    } else {
      new Notice(
        t("Moved {p0} to {p1}/ and disabled {p2}.", {
          p0: args.skill.name,
          p1: canonicalFolderRel,
          p2: args.targetAgentDisplayName,
        })
      );
    }
  };

  if (manager.getSuppressMigrationConfirm()) {
    return commit(false).catch((err) => {
      logError("Suppressed migration commit failed", err);
    });
  }

  const duplicatePathStrings =
    args.variant === "project-mirrored" || args.variant === "disable-last-agent"
      ? duplicates
          .map((agent) => {
            const dir = args.agentDirsProjectRel[agent];
            return dir === undefined ? null : `<vault>/${dir}/${args.skill.name}/`;
          })
          .filter((p): p is string => p !== null)
      : [];

  new MigrateSkillConfirmModal(args.app, {
    variant: args.variant,
    skill: args.skill,
    targetAgent: args.targetAgent,
    targetAgentDisplayName: args.targetAgentDisplayName,
    resolvedCanonicalName: resolvedName,
    sourceDuplicatePaths: duplicatePathStrings,
    actionLines: lines,
    onConfirm: commit,
  }).open();
  return Promise.resolve();
}

interface RunProactiveConsolidateArgs {
  app: App;
  skill: Skill;
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  onChanged?: () => Promise<void>;
}

function runProactiveConsolidate(args: RunProactiveConsolidateArgs): Promise<void> {
  if (args.skill.location.kind !== "project" || args.skill.location.agentDirs.length < 2) {
    return Promise.resolve();
  }
  const manager = SkillManager.getInstance();
  const canonicalFolderRel = resolveCanonicalSkillsFolderRel();
  let resolvedName: string;
  try {
    resolvedName = manager.resolveCanonicalNameForMigration(args.skill.name);
  } catch (err) {
    new Notice(
      t("Could not merge {p0}: {p1}", {
        p0: args.skill.name,
        p1: err instanceof Error ? err.message : String(err),
      })
    );
    return Promise.resolve();
  }
  const lines = buildConsolidateActionLines({
    skill: args.skill,
    canonicalFolderRel,
    agentDirsProjectRel: args.agentDirsProjectRel,
    resolvedName,
  });
  const duplicatePathStrings = args.skill.location.agentDirs
    .map((agent) => {
      const dir = args.agentDirsProjectRel[agent];
      return dir === undefined ? null : `<vault>/${dir}/${args.skill.name}/`;
    })
    .filter((p): p is string => p !== null);

  const commit = async (suppressFuture: boolean): Promise<void> => {
    const result = await manager.consolidateMirroredSkill(args.skill, suppressFuture);
    if (!result.ok && result.reason !== "eperm") {
      new Notice(t("Could not merge {p0}: {p1}", { p0: args.skill.name, p1: result.reason }));
      return;
    }
    await args.onChanged?.();
    new Notice(t("Merged {p0} into {p1}/.", { p0: args.skill.name, p1: canonicalFolderRel }));
  };

  if (manager.getSuppressMigrationConfirm()) {
    return commit(false).catch((err) => {
      logError("Suppressed consolidate failed", err);
    });
  }

  new MigrateSkillConfirmModal(args.app, {
    variant: "proactive-consolidate",
    skill: args.skill,
    targetAgent: null,
    resolvedCanonicalName: resolvedName,
    sourceDuplicatePaths: duplicatePathStrings,
    actionLines: lines,
    onConfirm: commit,
  }).open();
  return Promise.resolve();
}

interface BuildLinesArgs {
  skill: Skill;
  canonicalFolderRel: string;
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  targetAgent: BackendId;
  resolvedName: string;
  variant: MigrateConfirmVariant;
}

function buildToggleMigrationActionLines(args: BuildLinesArgs): MigrateActionLine[] {
  const { skill, canonicalFolderRel, agentDirsProjectRel, targetAgent, resolvedName, variant } =
    args;
  const out: MigrateActionLine[] = [];
  if (skill.location.kind !== "project") return out;
  const sourceDirs = skill.location.agentDirs;
  const repAgent = sourceDirs[0];
  const repDir = agentDirsProjectRel[repAgent];
  if (repDir === undefined) return out;

  const canonicalDest = `<vault>/${canonicalFolderRel}/${resolvedName}/`;

  out.push({
    verb: "Move",
    detail: `<vault>/${repDir}/${skill.name}/   →   ${canonicalDest}`,
  });

  for (const agent of sourceDirs.slice(1)) {
    const dir = agentDirsProjectRel[agent];
    if (dir === undefined) continue;
    out.push({
      verb: t("Delete"),
      detail: `<vault>/${dir}/${skill.name}/`,
      note: t("(identical duplicate)"),
    });
  }

  if (variant === "disable-last-agent") {
    out.push({
      verb: t("Not create"),
      detail: t("any shortcuts (no agents enabled)."),
    });
    return out;
  }

  const finalAgents = sourceDirs.includes(targetAgent) ? sourceDirs : [...sourceDirs, targetAgent];
  for (const agent of finalAgents) {
    const dir = agentDirsProjectRel[agent];
    if (dir === undefined) continue;
    out.push({
      verb: "Create",
      detail: `<vault>/${dir}/${resolvedName}`,
      note: t("(shortcut to the new location)"),
    });
  }
  return out;
}

interface BuildConsolidateLinesArgs {
  skill: Skill;
  canonicalFolderRel: string;
  agentDirsProjectRel: Readonly<Record<BackendId, string>>;
  resolvedName: string;
}

function buildConsolidateActionLines(args: BuildConsolidateLinesArgs): MigrateActionLine[] {
  const { skill, canonicalFolderRel, agentDirsProjectRel, resolvedName } = args;
  if (skill.location.kind !== "project") return [];
  const sourceDirs = skill.location.agentDirs;
  const out: MigrateActionLine[] = [];
  const repAgent = sourceDirs[0];
  const repDir = agentDirsProjectRel[repAgent];
  if (repDir === undefined) return [];

  out.push({
    verb: "Move",
    detail: `<vault>/${repDir}/${skill.name}/   →   <vault>/${canonicalFolderRel}/${resolvedName}/`,
  });
  for (const agent of sourceDirs.slice(1)) {
    const dir = agentDirsProjectRel[agent];
    if (dir === undefined) continue;
    out.push({
      verb: t("Delete"),
      detail: `<vault>/${dir}/${skill.name}/`,
      note: t("(identical duplicate)"),
    });
  }
  for (const agent of sourceDirs) {
    const dir = agentDirsProjectRel[agent];
    if (dir === undefined) continue;
    out.push({
      verb: "Create",
      detail: `<vault>/${dir}/${resolvedName}`,
      note: t("(shortcut to the new location)"),
    });
  }
  return out;
}

function resolveCanonicalSkillsFolderRel(): string {
  return getEffectiveSkillsFolder();
}
