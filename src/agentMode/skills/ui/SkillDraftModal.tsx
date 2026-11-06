import React from "react";
import type { App } from "obsidian";
import { SkillManager } from "@/agentMode/skills/SkillManager";
import { SkillEditorForm } from "@/agentMode/skills/ui/SkillEditorForm";
import { parseSkillFile } from "@/agentMode/skills/skillFormat";
import { SkillModal } from "@/agentMode/skills/ui/SkillModal";
import { buildSkillEditorContent } from "@/agentMode/skills/ui/skillEditorContent";
import { t } from "@/lib/i18n";

export interface SkillDraft {
  name: string;
  description: string;
  body: string;
}

interface SkillDraftReviewProps {
  draft: SkillDraft;
  signal?: AbortSignal;
  onSaved: (name: string) => void;
  onCancel: () => void;
  onSaving?: (saving: boolean) => void;
}

export function SkillDraftReview({
  draft,
  signal,
  onSaved,
  onCancel,
  onSaving,
}: SkillDraftReviewProps) {
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const save = async (content: string) => {
    if (saving || signal?.aborted) return;
    setSaving(true);
    onSaving?.(true);
    setError(undefined);
    try {
      const name = parseSkillFile(content).frontmatter.name;
      if (signal?.aborted) return;
      const result = await SkillManager.getInstance().createSkill(name, content, signal);
      if (result.ok) onSaved(name);
      else if (!signal?.aborted)
        setError(t("Could not save skill: {reason}", { reason: t(result.message) }));
    } catch (failure) {
      if (!signal?.aborted)
        setError(
          t("Could not save skill: {reason}", {
            reason: failure instanceof Error ? t(failure.message) : t("Please try again."),
          })
        );
    } finally {
      onSaving?.(false);
      if (!signal?.aborted) setSaving(false);
    }
  };
  return (
    <div className="tw-max-h-[75vh] tw-space-y-4 tw-overflow-y-auto">
      <p className="tw-text-ui-small tw-text-muted">
        {t("Review the complete draft. The skill is installed only when you choose Save.")}
      </p>
      <div className="tw-overflow-hidden tw-rounded-lg tw-bg-secondary">
        <div className="tw-border-0 tw-border-b tw-border-solid tw-border-border tw-px-3 tw-py-2 tw-text-ui-small tw-font-medium">
          SKILL.md
        </div>
        <SkillEditorForm
          initialContent={buildSkillEditorContent(draft.name, draft.description, draft.body)}
          saving={saving}
          error={error}
          onCancel={onCancel}
          onSave={(content) => void save(content)}
        />
      </div>
    </div>
  );
}

export function reviewSkillDraft(
  app: App,
  draft: SkillDraft,
  signal?: AbortSignal
): Promise<{ name: string } | null> {
  if (signal?.aborted) return Promise.resolve(null);
  const controller = new AbortController();
  return new Promise((resolve) => {
    let settled = false;
    let saving = false;
    let closed = false;
    const settle = (value: { name: string } | null) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const modal = new SkillModal(
      app,
      t("Review skill draft"),
      (close) => (
        <SkillDraftReview
          draft={draft}
          signal={controller.signal}
          onCancel={close}
          onSaving={(active) => {
            saving = active;
            if (closed && !active) settle(null);
          }}
          onSaved={(name) => {
            settle({ name });
            if (!closed) close();
          }}
        />
      ),
      () => {
        controller.abort();
        closed = true;
        if (!saving) settle(null);
      }
    );
    const abort = () => {
      controller.abort();
      modal.close();
    };
    signal?.addEventListener("abort", abort, { once: true });
    modal.open();
  });
}
