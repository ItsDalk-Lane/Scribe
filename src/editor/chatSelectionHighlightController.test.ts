import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MarkdownView, type WorkspaceLeaf } from "obsidian";
import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import {
  ChatSelectionHighlightController,
  hideChatSelectionHighlight,
} from "@/editor/chatSelectionHighlightController";
import type CopilotPlugin from "@/main";
import type { SelectedTextContext } from "@/types/message";
import { getChatInsertionTarget } from "@/editor/chatInsertionTarget";

jest.mock("@/logger");
jest.mock("obsidian", () => ({
  ...jest.requireActual<typeof import("obsidian")>("obsidian"),
  MarkdownView: class {},
}));

describe("chatSelectionHighlightController", () => {
  let editor: EditorView;
  let activeMarkdown: MarkdownView | null;
  let markdownLeaf: WorkspaceLeaf;
  let agentLeaf: WorkspaceLeaf;
  let plugin: CopilotPlugin;
  let controller: ChatSelectionHighlightController;
  let closeQuickAsk: jest.Mock;

  const highlightedText = () =>
    editor.dom.querySelector(".copilot-chat-selection-highlight")?.textContent ?? null;

  beforeEach(() => {
    editor = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: "Selected note passage",
        selection: { anchor: 0, head: 8 },
      }),
    });
    activeMarkdown = Object.assign(Object.create(MarkdownView.prototype), {
      editor: { cm: editor },
      file: { path: "Source.md" },
    }) as MarkdownView;
    markdownLeaf = {
      view: activeMarkdown,
      getViewState: () => ({ type: "markdown" }),
    } as unknown as WorkspaceLeaf;
    Object.assign(activeMarkdown, { leaf: markdownLeaf });
    agentLeaf = {
      view: {},
      getViewState: () => ({ type: CHAT_AGENT_VIEWTYPE }),
    } as unknown as WorkspaceLeaf;
    closeQuickAsk = jest.fn();
    plugin = {
      app: {
        workspace: {
          getActiveViewOfType: () => activeMarkdown,
          getLeavesOfType: () => [markdownLeaf],
        },
      },
      quickAskController: { close: closeQuickAsk },
    } as unknown as CopilotPlugin;
    controller = new ChatSelectionHighlightController(plugin);
  });

  afterEach(() => {
    controller.cleanup();
    editor.destroy();
  });

  describe("ChatSelectionHighlightController", () => {
    describe("initialize()", () => {
      it("does not invent a note selection when initialized outside a note", () => {
        activeMarkdown = null;
        controller.initialize();

        controller.handleActiveLeafChange(agentLeaf);

        expect(highlightedText()).toBeNull();
        expect(closeQuickAsk).not.toHaveBeenCalled();
      });
    });

    describe("handleActiveLeafChange()", () => {
      it("keeps the selected passage highlighted when moving from a note into Agent Chat without closing QuickAsk", () => {
        controller.initialize();
        activeMarkdown = null;

        controller.handleActiveLeafChange(agentLeaf);

        expect(highlightedText()).toBe("Selected");
        expect(getChatInsertionTarget(plugin.app)).toBe(markdownLeaf);
        expect(closeQuickAsk).not.toHaveBeenCalled();
      });

      it("clears the retained selection when focus leaves Agent Chat", () => {
        controller.initialize();
        activeMarkdown = null;
        controller.handleActiveLeafChange(agentLeaf);
        expect(highlightedText()).toBe("Selected");

        controller.handleActiveLeafChange(markdownLeaf);

        expect(highlightedText()).toBeNull();
      });

      it("closes QuickAsk on Agent Chat focus only when that option is explicitly enabled", () => {
        controller = new ChatSelectionHighlightController(plugin, {
          closeQuickAskOnChatFocus: true,
        });
        controller.initialize();
        activeMarkdown = null;

        controller.handleActiveLeafChange(agentLeaf);

        expect(highlightedText()).toBe("Selected");
        expect(closeQuickAsk).toHaveBeenCalledWith(false);
      });
    });

    describe("persistFromPointerDown()", () => {
      it("highlights the current note selection before the pointer moves focus into the composer", () => {
        controller.persistFromPointerDown();

        expect(highlightedText()).toBe("Selected");
        expect(closeQuickAsk).not.toHaveBeenCalled();
      });

      it("does not highlight another note when no Markdown editor is active", () => {
        activeMarkdown = null;

        controller.persistFromPointerDown();

        expect(highlightedText()).toBeNull();
      });
    });

    describe("clearIfNoNoteContexts()", () => {
      it("keeps an attached note selection highlighted and clears it after the last note context is removed", () => {
        const context: SelectedTextContext = {
          id: "selected-passage",
          sourceType: "note",
          notePath: "Research.md",
          noteTitle: "Research",
          startLine: 1,
          endLine: 1,
          content: "Selected",
        };
        controller.persistFromPointerDown();

        controller.clearIfNoNoteContexts([context]);
        expect(highlightedText()).toBe("Selected");

        controller.clearIfNoNoteContexts([]);
        expect(highlightedText()).toBeNull();
      });
    });

    describe("cleanup()", () => {
      it("removes the highlight and forgets the previous Markdown leaf", () => {
        controller.initialize();
        controller.persistFromPointerDown();

        controller.cleanup();
        activeMarkdown = null;
        controller.handleActiveLeafChange(agentLeaf);

        expect(highlightedText()).toBeNull();
        expect(getChatInsertionTarget(plugin.app)).toBeNull();
        expect(closeQuickAsk).not.toHaveBeenCalled();
      });
    });
  });

  describe("hideChatSelectionHighlight()", () => {
    it("removes an existing chat highlight from the supplied editor", () => {
      controller.persistFromPointerDown();
      expect(highlightedText()).toBe("Selected");

      hideChatSelectionHighlight(editor);

      expect(highlightedText()).toBeNull();
    });
  });
});
