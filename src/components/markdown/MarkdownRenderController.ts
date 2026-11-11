import { cn } from "@/lib/utils";
import { logWarn } from "@/logger";
import { preprocessAIResponse } from "@/utils/markdownPreprocess";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { inspectMarkdownEnhancement } from "@/components/markdown/markdownEnhancementPolicy";
import { scheduleMarkdownEnhancement } from "@/components/markdown/enhancementQueue";
import {
  StreamingMarkdownDocument,
  createObsidianSectionParser,
  type MarkdownDisplayBlock,
} from "@/components/markdown/streamingMarkdown";
import { Component, type App } from "obsidian";

export interface MarkdownSnapshot {
  text: string;
  sourcePath: string;
  renderIdentity: string;
  isStreaming: boolean;
  contentPolicy: "markdown" | "model";
  contentClassName?: string;
  preparedText?: string;
}

interface DisplayRecord {
  block: MarkdownDisplayBlock;
  element: HTMLElement;
  component?: Component;
  enhanced: boolean;
  attempted: boolean;
}

export class MarkdownRenderController {
  private pending: MarkdownSnapshot | null = null;
  private latest: MarkdownSnapshot | null = null;
  private generation = 0;
  private running = false;
  private disposed = false;
  private records = new Map<string, DisplayRecord>();
  private document: StreamingMarkdownDocument;
  private presentedText = "";
  private readonly body: HTMLElement;
  private readonly tail: HTMLElement;
  private abort = new AbortController();

  constructor(
    private readonly app: App,
    private readonly target: HTMLElement,
    private readonly onRendered: () => void
  ) {
    this.document = new StreamingMarkdownDocument(createObsidianSectionParser(app));
    this.body = target.doc.win.createDiv();
    this.tail = target.doc.win.createDiv();
    this.tail.className = cn("tw-whitespace-pre-wrap tw-break-words");
    target.replaceChildren(this.body, this.tail);
  }

  update(snapshot: MarkdownSnapshot): void {
    if (this.disposed) return;
    const previous = this.latest;
    if (
      previous &&
      previous.text === snapshot.text &&
      previous.sourcePath === snapshot.sourcePath &&
      previous.renderIdentity === snapshot.renderIdentity &&
      previous.contentPolicy === snapshot.contentPolicy &&
      previous.contentClassName === snapshot.contentClassName &&
      previous.preparedText === snapshot.preparedText &&
      previous.isStreaming === snapshot.isStreaming
    )
      return;
    if (
      previous &&
      (previous.renderIdentity !== snapshot.renderIdentity ||
        previous.sourcePath !== snapshot.sourcePath ||
        previous.contentPolicy !== snapshot.contentPolicy ||
        previous.contentClassName !== snapshot.contentClassName ||
        (previous.text === snapshot.text && previous.preparedText !== snapshot.preparedText) ||
        !snapshot.text.startsWith(previous.text))
    ) {
      this.generation++;
      this.abort.abort();
      this.abort = new AbortController();
      this.clearRecords();
      this.document = new StreamingMarkdownDocument(createObsidianSectionParser(this.app));
      this.presentedText = "";
    }
    this.latest = snapshot;
    this.pending = snapshot;
    this.updateTail();
    if (!this.running) void this.drain();
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.pending = null;
    this.abort.abort();
    this.clearRecords();
    this.target.replaceChildren();
  }

  private updateTail(): void {
    const text = this.latest?.text ?? "";
    this.tail.textContent = text.startsWith(this.presentedText)
      ? text.slice(this.presentedText.length)
      : text;
  }

  private clearRecords(): void {
    for (const record of this.records.values()) record.component?.unload();
    this.records.clear();
    this.body.replaceChildren();
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.pending && !this.disposed) {
        const snapshot = this.pending;
        const generation = this.generation;
        this.pending = null;
        const blocks: readonly MarkdownDisplayBlock[] =
          snapshot.contentPolicy === "model" && snapshot.preparedText === undefined
            ? await this.document.update(snapshot.text)
            : [{ id: "whole", text: snapshot.text, kind: "markdown", closed: true }];
        if (this.disposed || generation !== this.generation) continue;
        this.reconcile(blocks);
        this.presentedText = snapshot.text;
        this.updateTail();
        for (const block of blocks) {
          if (this.disposed || generation !== this.generation) break;
          const record = this.records.get(block.id)!;
          const enhancement = inspectMarkdownEnhancement(block.text);
          const heavy = enhancement.heavy;
          if (
            record.enhanced ||
            record.attempted ||
            !block.text ||
            (snapshot.contentPolicy === "model" &&
              ((!enhancement.closed && heavy) || enhancement.oversized))
          )
            continue;
          await this.renderRecord(record, snapshot, generation, heavy);
          if (this.pending) break;
        }
        if (!this.disposed && generation === this.generation && !this.pending) this.onRendered();
      }
    } catch (error) {
      logWarn("[Markdown] display update failed", error);
    } finally {
      this.running = false;
      if (this.pending && !this.disposed) void this.drain();
    }
  }

  private reconcile(blocks: readonly MarkdownDisplayBlock[]): void {
    const ids = new Set(blocks.map((block) => block.id));
    for (const [id, record] of this.records) {
      if (ids.has(id)) continue;
      record.component?.unload();
      record.element.remove();
      this.records.delete(id);
    }
    let next = this.body.firstChild;
    for (const block of blocks) {
      let record = this.records.get(block.id);
      if (!record) {
        const element = this.target.doc.win.createDiv();
        element.className = cn("tw-relative");
        record = { block, element, enhanced: false, attempted: false };
        this.records.set(block.id, record);
        this.setPlainText(record);
      } else if (record.block.text !== block.text || record.block.closed !== block.closed) {
        record.component?.unload();
        record.component = undefined;
        record.block = block;
        record.enhanced = false;
        record.attempted = false;
        this.setPlainText(record);
      }
      if (record.element === next) next = next.nextSibling;
      else this.body.insertBefore(record.element, next);
    }
  }

  private setPlainText(record: DisplayRecord): void {
    const plain = this.target.doc.win.createDiv();
    plain.className = cn("tw-whitespace-pre-wrap tw-break-words");
    plain.textContent = record.block.text;
    record.element.replaceChildren(plain);
  }

  private async renderRecord(
    record: DisplayRecord,
    snapshot: MarkdownSnapshot,
    generation: number,
    heavy: boolean
  ): Promise<void> {
    const work = this.target.doc.win.createDiv();
    work.className = cn("tw-pointer-events-none tw-invisible tw-absolute tw-inset-x-0 tw-top-0");
    work.setAttribute("aria-hidden", "true");
    work.setAttribute("inert", "");
    const component = new Component();
    component.load();
    record.component = component;
    record.attempted = true;
    record.element.appendChild(work);
    const current = (): boolean =>
      !this.disposed &&
      generation === this.generation &&
      this.records.get(record.block.id) === record;
    const render = async (): Promise<void> => {
      if (!current()) return;
      const text =
        snapshot.preparedText ??
        (snapshot.contentPolicy === "model"
          ? preprocessAIResponse(record.block.text)
          : record.block.text);
      await renderMarkdown(this.app, text, work, snapshot.sourcePath, component);
    };
    try {
      if (heavy) await scheduleMarkdownEnhancement(record.element, render, this.abort.signal);
      else await render();
      if (!current()) return;
      work.className = cn(snapshot.contentClassName);
      work.removeAttribute("aria-hidden");
      work.removeAttribute("inert");
      record.element.replaceChildren(work);
      record.enhanced = true;
    } catch (error) {
      if (current()) logWarn("[Markdown] render failed", error);
    } finally {
      if (!current() || !record.enhanced) {
        work.remove();
        component.unload();
        if (record.component === component) record.component = undefined;
      }
    }
  }
}
