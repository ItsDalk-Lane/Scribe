import { t } from "@/lib/i18n";
import { availableBuiltinAgents } from "@/agentMode/skills/builtin/reconcileBuiltinSkills";
import { useBackendInstallStates } from "@/agentMode/session/useBackendInstallStates";
import { BUILTIN_SKILLS, builtinSkillUnavailableReason } from "@/builtinSkills/builtinSkills";
import { parseSkillFile } from "@/agentMode/skills/skillFormat";
import { BuiltinSkillsTable } from "./BuiltinSkillsTable";
import { formatSkillDisplayName } from "@/agentMode/skills/mergeDiscovery";
import {
  buildSkillRepairPrompt,
  type SkillRepairEvidence,
} from "@/agentMode/skills/skillRepairPrompt";
import { listBackendDescriptors } from "@/agentMode/backends/registry";
import type { AgentBrand } from "@/agentMode/session/types";
import type { AgentExtensionItem } from "@/agentMode/session/extensionInventory";
import { DeleteConfirmModal } from "./DeleteConfirmDialog";
import { EmptyPlaceholder } from "./EmptyPlaceholder";
import {
  AllSkillsNotLoaded,
  SkillLoadIssues,
  SkillLoadIssuesModal,
  type SkillLoadIssue,
} from "./SkillLoadIssues";
import {
  PropertiesModal,
  type PropertiesSaveOutcome,
  type PropertiesSaveRequest,
} from "./PropertiesDialog";
import {
  dismissEpermBanner,
  SkillManager,
  useEpermSeen,
  useManagedSkills,
  useRejectedSkills,
} from "@/agentMode/skills/SkillManager";
import { SkillRow } from "./SkillRow";
import { SkillEditorModal } from "./SkillEditorModal";
import { type Skill } from "@/agentMode/skills/types";
import { AgentConfigurationHeader } from "@/components/ui/AgentConfigurationHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deriveSkillsFolder } from "@/settings/copilotFolder";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { openVaultPath } from "@/utils/openVaultPath";
import { revealFolderInExplorer } from "@/utils/revealFolderInExplorer";
import { getVaultBase, toVaultRelative } from "@/utils/vaultPath";
import { useSettingsValue } from "@/settings/model";
import { AlertTriangle, Plus } from "lucide-react";
import { App, FileSystemAdapter, Notice, TFolder } from "obsidian";
import { useApp } from "@/context";
import { usePlugin } from "@/contexts/PluginContext";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SYNC_BRANDS: ReadonlyArray<{ substr: string; brand: string }> = [
  { substr: "onedrive", brand: "OneDrive" },
  { substr: "icloud", brand: "iCloud" },
  { substr: "dropbox", brand: "Dropbox" },
];

const BUILTIN_ROWS = BUILTIN_SKILLS.map((skill) => ({
  name: skill.name,
  description: parseSkillFile(skill.skillMd, skill.name).frontmatter.description,
  content: skill.skillMd,
}));

export interface SkillsSettingsProps {
  embedded?: boolean;
  query?: string;
  children?: React.ReactNode;
  runtimeItems?: readonly AgentExtensionItem[];
  checking?: boolean;
  onChanged?: () => Promise<void>;
}

export const SkillsSettings: React.FC<SkillsSettingsProps> = ({
  embedded = false,
  query,
  children,
  runtimeItems,
  checking,
  onChanged,
}) => {
  const app = useApp();
  const plugin = usePlugin();
  const settings = useSettingsValue();
  const skillsFolder = deriveSkillsFolder(settings);
  const descriptors = useMemo(() => listBackendDescriptors(), []);
  const agents = useMemo<ReadonlyArray<AgentBrand>>(
    () =>
      descriptors.map(({ id, displayName, Icon }) => ({
        id,
        displayName,
        Icon,
      })),
    [descriptors]
  );
  const skills = useManagedSkills();
  const rejectedSkills = useRejectedSkills();
  const epermSeen = useEpermSeen();

  const [localSearch, setSearchValue] = useState("");
  const searchValue = query ?? localSearch;
  const [refreshError, setRefreshError] = useState<string>();
  const userSkills = useMemo(() => skills.filter((skill) => !skill.builtin), [skills]);
  const installStates = useBackendInstallStates(plugin, descriptors);
  const lastAvailableAgents = useRef<readonly string[]>(
    skills.filter((skill) => skill.builtin).flatMap((skill) => skill.enabledAgents)
  );
  const availableAgents = availableBuiltinAgents(installStates, lastAvailableAgents.current);
  lastAvailableAgents.current = availableAgents;
  const unavailableReasons: Record<string, string> = {};
  for (const skill of BUILTIN_SKILLS) {
    const collision =
      userSkills.some(
        (userSkill) => userSkill.name === skill.name && userSkill.location.kind === "canonical"
      ) ||
      rejectedSkills.some(
        (rejected) =>
          toVaultRelative(rejected.dirPath, getVaultBase(app)) === `${skillsFolder}/${skill.name}`
      );
    const reason = collision
      ? t("A skill with this name already exists in Your skills. Your file is kept unchanged.")
      : builtinSkillUnavailableReason(skill.name);
    if (reason) unavailableReasons[skill.name] = reason;
  }
  const builtinRows = BUILTIN_ROWS.filter((skill) =>
    `${skill.name} ${skill.description}`.toLowerCase().includes(searchValue.trim().toLowerCase())
  ).map((skill) => ({
    ...skill,
    filePath: skills.find((managed) => managed.builtin && managed.name === skill.name)?.filePath,
  }));

  const containerRef = useRef<HTMLDivElement>(null);

  const [syncBannerDismissed, setSyncBannerDismissed] = useState(false);

  // Refresh on focus: fixing a hidden agent file in an external editor bypasses Obsidian's
  // watcher. https://github.com/Brevilabs/obsidian-copilot-private/issues/166
  useEffect(() => {
    const manager = SkillManager.getInstance();
    let active = true;
    const refresh = async () => {
      const result = await manager.refresh();
      if (active) {
        setRefreshError(
          result.reconcileError ??
            result.discoveryError ??
            (result.reconcileErrorCount > 0
              ? t("Some skill links could not be updated. Check folder permissions.")
              : undefined)
        );
      }
    };
    void refresh();
    const hostWindow = containerRef.current?.win;
    const handleFocus = (): void => {
      void refresh();
    };
    hostWindow?.addEventListener("focus", handleFocus);
    return () => {
      active = false;
      hostWindow?.removeEventListener("focus", handleFocus);
    };
  }, [skillsFolder]);

  const handleEditSkillMd = useCallback(
    (skill: Skill) => {
      new SkillEditorModal(app, {
        skill,
        onSave: async (_name, content) => {
          const result = await SkillManager.getInstance().saveContent(skill, content);
          if (result.ok) await onChanged?.();
          return result;
        },
      }).open();
    },
    [app, onChanged]
  );

  // Hidden agent folders are outside Obsidian's index, so they cannot use the vault reveal
  // path. https://github.com/Brevilabs/obsidian-copilot-private/issues/166
  const handleRevealSkillFolder = useCallback(
    (dirPath: string) => {
      const folderRel = toVaultRelative(dirPath, getVaultBase(app));
      if (app.vault.getAbstractFileByPath(folderRel) instanceof TFolder) {
        revealFolderInExplorer(app, folderRel);
        return;
      }
      void openWithSystemDefault(dirPath);
    },
    [app]
  );

  const handleFixWithAgent = useCallback(
    (issues: readonly SkillRepairEvidence[]): void => {
      (app as unknown as { setting: { close: () => void } }).setting.close();
      void plugin.newAgentChatWithDraft(buildSkillRepairPrompt(issues));
    },
    [app, plugin]
  );

  const loadIssues = useMemo<SkillLoadIssue[]>(() => {
    const vaultBase = getVaultBase(app);
    return rejectedSkills.map((skill) => {
      const folderRel = toVaultRelative(skill.dirPath, vaultBase);
      const indexed = app.vault.getAbstractFileByPath(folderRel) instanceof TFolder;
      const evidence: SkillRepairEvidence = {
        location: toVaultRelative(skill.filePath, vaultBase),
        reason: skill.reason,
        offendingText: skill.offendingText,
      };
      return {
        ...evidence,
        revealLabel: indexed ? "Reveal in vault" : "Show in folder",
        onFixWithAgent: () => handleFixWithAgent([evidence]),
        onOpen: () => openVaultPath(app, skill.filePath),
        onReveal: () => handleRevealSkillFolder(skill.dirPath),
      };
    });
  }, [app, handleFixWithAgent, handleRevealSkillFolder, rejectedSkills]);

  const filteredSkills = useMemo(
    () => filterSkills(userSkills, searchValue),
    [userSkills, searchValue]
  );

  const displayFolder = skillsFolder;

  const handleEditProperties = useCallback(
    (skill: Skill) => {
      new PropertiesModal(
        app,
        skill,
        displayFolder,
        async (req: PropertiesSaveRequest): Promise<PropertiesSaveOutcome> => {
          const manager = SkillManager.getInstance();
          const result = await manager.saveProperties(skill, {
            newName: req.nameChanged ? req.newName : undefined,
            patch: req.patch,
          });
          if (!result.ok) {
            if (result.code === "collision") return "collision";
            if (result.code === "invalid") {
              return "stay";
            }
            new Notice(
              t("Could not update {p0}: {p1}", {
                p0: req.nameChanged ? req.newName : skill.name,
                p1: result.message,
              })
            );
            return "stay";
          }
          await onChanged?.();
          return "close";
        }
      ).open();
    },
    [app, displayFolder, onChanged]
  );

  const handleAskDelete = useCallback(
    (skill: Skill) => {
      const manager = SkillManager.getInstance();
      new DeleteConfirmModal(
        app,
        skill,
        displayFolder,
        manager.getAgentDirsProjectRel(),
        async () => {
          const result = await manager.deleteSkill(skill);
          if (!result.ok) {
            new Notice(t("Failed to delete {p0}: {p1}", { p0: skill.name, p1: result.message }));
            return;
          }
          await onChanged?.();
        }
      ).open();
    },
    [app, displayFolder, onChanged]
  );

  const syncBrand = useMemo(() => detectSyncBrand(app), [app]);

  return (
    <div ref={containerRef} className="tw-space-y-4">
      <section>
        {!embedded && (
          <AgentConfigurationHeader
            agents={[{ id: "claude", label: "Claude Code" }]}
            selectedAgent="claude"
            query={searchValue}
            onQueryChange={setSearchValue}
            searchPlaceholder={t("Search skills…")}
            label={t("Skills")}
            count={userSkills.length}
          />
        )}

        {refreshError && (
          <div role="alert" className="tw-text-ui-smaller tw-text-error">
            {refreshError}
          </div>
        )}

        {(epermSeen || (syncBrand !== null && !syncBannerDismissed)) && (
          <div className="tw-mt-3 tw-flex tw-flex-col tw-gap-2">
            {epermSeen && <EpermBanner onDismiss={dismissEpermBanner} />}
            {syncBrand !== null && !syncBannerDismissed && (
              <SyncFolderBanner brand={syncBrand} onDismiss={() => setSyncBannerDismissed(true)} />
            )}
          </div>
        )}

        {loadIssues.length > 0 && (
          <div className="tw-mt-3">
            <SkillLoadIssues
              issues={loadIssues}
              onViewDetails={() =>
                new SkillLoadIssuesModal(app, loadIssues, () =>
                  handleFixWithAgent(loadIssues)
                ).open()
              }
            />
          </div>
        )}

        <div className="tw-group/extension-actions tw-mt-4 tw-flex tw-justify-end">
          <Button
            onClick={() =>
              new SkillEditorModal(app, {
                onSave: async (name, content) => {
                  const result = await SkillManager.getInstance().createSkill(name, content);
                  if (result.ok) await onChanged?.();
                  return result;
                },
              }).open()
            }
          >
            <Plus className="tw-mr-2 tw-size-4" />
            {t("New skill")}
          </Button>
        </div>

        <div className="tw-mt-4" role="region" aria-label={t("Your skills")}>
          <div
            role="heading"
            aria-level={3}
            className="tw-mb-3 tw-text-left tw-text-sm tw-font-semibold"
          >
            {t("Personally installed skills")}
          </div>
          {userSkills.length === 0 ? (
            // Rejected files prove skills exist; the empty state would claim there are none. https://github.com/Brevilabs/obsidian-copilot-private/issues/166
            rejectedSkills.length > 0 ? (
              <AllSkillsNotLoaded />
            ) : (
              <EmptyPlaceholder folder={displayFolder} />
            )
          ) : (
            <div className="tw-flex tw-flex-col tw-gap-1.5">
              {filteredSkills.length === 0 ? (
                <div className="tw-rounded-md tw-border tw-border-dashed tw-border-border tw-bg-transparent tw-px-3 tw-py-6 tw-text-center tw-text-ui-smaller tw-text-muted">
                  {t("No skills match “")}
                  {searchValue}
                  {t("”.")}
                </div>
              ) : (
                filteredSkills.map((skill) => (
                  <SkillRow
                    key={skill.dirPath}
                    skill={skill}
                    agents={agents}
                    agentDirsProjectRel={SkillManager.getInstance().getAgentDirsProjectRel()}
                    onEditSkillMd={() => handleEditSkillMd(skill)}
                    onEditProperties={() => handleEditProperties(skill)}
                    onRevealInVault={() => handleRevealSkillFolder(skill.dirPath)}
                    onDelete={() => handleAskDelete(skill)}
                    containerRef={containerRef}
                    runtimeItems={runtimeItems}
                    checking={checking}
                    onChanged={onChanged}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </section>
      <BuiltinSkillsTable
        skills={builtinRows}
        unavailableReasons={unavailableReasons}
        agents={agents}
        availableAgents={availableAgents}
        runtimeItems={runtimeItems}
        checking={checking}
      />
      {children}
    </div>
  );
};

const EpermBanner: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => {
  return (
    <div
      className={cn(
        "tw-flex tw-items-start tw-gap-2.5 tw-rounded-md tw-border tw-border-solid tw-border-warning/100",
        "tw-bg-callout-warning/20 tw-px-3.5 tw-py-2.5 tw-text-ui-smaller tw-text-warning"
      )}
      role="alert"
    >
      <AlertTriangle className="tw-mt-0.5 tw-size-4 tw-shrink-0" aria-hidden="true" />
      <div className="tw-flex-1">
        <span className="tw-block tw-font-semibold">
          {t("Turn on Windows Developer Mode to share skills with your agents.")}
        </span>
        <span className="tw-mt-0.5 tw-block tw-text-normal">
          {t(
            "Scribe shares a skill by adding a shortcut to each agent’s skills folder, and Windows allows that only for admins or with Developer Mode (Settings → Privacy & security → For developers). Until then, turning a skill on for an agent is saved, but the agent can’t see the skill."
          )}
        </span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        style={{ appearance: "none", border: 0, background: "transparent", padding: 0 }}
        className="tw-px-1 tw-text-faint hover:tw-text-normal"
        aria-label={t("Dismiss")}
      >
        ×
      </button>
    </div>
  );
};

const SyncFolderBanner: React.FC<{ brand: string; onDismiss: () => void }> = ({
  brand,
  onDismiss,
}) => {
  return (
    <div
      className={cn(
        "tw-flex tw-items-start tw-gap-2.5 tw-rounded-md tw-border tw-border-solid tw-border-blue/80",
        "tw-bg-blue-rgb/10 tw-px-3.5 tw-py-2.5 tw-text-ui-smaller tw-text-normal"
      )}
      role="status"
    >
      <div className="tw-flex-1">
        <span className="tw-block tw-font-semibold">
          {t("This vault is inside")}
          {brand}.
        </span>
        <span className="tw-mt-0.5 tw-block tw-text-muted">
          {t(
            "Sync can break the links Scribe uses to share skills with agents. If a skill disappears from an agent after a sync, turn it off and on again here."
          )}
        </span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        style={{ appearance: "none", border: 0, background: "transparent", padding: 0 }}
        className="tw-px-1 tw-text-faint hover:tw-text-normal"
        aria-label={t("Dismiss")}
      >
        ×
      </button>
    </div>
  );
};

function filterSkills(skills: Skill[], query: string): Skill[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return skills;
  return skills.filter(
    (s) =>
      formatSkillDisplayName(s).toLowerCase().includes(trimmed) ||
      s.description.toLowerCase().includes(trimmed)
  );
}

function detectSyncBrand(app: App): string | null {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  const base = adapter.getBasePath().toLowerCase();
  for (const { substr, brand } of SYNC_BRANDS) {
    if (base.includes(substr)) return brand;
  }
  return null;
}
