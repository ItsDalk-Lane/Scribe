import React from "react";
import type { App } from "obsidian";
import { getManagedSkills, SkillManager, useRejectedSkills } from "@/agentMode/skills/SkillManager";
import { parseSkillFile } from "@/agentMode/skills/skillFormat";
import { droppedSkillImportPath } from "@/agentMode/skills/localImportPath";
import { readSkillPackage } from "@/agentMode/skills/skillImport";
import { searchSystemSkills } from "@/agentMode/skills/systemSkillSearch";
import type { Skill, SkillImportCandidate, SkillPackage } from "@/agentMode/skills/types";
import { SkillModal } from "@/agentMode/skills/ui/SkillModal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { FileDown, FolderOpen } from "lucide-react";

interface SkillConfirmationOptions {
  title: string;
  content: React.ReactNode;
  confirmText: string;
  signal?: AbortSignal;
}

export function confirmSkillAction(app: App, options: SkillConfirmationOptions): Promise<boolean> {
  if (options.signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      resolve(confirmed);
    };
    const modal = new SkillModal(
      app,
      options.title,
      (close) => (
        <div className="tw-space-y-4">
          <div className="tw-whitespace-pre-wrap tw-break-words">{options.content}</div>
          <div className="tw-flex tw-justify-end tw-gap-2">
            <Button variant="secondary" onClick={close}>
              {t("Cancel")}
            </Button>
            <Button
              onClick={() => {
                finish(true);
                close();
              }}
            >
              {options.confirmText}
            </Button>
          </div>
        </div>
      ),
      () => finish(false)
    );
    const abort = () => modal.close();
    options.signal?.addEventListener("abort", abort, { once: true });
    modal.open();
  });
}

export async function confirmSkillPackage(
  app: App,
  pkg: SkillPackage,
  signal?: AbortSignal,
  installed: readonly Pick<Skill, "name" | "source">[] = getManagedSkills()
): Promise<boolean> {
  const existing = installed.find(
    (skill) =>
      skill.source?.kind === pkg.source.kind &&
      skill.source?.origin === pkg.source.origin &&
      Boolean(pkg.source.origin)
  );
  const descriptor = pkg.files.find((file) => file.path === "SKILL.md");
  const parsed = parseSkillFile(new TextDecoder().decode(descriptor?.data), pkg.name);
  return confirmSkillAction(app, {
    title: t(existing ? "Update imported skill" : "Import skill"),
    confirmText: t(existing ? "Update and replace" : "Import"),
    signal,
    content: (
      <div className="tw-space-y-3">
        <p>{t("Install as {name}", { name: existing?.name ?? pkg.name })}</p>
        <p>{parsed.frontmatter.description}</p>
        <p className="tw-break-all tw-text-ui-smaller tw-text-muted">
          {pkg.source.displayPath ?? pkg.source.origin}
        </p>
        {pkg.repair?.length ? (
          <div className="tw-space-y-1">
            <p className="tw-text-warning">
              {t(
                "This skill has minor format issues. We adjusted {count} lines; confirm to install the repaired copy. The original file is never modified.",
                { count: String(pkg.repair.length) }
              )}
            </p>
            {pkg.repair.map((change) => (
              <div key={change.after} className="tw-font-mono tw-text-ui-smaller">
                <div className="tw-break-all tw-text-error">- {change.before}</div>
                <div className="tw-break-all tw-text-success">+ {change.after}</div>
              </div>
            ))}
          </div>
        ) : null}
        {existing && (
          <p className="tw-text-error">
            {t(
              "This replaces the installed copy and all supporting files, including your local edits. The original source is kept."
            )}
          </p>
        )}
        {existing && (
          <p className="tw-text-ui-small tw-text-muted">
            {t(
              "If the installed skill is damaged, the updated copy stays disabled. Review it before enabling it."
            )}
          </p>
        )}
      </div>
    ),
  });
}

export interface SystemSkillSearchProps {
  app: App;
  skillsDirectory: string;
  onChanged?: () => Promise<void>;
}

export function SystemSkillSearch({ app, skillsDirectory, onChanged }: SystemSkillSearchProps) {
  const rejected = useRejectedSkills();
  const rejectedRef = React.useRef(rejected);
  rejectedRef.current = rejected;
  const [candidates, setCandidates] = React.useState<SkillImportCandidate[]>([]);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [incomplete, setIncomplete] = React.useState(false);
  const [failures, setFailures] = React.useState<{ root: string; reason: string }[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [results, setResults] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const controller = React.useRef<AbortController | null>(null);
  const refresh = React.useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setWarnings([]);
    setIncomplete(false);
    setFailures([]);
    setSelected(new Set());
    setResults({});
    try {
      const found = await searchSystemSkills({
        skillsDirectory,
        installed: [...getManagedSkills(), ...rejectedRef.current],
        signal: abort.signal,
      });
      if (!abort.signal.aborted) {
        setCandidates(found.candidates);
        setWarnings(found.warnings);
        setIncomplete(found.incomplete);
        setFailures(found.failures);
      }
    } catch (error) {
      if (!abort.signal.aborted)
        setWarnings([
          t("Could not search for skills: {reason}", {
            reason: error instanceof Error ? t(error.message) : t("Please try again."),
          }),
        ]);
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }, [skillsDirectory]);
  React.useEffect(() => {
    void refresh();
    return () => controller.current?.abort();
  }, [refresh]);
  const importItems = async (items: SkillImportCandidate[]) => {
    const signal = controller.current?.signal;
    if (busy || signal?.aborted) return;
    setBusy(true);
    try {
      for (const candidate of items) {
        if (signal?.aborted) break;
        setResults((current) => ({ ...current, [candidate.id]: t("Importing…") }));
        try {
          const pkg = await readSkillPackage(candidate.path, "system", signal);
          if (
            candidate.status === "installed" &&
            !(await confirmSkillPackage(app, pkg, signal, [
              ...getManagedSkills(),
              ...rejectedRef.current,
            ]))
          ) {
            if (!signal?.aborted)
              setResults((current) => ({ ...current, [candidate.id]: t("Cancelled") }));
            continue;
          }
          const result = await SkillManager.getInstance().installPackage(
            pkg,
            candidate.status === "installed",
            signal
          );
          if (signal?.aborted) break;
          if (!result.ok) throw new Error(result.message);
          setCandidates((current) =>
            current.map((item) =>
              item.id === candidate.id ? { ...item, status: "installed" } : item
            )
          );
          setResults((current) => ({ ...current, [candidate.id]: t("Imported") }));
          await onChanged?.();
        } catch (error) {
          if (!signal?.aborted)
            setResults((current) => ({
              ...current,
              [candidate.id]: t("Could not import skill: {reason}", {
                reason: error instanceof Error ? t(error.message) : t("Please try again."),
              }),
            }));
        }
      }
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  };
  return (
    <SystemSkillSearchView
      candidates={candidates}
      warnings={warnings}
      incomplete={incomplete}
      failures={failures}
      selected={selected}
      results={results}
      loading={loading}
      busy={busy}
      onRefresh={() => void refresh()}
      onImport={(items) => void importItems(items)}
      onSelect={(id, checked) =>
        setSelected((current) => {
          const next = new Set(current);
          if (checked) next.add(id);
          else next.delete(id);
          return next;
        })
      }
    />
  );
}

export interface SystemSkillSearchViewProps {
  candidates: SkillImportCandidate[];
  warnings: string[];
  incomplete?: boolean;
  failures?: readonly { root: string; reason: string }[];
  selected: ReadonlySet<string>;
  results: Readonly<Record<string, string>>;
  loading: boolean;
  busy: boolean;
  onRefresh: () => void;
  onImport: (candidates: SkillImportCandidate[]) => void;
  onSelect: (id: string, checked: boolean) => void;
}

export function SystemSkillSearchView({
  candidates,
  warnings,
  incomplete,
  failures,
  selected,
  results,
  loading,
  busy,
  onRefresh,
  onImport,
  onSelect,
}: SystemSkillSearchViewProps) {
  return (
    <div className="tw-max-h-[75vh] tw-space-y-4 tw-overflow-y-auto">
      <p className="tw-text-ui-small tw-text-muted">
        {t("Import a copy of skills from other tools. Their original folders are never changed.")}
      </p>
      <div className="tw-flex tw-flex-wrap tw-gap-2">
        <Button variant="secondary" disabled={busy || loading} onClick={onRefresh}>
          {t("Refresh")}
        </Button>
        <Button
          disabled={busy || loading || selected.size === 0}
          onClick={() =>
            onImport(
              candidates.filter(
                (item) => selected.has(item.id) && !item.error && item.status !== "conflict"
              )
            )
          }
        >
          {t("Import selected")}
        </Button>
      </div>
      {loading && <p role="status">{t("Searching for skills…")}</p>}
      {/* 扫描不完整时明确标记，不得把部分结果表述为完整列表。https://github.com/ItsDalk-Lane/Scribe/issues/49 */}
      {!loading && incomplete && (
        <div role="alert" className="tw-space-y-1">
          <p className="tw-text-ui-small tw-text-warning">
            {t(
              "This scan is incomplete: only confirmed candidates are listed. Retry to cover the failed sources."
            )}
          </p>
          {(failures ?? []).map((failure) => (
            <p
              key={`${failure.root}:${failure.reason}`}
              className="tw-text-ui-smaller tw-text-muted"
            >
              {t("{root}: {reason}", { root: failure.root, reason: failure.reason })}
            </p>
          ))}
        </div>
      )}
      {warnings.map((warning) => (
        <p role="alert" key={warning} className="tw-text-ui-small tw-text-error">
          {warning}
        </p>
      ))}
      {!loading && candidates.length === 0 && (
        <p>{t("No skills found in the supported locations.")}</p>
      )}
      {candidates.map((candidate) => (
        <div
          key={candidate.id}
          className="tw-space-y-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-3"
        >
          <div className="tw-flex tw-items-start tw-gap-3">
            <Checkbox
              aria-label={t("Select {name}", { name: candidate.name })}
              checked={selected.has(candidate.id)}
              disabled={busy || Boolean(candidate.error) || candidate.status === "conflict"}
              onCheckedChange={(checked) => onSelect(candidate.id, checked === true)}
            />
            <div className="tw-min-w-0 tw-flex-1">
              <strong>{candidate.name}</strong>
              <p className="tw-m-0 tw-text-ui-small">{candidate.description}</p>
              <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
                {candidate.sources.join(", ")}
              </p>
              <p className="tw-m-0 tw-break-all tw-text-ui-smaller tw-text-muted">
                {candidate.path}
              </p>
            </div>
            <Button
              disabled={busy || Boolean(candidate.error) || candidate.status === "conflict"}
              onClick={() => onImport([candidate])}
            >
              {t(candidate.status === "installed" ? "Reimport" : "Import")}
            </Button>
          </div>
          <p className="tw-m-0 tw-text-ui-smaller">
            {t(
              {
                available: "Available to import",
                installed: "Already imported",
                conflict: "Name conflict",
              }[candidate.status]
            )}
          </p>
          {candidate.renamedFrom && (
            <p className="tw-m-0 tw-text-ui-smaller">
              {t("Name will change from {from} to {to}.", {
                from: candidate.renamedFrom,
                to: candidate.name,
              })}
            </p>
          )}
          {candidate.repair?.length ? (
            <p className="tw-m-0 tw-text-ui-smaller tw-text-warning">
              {t(
                "{count} lines will be adjusted automatically; review the changes before importing.",
                {
                  count: String(candidate.repair.length),
                }
              )}
            </p>
          ) : null}
          {candidate.error && (
            <p role="alert" className="tw-text-ui-small tw-text-error">
              {candidate.error}
            </p>
          )}
          {results[candidate.id] && (
            <p role="status" className="tw-text-ui-small">
              {results[candidate.id]}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export interface LocalSkillImportViewProps {
  onImportPath: (path: string) => void;
  onPickFolder: () => void;
  onPickZip: () => void;
  onPickMarkdown: () => void;
}

export function LocalSkillImportView({
  onImportPath,
  onPickFolder,
  onPickZip,
  onPickMarkdown,
}: LocalSkillImportViewProps) {
  const [dragActive, setDragActive] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const importDropped = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragActive(false);
    try {
      onImportPath(droppedSkillImportPath(event.dataTransfer));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <div className="tw-space-y-4">
      <button
        type="button"
        aria-label={t("Drop a skill folder or a ZIP archive here, or click to choose a ZIP")}
        onClick={onPickZip}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          const next = event.relatedTarget;
          if (!(next instanceof Node) || !event.currentTarget.contains(next)) setDragActive(false);
        }}
        onDrop={importDropped}
        className={cn(
          "tw-flex tw-w-full tw-cursor-pointer tw-flex-col tw-items-center tw-gap-2 tw-rounded-lg tw-border tw-border-dashed tw-border-border tw-bg-transparent tw-px-6 tw-py-10 tw-text-center tw-transition-colors hover:tw-border-interactive-accent hover:tw-bg-modifier-hover focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring",
          dragActive && "tw-border-interactive-accent tw-bg-modifier-hover"
        )}
      >
        <FileDown className="tw-size-8 tw-text-muted" aria-hidden="true" />
        <span className="tw-text-ui-small">
          {t("Drop a skill folder or a ZIP archive here, or click to choose a ZIP")}
        </span>
        <span className="tw-text-ui-smaller tw-text-muted">
          {t("Supports .zip files, folders containing SKILL.md, and single skill .md files")}
        </span>
      </button>
      {error && (
        <p role="alert" className="tw-text-ui-small tw-text-error">
          {error}
        </p>
      )}
      <div className="tw-flex tw-flex-wrap tw-gap-2">
        <Button variant="secondary" onClick={onPickFolder}>
          <FolderOpen className="tw-size-4" />
          {t("Import folder")}
        </Button>
        <Button variant="secondary" onClick={onPickZip}>
          <FileDown className="tw-size-4" />
          {t("Import ZIP archive")}
        </Button>
        <Button variant="secondary" onClick={onPickMarkdown}>
          <FileDown className="tw-size-4" />
          {t("Import Markdown file")}
        </Button>
      </div>
    </div>
  );
}

export function BuiltinSkillRecovery({
  app,
  onChanged,
}: {
  app: App;
  onChanged?: () => Promise<void>;
}) {
  const [statuses, setStatuses] = React.useState<
    Awaited<ReturnType<SkillManager["getBuiltinStatuses"]>>
  >([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [results, setResults] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    let active = true;
    void SkillManager.getInstance()
      .getBuiltinStatuses()
      .then((items) => {
        if (active) setStatuses(items);
      })
      .catch(() => {
        if (active) setError(t("Could not read built-in skill status. Please try again."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const restore = async (names: string[]) => {
    if (busy) return;
    setBusy(true);
    try {
      for (const name of names) {
        const status = statuses.find((item) => item.name === name);
        if (
          status?.status === "modified" &&
          !(await confirmSkillAction(app, {
            title: t("Reset built-in skill"),
            content: t(
              "Reset {name} to the bundled version? This replaces all local changes. Cancel keeps your files.",
              { name }
            ),
            confirmText: t("Reset"),
          }))
        )
          continue;
        const result = await SkillManager.getInstance().restoreBuiltin(name);
        setResults((current) => ({
          ...current,
          [name]: result.ok
            ? t("Restored")
            : t("Could not restore skill: {reason}", { reason: t(result.message) }),
        }));
        if (result.ok) {
          setStatuses((current) =>
            current.map((item) => (item.name === name ? { ...item, status: "installed" } : item))
          );
          await onChanged?.();
        }
      }
    } catch {
      setError(t("Could not restore built-in skills. Your existing files are kept."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <BuiltinSkillRecoveryView
      statuses={statuses}
      results={results}
      loading={loading}
      busy={busy}
      error={error}
      onRestore={(names) => void restore(names)}
    />
  );
}

export interface BuiltinSkillRecoveryViewProps {
  statuses: Awaited<ReturnType<SkillManager["getBuiltinStatuses"]>>;
  results: Readonly<Record<string, string>>;
  loading: boolean;
  busy: boolean;
  error?: string;
  onRestore: (names: string[]) => void;
}

export function BuiltinSkillRecoveryView({
  statuses,
  results,
  loading,
  busy,
  error,
  onRestore,
}: BuiltinSkillRecoveryViewProps) {
  const recoverable = statuses.filter((item) => item.status !== "installed");
  return (
    <div className="tw-max-h-[75vh] tw-space-y-4 tw-overflow-y-auto">
      <p>
        {t(
          "Restore uninstalled skills or reset modified built-in skills to the version included with Scribe."
        )}
      </p>
      {loading && <p role="status">{t("Loading…")}</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && recoverable.length === 0 && <p>{t("All built-in skills are installed.")}</p>}
      <Button
        disabled={busy || loading || !recoverable.some((item) => item.status !== "conflict")}
        onClick={() =>
          onRestore(
            recoverable.filter((item) => item.status !== "conflict").map((item) => item.name)
          )
        }
      >
        {t("Restore all")}
      </Button>
      {statuses.map((item) => (
        <div
          key={item.name}
          className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-3"
        >
          <div>
            <strong>{item.name}</strong>
            <p className="tw-m-0 tw-text-ui-small">
              {t(
                {
                  installed: "Installed",
                  uninstalled: "Uninstalled",
                  modified: "Modified outside Scribe",
                  missing: "Missing",
                  conflict: "A personal skill already uses this name",
                }[item.status]
              )}
            </p>
            {results[item.name] && (
              <p role="status" className="tw-m-0 tw-text-ui-small">
                {results[item.name]}
              </p>
            )}
          </div>
          {item.status !== "installed" && (
            <Button
              disabled={busy || item.status === "conflict"}
              onClick={() => onRestore([item.name])}
            >
              {t(item.status === "modified" ? "Reset" : "Restore")}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
