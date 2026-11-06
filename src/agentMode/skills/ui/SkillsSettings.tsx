import React from "react";
import { Notice } from "obsidian";
import type { AgentExtensionItem } from "@/agentMode/session/extensionInventory";
import {
  SkillManager,
  getManagedSkills,
  useManagedSkills,
  useRejectedSkills,
} from "@/agentMode/skills/SkillManager";
import { buildSkillRepairPrompt } from "@/agentMode/skills/skillRepairPrompt";
import { SKILL_CREATOR_SKILL_NAME } from "@/agentMode/skills/builtinSkills";
import { pickSkillImport } from "@/agentMode/skills/pickSkillImport";
import { readSkillPackage } from "@/agentMode/skills/skillImport";
import type { Skill, RejectedSkill } from "@/agentMode/skills/types";
import { SkillDetails, clearSkillEditorDraft } from "@/agentMode/skills/ui/SkillDetails";
import { SkillModal } from "@/agentMode/skills/ui/SkillModal";
import { SkillRow } from "@/agentMode/skills/ui/SkillRow";
import {
  confirmSkillAction,
  confirmSkillPackage,
  LocalSkillImportView,
  SystemSkillSearch,
  BuiltinSkillRecovery,
} from "@/agentMode/skills/ui/SkillImportDialogs";
import { EmptyPlaceholder } from "@/agentMode/skills/ui/EmptyPlaceholder";
import { AgentConfigurationHeader } from "@/components/ui/AgentConfigurationHeader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/context";
import { usePlugin } from "@/contexts/PluginContext";
import { t } from "@/lib/i18n";
import { getEffectiveSkillsFolder } from "@/settings/scribeFolder";
import { getVaultBase, toVaultRelative } from "@/utils/vaultPath";
import { Plus, RotateCcw } from "lucide-react";

export interface SkillsSettingsProps {
  embedded?: boolean;
  query?: string;
  children?: React.ReactNode;
  runtimeItems?: readonly AgentExtensionItem[];
  checking?: boolean;
  onChanged?: () => Promise<void>;
}

export function SkillsSettings({
  embedded = false,
  query,
  children,
  onChanged,
}: SkillsSettingsProps) {
  const app = useApp();
  const plugin = usePlugin();
  const skills = useManagedSkills();
  const rejected = useRejectedSkills();
  const [localSearch, setLocalSearch] = React.useState("");
  const [selectedSkill, setSelectedSkill] = React.useState<Skill | RejectedSkill>();
  const selectedSkillRef = React.useRef<Skill | RejectedSkill>();
  const selectSkill = (skill: Skill | RejectedSkill | undefined) => {
    selectedSkillRef.current = skill;
    setSelectedSkill(skill);
  };
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [builtinAttention, setBuiltinAttention] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const lifecycle = React.useRef<AbortController | null>(null);
  const refresh = React.useCallback(async () => {
    if (!SkillManager.hasInstance()) return;
    const manager = SkillManager.getInstance();
    const result = await manager.refresh(true);
    if (lifecycle.current?.signal.aborted) return;
    setError(
      result.ok
        ? undefined
        : t("Could not refresh skills: {reason}", {
            reason: result.discoveryError ?? t("Please try again."),
          })
    );
    try {
      const statuses = await manager.getBuiltinStatuses();
      if (!lifecycle.current?.signal.aborted)
        setBuiltinAttention(
          statuses.some((item) => item.status !== "installed" && item.status !== "uninstalled")
        );
    } catch {
      if (!lifecycle.current?.signal.aborted) setBuiltinAttention(true);
    }
  }, []);
  React.useEffect(() => {
    lifecycle.current = new AbortController();
    void refresh();
    const hostWindow = containerRef.current?.ownerDocument.defaultView;
    const focused = () => {
      void refresh();
    };
    hostWindow?.addEventListener("focus", focused);
    return () => {
      lifecycle.current?.abort();
      hostWindow?.removeEventListener("focus", focused);
    };
  }, [refresh]);
  const changed = async () => {
    await onChanged?.();
    await refresh();
  };
  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      if (!lifecycle.current?.signal.aborted)
        setError(
          t("Could not update skills: {reason}", {
            reason: failure instanceof Error ? t(failure.message) : t("Please try again."),
          })
        );
    } finally {
      if (!lifecycle.current?.signal.aborted) setBusy(false);
    }
  };
  const closeSettings = () => {
    (app as unknown as { setting?: { close: () => void } }).setting?.close();
  };
  const launchSkill = async (initial: Skill) => {
    const skill = getManagedSkills().find((item) => item.filePath === initial.filePath) ?? initial;
    if (skill.userInvocable === false) return;
    if (!skill.enabledAgents.includes("native")) {
      if (
        !(await confirmSkillAction(app, {
          title: t("Enable and use skill"),
          content: t("Enable {name} before opening a chat?", { name: skill.name }),
          confirmText: t("Enable and use"),
        }))
      )
        return;
      const result = await SkillManager.getInstance().toggleAgent(skill, "native", true);
      if (!result.ok) throw new Error(result.message);
      await changed();
    }
    await plugin.newAgentChatWithDraft(`/${skill.name} `);
    closeSettings();
  };
  const launchSkillAuthoring = async () => {
    const creator = getManagedSkills().find(
      (skill) => skill.name === SKILL_CREATOR_SKILL_NAME && skill.userInvocable !== false
    );
    if (!creator) {
      new Notice(t("The built-in skill-creator skill is missing. Restore built-in skills first."));
      return;
    }
    if (!creator.enabledAgents.includes("native")) {
      if (
        !(await confirmSkillAction(app, {
          title: t("Enable and use skill"),
          content: t("Enable {name} before opening a chat?", { name: creator.name }),
          confirmText: t("Enable and use"),
        }))
      )
        return;
      const result = await SkillManager.getInstance().toggleAgent(creator, "native", true);
      if (!result.ok) throw new Error(result.message);
      await changed();
    }
    await plugin.newSkillAuthoringChat();
    closeSettings();
  };
  const actionsFor = (skill: Skill | RejectedSkill) => ({
    skill,
    busy,
    container: containerRef.current,
    onUse: () => {
      const current = selectedSkillRef.current ?? skill;
      if ("enabledAgents" in current) void perform(() => launchSkill(current));
    },
    onToggle: (enabled: boolean) => {
      const current = selectedSkillRef.current ?? skill;
      if ("enabledAgents" in current)
        return perform(async () => {
          const result = await SkillManager.getInstance().toggleAgent(current, "native", enabled);
          if (!result.ok) throw new Error(result.message);
          await changed();
        });
    },
    onUninstall: () => {
      const current = selectedSkillRef.current ?? skill;
      void perform(async () => {
        const builtin = current.source?.kind === "builtin";
        if (
          !(await confirmSkillAction(app, {
            title: t("Uninstall {name}?", { name: current.name }),
            content: t(
              builtin
                ? "This removes the built-in skill and supporting files. You can reinstall it with Restore built-in skills."
                : "This permanently removes the skill folder and all supporting files. The original imported source is kept."
            ),
            confirmText: t("Uninstall"),
          }))
        )
          return;
        const result = await SkillManager.getInstance().deleteSkill(current);
        if (!result.ok) throw new Error(result.message);
        clearSkillEditorDraft(current.dirPath);
        await changed();
        selectSkill(undefined);
        new Notice(t("Skill uninstalled"));
      });
    },
  });
  const importLocalPath = async (path: string) => {
    const pkg = await readSkillPackage(path, "local", lifecycle.current?.signal);
    const installed = [...getManagedSkills(), ...rejected];
    if (!(await confirmSkillPackage(app, pkg, lifecycle.current?.signal, installed))) return;
    const existing = installed.some(
      (skill) =>
        skill.source?.kind === pkg.source.kind &&
        skill.source?.origin === pkg.source.origin &&
        Boolean(pkg.source.origin)
    );
    const result = await SkillManager.getInstance().installPackage(
      pkg,
      existing,
      lifecycle.current?.signal
    );
    if (!result.ok) throw new Error(result.message);
    await changed();
    new Notice(t("Skill imported"));
  };
  const importLocal = async (kind: "folder" | "zip") => {
    await perform(async () => {
      const ownerDocument = containerRef.current?.ownerDocument;
      if (!ownerDocument) return;
      const path = await pickSkillImport(kind, ownerDocument);
      if (!path || lifecycle.current?.signal.aborted) return;
      await importLocalPath(path);
    });
  };
  const importDropped = async (path: string) => {
    await perform(async () => {
      if (lifecycle.current?.signal.aborted) return;
      await importLocalPath(path);
    });
  };
  const search = (query ?? localSearch).trim().toLowerCase();
  const entries = [...skills, ...rejected].filter((skill) =>
    `${skill.name} ${"description" in skill ? skill.description : skill.reason}`
      .toLowerCase()
      .includes(search)
  );
  if (selectedSkill)
    return (
      <div ref={containerRef}>
        {error && (
          <p role="alert" className="tw-text-ui-small tw-text-error">
            {error}
          </p>
        )}
        <SkillDetails
          {...actionsFor(selectedSkill)}
          onBack={() => selectSkill(undefined)}
          onChanged={changed}
          onSkillChanged={selectSkill}
          onRestore={() =>
            new SkillModal(app, t("Restore built-in skills"), () => (
              <BuiltinSkillRecovery app={app} onChanged={changed} />
            )).open()
          }
          onRepair={() => {
            if (selectedSkill.source?.kind === "builtin") return;
            void perform(async () => {
              await plugin.newAgentChatWithDraft(
                buildSkillRepairPrompt([
                  {
                    location: toVaultRelative(selectedSkill.filePath, getVaultBase(app)),
                    reason:
                      "reason" in selectedSkill
                        ? selectedSkill.reason
                        : t("Could not load this skill"),
                    offendingText:
                      "offendingText" in selectedSkill ? selectedSkill.offendingText : undefined,
                  },
                ])
              );
              closeSettings();
            });
          }}
        />
      </div>
    );
  const addMenu = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button disabled={busy}>
          <Plus className="tw-size-4" />
          {t("Add skill")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" container={containerRef.current ?? undefined}>
        <DropdownMenuItem
          onSelect={() => {
            void perform(launchSkillAuthoring);
          }}
        >
          {t("Create with Agent")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const base = getVaultBase(app);
            if (!base) {
              setError(t("The current vault path is unavailable."));
              return;
            }
            new SkillModal(app, t("System search"), () => (
              <SystemSkillSearch
                app={app}
                skillsDirectory={`${base}/${getEffectiveSkillsFolder()}`}
                onChanged={changed}
              />
            )).open();
          }}
        >
          {t("System search")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            new SkillModal(app, t("Local import"), (close) => (
              <LocalSkillImportView
                onImportPath={(path) => {
                  close();
                  void importDropped(path);
                }}
                onPickFolder={() => {
                  close();
                  void importLocal("folder");
                }}
                onPickZip={() => {
                  close();
                  void importLocal("zip");
                }}
              />
            )).open()
          }
        >
          {t("Local import")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const restoreButton = (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={() =>
        new SkillModal(app, t("Restore built-in skills"), () => (
          <BuiltinSkillRecovery app={app} onChanged={changed} />
        )).open()
      }
    >
      <RotateCcw className="tw-size-4" />
      {t("Restore built-in skills")}
    </Button>
  );
  return (
    <div ref={containerRef} className="tw-space-y-4">
      {!embedded && (
        <AgentConfigurationHeader
          agents={[{ id: "native", label: "Scribe" }]}
          selectedAgent="native"
          query={query ?? localSearch}
          onQueryChange={setLocalSearch}
          searchPlaceholder={t("Search skills…")}
          label={t("Skills")}
          count={skills.length + rejected.length}
          actions={
            <>
              {restoreButton}
              {addMenu}
            </>
          }
        />
      )}
      {embedded && (
        <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2">
          {restoreButton}
          {addMenu}
        </div>
      )}
      {busy && <p role="status">{t("Updating skills…")}</p>}
      {error && (
        <p role="alert" className="tw-text-ui-small tw-text-error">
          {error}
        </p>
      )}
      {builtinAttention && (
        <p role="status" className="tw-text-ui-small tw-text-muted">
          {t(
            "Some built-in skills need attention. Open Restore built-in skills to review conflicts or local changes."
          )}
        </p>
      )}
      <section aria-label={t("Your skills")} className="tw-space-y-2">
        {entries.length === 0 ? (
          skills.length + rejected.length === 0 ? (
            <EmptyPlaceholder />
          ) : (
            <p>{t("No skills match your search.")}</p>
          )
        ) : (
          entries.map((skill) => (
            <SkillRow
              key={skill.dirPath}
              {...actionsFor(skill)}
              onOpen={() => selectSkill(skill)}
            />
          ))
        )}
      </section>
      {children}
    </div>
  );
}
