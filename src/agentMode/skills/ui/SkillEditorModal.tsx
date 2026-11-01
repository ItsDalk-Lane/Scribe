import React from "react";
import type { Root } from "react-dom/client";
import { App, Modal, Notice } from "obsidian";
import { t } from "@/lib/i18n";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { SkillManager, type SavePropertiesResult } from "@/agentMode/skills/SkillManager";
import type { Skill } from "@/agentMode/skills/types";
import { parseSkillFile, serializeSkillFile } from "@/agentMode/skills/skillFormat";
import { SkillEditorForm } from "./SkillEditorForm";

interface SkillEditorModalOptions {
  skill?: Skill;
  onSave: (name: string, content: string) => Promise<SavePropertiesResult>;
}

export class SkillEditorModal extends Modal {
  private root: Root | null = null;
  private content: string | null = null;
  private saving = false;
  private error?: string;

  constructor(
    app: App,
    private readonly options: SkillEditorModalOptions
  ) {
    super(app);
    this.titleEl.setText(options.skill ? t("Edit skill") : t("New skill"));
  }

  onOpen(): void {
    this.root = createPluginRoot(this.contentEl, this.app);
    this.render();
    if (this.options.skill) void this.load(this.options.skill);
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
  }

  private async load(skill: Skill): Promise<void> {
    try {
      this.content = await SkillManager.getInstance().readContent(skill);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.render();
  }

  private render(): void {
    let parsed;
    try {
      if (this.content && this.options.skill)
        parsed = parseSkillFile(this.content, this.options.skill.name);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.root?.render(
      <SkillEditorForm
        key={this.content === null ? "initial" : "loaded"}
        initialName={parsed?.frontmatter.name}
        initialDescription={parsed?.frontmatter.description}
        initialBody={parsed?.body}
        readonlyName={!!this.options.skill}
        loading={!!this.options.skill && this.content === null && !this.error}
        saving={this.saving}
        error={this.error}
        onCancel={() => this.close()}
        onSave={(name, description, body) => {
          void this.save(name, description, body);
        }}
      />
    );
  }

  private async save(name: string, description: string, body: string): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.error = undefined;
    this.render();
    try {
      let content: string;
      if (this.content && this.options.skill) {
        const parsed = parseSkillFile(this.content, this.options.skill.name);
        parsed.body = body;
        content = serializeSkillFile(parsed, { description });
      } else {
        content = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n${body}`;
      }
      const result = await this.options.onSave(name, content);
      if (result.ok) {
        if (result.warning) {
          new Notice(
            t(
              "Skill saved, but syncing with the agent failed: {reason}. Reopen Skills after fixing the problem to retry.",
              { reason: t(result.warning) }
            ),
            10000
          );
        }
        this.close();
        return;
      }
      this.error = result.message;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.saving = false;
    this.render();
  }
}
