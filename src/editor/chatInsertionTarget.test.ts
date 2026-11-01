import { getChatInsertionTarget, rememberChatInsertionTarget } from "@/editor/chatInsertionTarget";
import { MarkdownView, type App, type WorkspaceLeaf } from "obsidian";

jest.mock("obsidian", () => ({
  ...jest.requireActual<typeof import("obsidian")>("obsidian"),
  MarkdownView: class {},
}));

function fixture() {
  const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
    file: { path: "Source.md" },
  });
  const leaf = { view } as unknown as WorkspaceLeaf;
  const open: WorkspaceLeaf[] = [leaf];
  const app = { workspace: { getLeavesOfType: () => open } } as unknown as App;
  return { app, leaf, open };
}

describe("chatInsertionTarget", () => {
  describe("rememberChatInsertionTarget()", () => {
    it("keeps each vault's last focused note separate and clears it on cleanup", () => {
      const first = fixture();
      const second = fixture();
      rememberChatInsertionTarget(first.app, first.leaf);
      rememberChatInsertionTarget(second.app, second.leaf);
      expect(getChatInsertionTarget(first.app)).toBe(first.leaf);
      expect(getChatInsertionTarget(second.app)).toBe(second.leaf);
      rememberChatInsertionTarget(first.app, null);
      expect(getChatInsertionTarget(first.app)).toBeNull();
      expect(getChatInsertionTarget(second.app)).toBe(second.leaf);
    });
  });

  describe("getChatInsertionTarget()", () => {
    it("returns the recorded note only while its editor remains open", () => {
      const { app, leaf, open } = fixture();
      rememberChatInsertionTarget(app, leaf);
      expect(getChatInsertionTarget(app)).toBe(leaf);
      open.length = 0;
      expect(getChatInsertionTarget(app)).toBeNull();
    });

    it("does not treat a reused chat tab or an empty editor as the recorded note", () => {
      const { app, leaf } = fixture();
      rememberChatInsertionTarget(app, leaf);
      Object.assign(leaf, { view: {} });
      expect(getChatInsertionTarget(app)).toBeNull();
      const empty = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
        file: null,
      });
      Object.assign(leaf, { view: empty });
      expect(getChatInsertionTarget(app)).toBeNull();
    });

    it("returns no target before a note has been focused", () => {
      expect(getChatInsertionTarget(fixture().app)).toBeNull();
    });

    it("does not insert into another note that reused the recorded editor", () => {
      const { app, leaf } = fixture();
      rememberChatInsertionTarget(app, leaf);
      Object.assign(leaf.view, { file: { path: "Other.md" } });
      expect(getChatInsertionTarget(app)).toBeNull();
    });
  });
});
