import { MarkdownView, type App, type TFile, type WorkspaceLeaf } from "obsidian";

interface ChatInsertionTarget {
  leaf: WorkspaceLeaf;
  file: TFile;
}

const targets = new WeakMap<App, ChatInsertionTarget>();

export function rememberChatInsertionTarget(app: App, leaf: WorkspaceLeaf | null): void {
  if (leaf?.view instanceof MarkdownView && leaf.view.file)
    targets.set(app, { leaf, file: leaf.view.file });
  else targets.delete(app);
}

export function getChatInsertionTarget(app: App): WorkspaceLeaf | null {
  const target = targets.get(app);
  const leaf = target?.leaf;
  return leaf?.view instanceof MarkdownView &&
    leaf.view.file === target?.file &&
    app.workspace.getLeavesOfType("markdown").includes(leaf)
    ? leaf
    : null;
}
