import React from "react";
import { ArrowLeft, FileText, Folder, MoreHorizontal, Play, Trash2 } from "lucide-react";
import { SkillManager, getManagedSkills, useManagedSkills } from "@/agentMode/skills/SkillManager";
import { parseSkillFile } from "@/agentMode/skills/skillFormat";
import type { Skill } from "@/agentMode/skills/types";
import { SkillEditorForm } from "@/agentMode/skills/ui/SkillEditorForm";
import { SkillDependencyPanel } from "@/agentMode/skills/ui/SkillDependencyPanel";
import { SkillUiMetadataForm } from "@/agentMode/skills/ui/SkillUiMetadataForm";
import { SkillSourceBadge, type SkillActionsProps } from "@/agentMode/skills/ui/SkillRow";
import { useSkillIcon } from "@/agentMode/skills/ui/useSkillIcon";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { debounce } from "@/lib/debounce";
import { useSettingsLeaveGuard } from "@/contexts/TabContext";

interface SkillEditRecovery {
  selectedFile: string;
  documents: Record<string, { original: string; draft: string }>;
}
const skillEditRecovery = new Map<string, SkillEditRecovery>();

export function clearSkillEditorDraft(directory: string): void {
  skillEditRecovery.delete(directory);
}

export interface SkillDetailsViewProps extends SkillActionsProps {
  content?: string;
  files?: string[];
  loading?: boolean;
  initialEditing?: boolean;
  loadError?: string;
  onBack: () => void;
  onSave: (content: string, name: string, expectedContent?: string) => Promise<string | undefined>;
  onReadFile?: (path: string) => Promise<string>;
  onSaveFile?: (path: string, content: string, expected: string) => Promise<string | undefined>;
  onSaveUiMetadata?: (patch: {
    displayName?: string;
    shortDescription?: string;
    icon?: string;
    brandColor?: string;
    defaultPrompt?: string;
  }) => Promise<void>;
  onRepair: () => void;
  onRestore?: () => void;
}

interface SkillFileTreeProps {
  files: string[];
  selected: string;
  prefix?: string;
  disabled?: boolean;
  onSelect: (path: string) => void;
}

function SkillFileTree({ files, selected, prefix = "", disabled, onSelect }: SkillFileTreeProps) {
  const children = [
    ...new Set(
      files
        .filter((path) => path.startsWith(prefix))
        .map((path) => path.slice(prefix.length).split("/")[0])
    ),
  ];
  return (
    <ul
      role={prefix ? "group" : "tree"}
      aria-label={prefix ? undefined : t("Source files")}
      className="tw-m-0 tw-list-none tw-space-y-0.5 tw-p-0"
    >
      {children.map((name) => {
        const path = `${prefix}${name}`;
        const directory = files.some((file) => file.startsWith(`${path}/`));
        return (
          <li role="none" key={path}>
            {directory ? (
              <details>
                <summary className="tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded tw-px-2 tw-py-1.5 tw-text-ui-small tw-text-muted">
                  <Folder className="tw-size-3.5 tw-shrink-0" />
                  {name}
                </summary>
                <div className="tw-pl-3">
                  <SkillFileTree
                    files={files}
                    selected={selected}
                    prefix={`${path}/`}
                    disabled={disabled}
                    onSelect={onSelect}
                  />
                </div>
              </details>
            ) : (
              <button
                type="button"
                role="treeitem"
                aria-selected={selected === path}
                aria-label={path}
                disabled={disabled}
                onClick={() => onSelect(path)}
                className={cn(
                  "tw-flex tw-w-full tw-items-center tw-justify-start tw-gap-2 tw-rounded tw-border-0 tw-px-2 tw-py-1.5 tw-text-left tw-text-ui-small !tw-shadow-none",
                  selected === path
                    ? "!tw-bg-modifier-hover tw-text-normal"
                    : "!tw-bg-transparent tw-text-muted hover:!tw-bg-modifier-hover"
                )}
              >
                <FileText className="tw-size-3.5 tw-shrink-0" />
                <span className="tw-truncate">{name}</span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function SkillDetailsView({
  skill,
  content,
  files,
  loading,
  initialEditing = false,
  loadError,
  onSave,
  onReadFile,
  onSaveFile,
  onSaveUiMetadata,
  onBack,
  onRepair,
  onRestore,
  busy,
  container,
  onUse,
  onToggle,
  onUninstall,
}: SkillDetailsViewProps) {
  const builtin = skill.source?.kind === "builtin";
  const valid = "enabledAgents" in skill;
  const iconUrl = useSkillIcon(skill);
  const recovery = React.useRef(skillEditRecovery.get(skill.dirPath)).current;
  const recoveryIdentity = React.useRef(skill.dirPath);
  const [selectedFile, setSelectedFile] = React.useState(recovery?.selectedFile ?? "SKILL.md");
  const [editing, setEditing] = React.useState((initialEditing || Boolean(recovery)) && !builtin);
  const [saving, setSaving] = React.useState(false);
  const [loadingFile, setLoadingFile] = React.useState(false);
  const [fileError, setFileError] = React.useState<string>();
  const [saveError, setSaveError] = React.useState<string>();
  const [documents, setDocuments] = React.useState<
    Record<string, { original: string; draft: string }>
  >(recovery?.documents ?? {});
  const documentsRef = React.useRef(documents);
  const selectedRef = React.useRef(selectedFile);
  selectedRef.current = selectedFile;
  const callbacks = React.useRef({ onSave, onSaveFile, onReadFile });
  callbacks.current = { onSave, onSaveFile, onReadFile };
  const queue = React.useRef<Promise<void>>(Promise.resolve());
  const request = React.useRef(0);
  const editGeneration = React.useRef(0);
  const live = React.useRef(true);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const updateDocuments = React.useCallback(
    (update: (current: typeof documents) => typeof documents) => {
      const next = update(documentsRef.current);
      documentsRef.current = next;
      if (Object.values(next).some((item) => item.draft !== item.original))
        skillEditRecovery.set(recoveryIdentity.current, {
          selectedFile: selectedRef.current,
          documents: next,
        });
      else clearSkillEditorDraft(recoveryIdentity.current);
      if (live.current) setDocuments(next);
    },
    []
  );
  React.useLayoutEffect(() => {
    const previous = recoveryIdentity.current;
    if (previous === skill.dirPath) return;
    const pending = skillEditRecovery.get(previous);
    clearSkillEditorDraft(previous);
    if (pending) skillEditRecovery.set(skill.dirPath, pending);
    recoveryIdentity.current = skill.dirPath;
  }, [skill.dirPath]);
  const flush = React.useCallback((): Promise<void> => {
    const path = selectedRef.current;
    const task = queue.current
      .catch(() => undefined)
      .then(async () => {
        const current = documentsRef.current[path];
        if (!current || current.draft === current.original) return;
        const snapshot = current.draft;
        if (live.current) {
          setSaving(true);
          setSaveError(undefined);
        }
        try {
          const message =
            path === "SKILL.md"
              ? await callbacks.current.onSave(
                  snapshot,
                  parseSkillFile(snapshot).frontmatter.name,
                  current.original
                )
              : await callbacks.current.onSaveFile?.(path, snapshot, current.original);
          if (message) throw new Error(message);
          updateDocuments((latest) => ({
            ...latest,
            [path]: { original: snapshot, draft: latest[path].draft },
          }));
        } catch (error) {
          const message = error instanceof Error ? t(error.message) : t("Please try again.");
          if (live.current) setSaveError(message);
          throw error;
        } finally {
          if (live.current) setSaving(false);
        }
      });
    queue.current = task;
    return task;
  }, [updateDocuments]);
  const saveSoon = React.useMemo(
    () =>
      debounce(() => {
        void flush().catch(() => undefined);
      }, 600),
    [flush]
  );
  const cancelRead = React.useCallback(() => {
    request.current++;
  }, []);
  React.useEffect(() => {
    live.current = true;
    if (recovery) saveSoon();
    return () => {
      live.current = false;
      cancelRead();
      saveSoon.cancel();
    };
  }, [saveSoon, cancelRead, recovery]);
  const beforeLeave = React.useCallback(async () => {
    const generation = editGeneration.current;
    saveSoon.cancel();
    await flush();
    if (generation !== editGeneration.current)
      throw new Error(t("Your edits have not been saved."));
  }, [saveSoon, flush]);
  useSettingsLeaveGuard(beforeLeave);
  React.useEffect(() => {
    const owner = rootRef.current?.ownerDocument.defaultView;
    const preventUnsavedClose = (event: BeforeUnloadEvent) => {
      if (Object.values(documentsRef.current).some((item) => item.draft !== item.original)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    owner?.addEventListener("beforeunload", preventUnsavedClose);
    return () => owner?.removeEventListener("beforeunload", preventUnsavedClose);
  }, []);
  const document = documents[selectedFile];
  const original = document?.original ?? (selectedFile === "SKILL.md" ? content : undefined);
  const draft = document?.draft ?? original;
  const dirty = document !== undefined && document.draft !== document.original;
  const disabled = Boolean(busy);
  const afterFlush = async (action: () => void | Promise<void>) => {
    const generation = editGeneration.current;
    saveSoon.cancel();
    try {
      await flush();
    } catch {
      return;
    }
    if (live.current && generation === editGeneration.current) {
      try {
        await action();
      } catch (error) {
        if (live.current)
          setSaveError(error instanceof Error ? t(error.message) : t("Please try again."));
      }
    }
  };
  const selectFile = async (path: string) => {
    if (disabled || path === selectedFile) return;
    const generation = editGeneration.current;
    saveSoon.cancel();
    try {
      await flush();
    } catch {
      return;
    }
    if (!live.current || generation !== editGeneration.current) return;
    const revision = ++request.current;
    setSelectedFile(path);
    setEditing(false);
    setSaveError(undefined);
    setFileError(undefined);
    setLoadingFile(false);
    if (documentsRef.current[path] || path === "SKILL.md") return;
    setLoadingFile(true);
    try {
      if (!callbacks.current.onReadFile) throw new Error(t("Could not read this skill file."));
      const next = await callbacks.current.onReadFile(path);
      if (revision === request.current)
        updateDocuments((current) => ({ ...current, [path]: { original: next, draft: next } }));
    } catch (error) {
      if (revision === request.current)
        setFileError(
          error instanceof Error ? t(error.message) : t("Could not read this skill file.")
        );
    } finally {
      if (revision === request.current) setLoadingFile(false);
    }
  };
  const reload = async () => {
    const path = selectedRef.current;
    const generation = editGeneration.current;
    saveSoon.cancel();
    await queue.current.catch(() => undefined);
    try {
      if (!callbacks.current.onReadFile) throw new Error(t("Could not read this skill file."));
      const next = await callbacks.current.onReadFile(path);
      if (live.current && generation === editGeneration.current) {
        updateDocuments((current) => ({ ...current, [path]: { original: next, draft: next } }));
        setSaveError(undefined);
      }
    } catch (error) {
      if (live.current)
        setSaveError(error instanceof Error ? t(error.message) : t("Please try again."));
    }
  };
  const preview =
    selectedFile === "SKILL.md" && draft !== undefined
      ? draft.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
      : draft;
  return (
    <div
      className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-4 tw-py-4"
      data-ui="skill-detail-page"
      ref={rootRef}
    >
      <div
        className="tw-grid tw-grid-cols-[auto_minmax(0,1fr)] tw-items-start tw-gap-x-2 tw-gap-y-3 sm:tw-grid-cols-[auto_minmax(0,1fr)_auto]"
        data-ui="skill-detail-header"
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("Back to skills")}
          disabled={busy}
          onClick={() => void afterFlush(onBack)}
        >
          <ArrowLeft className="tw-size-4" />
        </Button>
        <div className="tw-min-w-0 tw-space-y-1">
          <div className="tw-flex tw-min-w-0 tw-flex-wrap tw-items-center tw-gap-2">
            {iconUrl && (
              <img src={iconUrl} alt="" aria-hidden="true" className="tw-size-5 tw-rounded-sm" />
            )}
            <h3 className="tw-m-0 tw-break-words tw-text-lg tw-font-semibold">
              {("uiMetadata" in skill && skill.uiMetadata?.displayName) || skill.name}
            </h3>
            {valid && skill.version && (
              <span className="tw-text-ui-smaller tw-text-muted">{skill.version}</span>
            )}
            <SkillSourceBadge source={skill.source} />
            {builtin && (
              <span className="tw-rounded tw-bg-modifier-hover tw-px-1.5 tw-py-0.5 tw-text-ui-smaller tw-text-muted">
                {t("Read only")}
              </span>
            )}
            <label className="tw-flex tw-items-center tw-gap-2 tw-text-ui-smaller tw-text-muted">
              {t("Global enabled")}
              <SettingSwitch
                aria-label={t("Enable {name}", { name: skill.name })}
                checked={valid && skill.enabledAgents.includes("native")}
                disabled={disabled || !valid}
                onCheckedChange={(enabled) =>
                  void afterFlush(async () => {
                    await onToggle(enabled);
                    if (!callbacks.current.onReadFile) return;
                    const latest = await callbacks.current.onReadFile("SKILL.md");
                    const current = documentsRef.current["SKILL.md"];
                    if (!current || current.draft === current.original)
                      updateDocuments((documents) => ({
                        ...documents,
                        "SKILL.md": { original: latest, draft: latest },
                      }));
                  })
                }
              />
            </label>
          </div>
          {valid && (
            <p className="tw-m-0 tw-line-clamp-2 tw-text-ui-small tw-leading-relaxed tw-text-muted">
              {("uiMetadata" in skill && skill.uiMetadata?.shortDescription) || skill.description}
            </p>
          )}
          {valid && (skill.author || skill.tags?.length) && (
            <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
              {[skill.author, skill.tags?.join(", ")].filter(Boolean).join(" · ")}
            </p>
          )}
          {(skill.source?.displayPath || skill.source?.origin) && (
            <p className="tw-m-0 tw-break-all tw-text-ui-smaller tw-text-muted">
              {t("Imported from")}: {skill.source.displayPath ?? skill.source.origin}
            </p>
          )}
        </div>
        <div className="tw-col-start-2 tw-flex tw-items-center tw-gap-1.5 sm:tw-col-start-3 sm:tw-row-start-1">
          <Button
            disabled={disabled || !valid || skill.userInvocable === false}
            onClick={() => void afterFlush(onUse)}
          >
            <Play className="tw-size-3.5" />
            {t("Use now")}
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("More actions for {p0}", { p0: skill.name })}
                disabled={disabled}
              >
                <MoreHorizontal className="tw-size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" container={container}>
              <DropdownMenuItem
                className="tw-text-error"
                onSelect={() => void afterFlush(onUninstall)}
              >
                <Trash2 className="tw-size-4" />
                {t("Uninstall")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {valid && skill.dependencies?.length ? (
        <SkillDependencyPanel dependencies={skill.dependencies} />
      ) : null}
      {valid && !builtin && onSaveUiMetadata ? (
        <SkillUiMetadataForm skill={skill} disabled={busy} onSaveUiMetadata={onSaveUiMetadata} />
      ) : null}
      {recovery && dirty && (
        <p role="status" className="tw-m-0 tw-text-ui-small tw-text-muted">
          {t("Restored your unsaved edits.")}
        </p>
      )}
      {loading ? (
        <p role="status">{t("Loading…")}</p>
      ) : !valid || loadError ? (
        <div className="tw-space-y-3">
          <p role="alert" className="tw-whitespace-pre-wrap tw-text-error">
            {!valid ? skill.reason : loadError}
          </p>
          {builtin ? (
            <Button onClick={onRestore} disabled={!onRestore}>
              {t("Restore built-in skills")}
            </Button>
          ) : (
            <Button onClick={onRepair}>{t("Ask Agent to repair")}</Button>
          )}
        </div>
      ) : (
        <div
          data-ui="skill-file-workspace"
          className="tw-grid tw-min-h-96 tw-min-w-0 tw-flex-1 tw-grid-cols-1 tw-gap-3 md:tw-grid-cols-[14rem_minmax(0,1fr)]"
        >
          <aside className="tw-max-h-40 tw-overflow-auto tw-rounded-lg tw-bg-secondary md:tw-max-h-none">
            <div className="tw-px-3 tw-py-2 tw-text-ui-smaller tw-font-medium tw-text-muted">
              {t("Source files")}
            </div>
            <div className="tw-px-1 tw-pb-2">
              <SkillFileTree
                files={files ?? ["SKILL.md"]}
                selected={selectedFile}
                disabled={disabled}
                onSelect={(path) => void selectFile(path)}
              />
            </div>
          </aside>
          <div className="tw-flex tw-min-h-0 tw-min-w-0 tw-flex-col tw-overflow-hidden tw-rounded-lg tw-bg-secondary">
            <div className="tw-flex tw-min-h-11 tw-flex-wrap tw-items-center tw-gap-2 tw-border-0 tw-border-b tw-border-solid tw-border-border tw-px-3 tw-py-2">
              <FileText className="tw-size-3.5 tw-shrink-0 tw-text-muted" />
              <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small tw-font-medium">
                {selectedFile.split("/").pop()}
              </span>
              {!builtin && (
                <span role="status" className="tw-text-ui-smaller tw-text-muted">
                  {t(saveError ? "Save failed" : saving || dirty ? "Saving…" : "Saved")}
                </span>
              )}
              {!builtin && original !== undefined && !fileError && (
                <SegmentedControl
                  value={editing ? "edit" : "preview"}
                  onChange={(value) => setEditing(value === "edit")}
                  disabled={false}
                  options={[
                    { value: "preview", label: t("Preview") },
                    { value: "edit", label: t("Edit") },
                  ]}
                  aria-label={t("Skill view")}
                />
              )}
            </div>
            {loadingFile ? (
              <p role="status" className="tw-p-4">
                {t("Loading…")}
              </p>
            ) : fileError ? (
              <p role="alert" className="tw-p-4 tw-text-error">
                {fileError}
              </p>
            ) : (
              <>
                {!builtin && original !== undefined && (
                  <div
                    hidden={!editing}
                    className={cn(
                      "tw-min-h-0 tw-flex-1 tw-flex-col",
                      editing ? "tw-flex" : "tw-hidden"
                    )}
                  >
                    <SkillEditorForm
                      key={selectedFile}
                      initialContent={draft ?? ""}
                      value={draft ?? ""}
                      showActions={false}
                      saving={busy}
                      onChange={(value) => {
                        editGeneration.current++;
                        setSaveError(undefined);
                        updateDocuments((current) => ({
                          ...current,
                          [selectedFile]: {
                            original: current[selectedFile]?.original ?? original,
                            draft: value,
                          },
                        }));
                        saveSoon();
                      }}
                      onSave={() => void afterFlush(() => {})}
                      onCancel={() => {}}
                    />
                  </div>
                )}
                {!editing && (
                  <div className="tw-min-h-80 tw-overflow-auto tw-p-4 [&_h1]:!tw-block">
                    {preview !== undefined &&
                      (/\.(md|mdx|markdown)$/i.test(selectedFile) ? (
                        <Markdown text={preview} sourcePath={skill.filePath} />
                      ) : (
                        <pre className="tw-m-0 tw-whitespace-pre-wrap tw-break-words tw-font-mono tw-text-ui-small">
                          {preview}
                        </pre>
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {saveError && (
        <div
          role="alert"
          className="tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-rounded-lg tw-bg-secondary tw-p-3 tw-text-ui-small tw-text-error"
        >
          <span className="tw-min-w-0 tw-flex-1">{saveError}</span>
          <Button variant="ghost" onClick={() => void reload()}>
            {t("Reload from disk")}
          </Button>
          <Button variant="secondary" onClick={() => void afterFlush(() => {})}>
            {t("Retry save")}
          </Button>
        </div>
      )}
    </div>
  );
}

export interface SkillDetailsProps extends Omit<
  SkillDetailsViewProps,
  "content" | "files" | "onSave" | "onReadFile" | "onSaveFile"
> {
  onChanged?: () => Promise<void>;
  onSkillChanged?: (skill: Skill) => void;
}

export function SkillDetails({ onChanged, onSkillChanged, ...props }: SkillDetailsProps) {
  const initialSkill = React.useRef(props.skill).current;
  const openingRef = React.useRef(initialSkill);
  const [openingSkill, setOpeningSkill] = React.useState(initialSkill);
  const [content, setContent] = React.useState<string>();
  const [files, setFiles] = React.useState<string[]>();
  const [loading, setLoading] = React.useState("enabledAgents" in props.skill);
  const [loadError, setLoadError] = React.useState<string>();
  const managed = useManagedSkills();
  const skill = managed.find((item) => item.filePath === openingSkill.filePath) ?? openingSkill;
  React.useEffect(() => {
    let active = true;
    if (!("enabledAgents" in initialSkill)) return;
    const manager = SkillManager.getInstance();
    void Promise.all([manager.readContent(initialSkill), manager.listSkillFiles(initialSkill)])
      .then(([text, paths]) => {
        parseSkillFile(text, initialSkill.name);
        if (active) {
          setContent(text);
          setFiles(paths);
        }
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(
            t("Could not open skill: {reason}", {
              reason: error instanceof Error ? t(error.message) : t("Please try again."),
            })
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initialSkill]);
  return (
    <SkillDetailsView
      {...props}
      skill={skill}
      content={content}
      files={files}
      loading={loading}
      loadError={loadError}
      onReadFile={async (path) => {
        if (!("enabledAgents" in openingRef.current))
          throw new Error(t("Could not load this skill"));
        return SkillManager.getInstance().readSkillFile(openingRef.current, path);
      }}
      onSaveFile={async (path, next, expected) => {
        if (!("enabledAgents" in openingRef.current)) return t("Could not load this skill");
        const result = await SkillManager.getInstance().saveSkillFile(
          openingRef.current,
          path,
          next,
          expected
        );
        if (!result.ok) return t("Could not save skill: {reason}", { reason: t(result.message) });
        const updated = getManagedSkills().find((item) => item.name === openingRef.current.name);
        if (updated) {
          openingRef.current = updated;
          setOpeningSkill(updated);
          onSkillChanged?.(updated);
        }
        await onChanged?.();
        return undefined;
      }}
      onSaveUiMetadata={async (patch) => {
        if (!("enabledAgents" in openingRef.current))
          throw new Error(t("Could not load this skill"));
        const result = await SkillManager.getInstance().saveProperties(openingRef.current, {
          patch: { uiMetadata: patch },
        });
        if (!result.ok) throw new Error(t(result.message));
        const updated = getManagedSkills().find((item) => item.name === openingRef.current.name);
        if (updated) {
          openingRef.current = updated;
          setOpeningSkill(updated);
          onSkillChanged?.(updated);
        }
        await onChanged?.();
      }}
      onSave={async (next, name, expected) => {
        if (!("enabledAgents" in openingRef.current) || (expected ?? content) === undefined)
          return t("Could not load this skill");
        const result = await SkillManager.getInstance().saveSkill(
          openingRef.current,
          next,
          name,
          expected ?? content!
        );
        if (!result.ok) return t("Could not save skill: {reason}", { reason: t(result.message) });
        const updated = getManagedSkills().find((item) => item.name === name);
        if (updated) {
          openingRef.current = updated;
          setOpeningSkill(updated);
          onSkillChanged?.(updated);
        }
        setContent(next);
        await onChanged?.();
        return undefined;
      }}
    />
  );
}
