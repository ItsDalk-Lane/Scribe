import type { TurnFileChange } from "@/agentMode/session/types";
import { activeAgentDetailModal, closeAgentDetailModals } from "@/agentMode/ui/AgentDetailModal";
import {
  closeRestoredTurnDiffs,
  openTurnDiff,
  registerTurnDiffCommands,
  TurnDiffModal,
  TurnDiffPane,
} from "@/agentMode/ui/TurnDiffView";
import {
  appParsing,
  type RecordedParse,
} from "@/agentMode/ui/renderedDiff/testing/recordedParserApp";
import { TURN_DIFF_VIEW_TYPE } from "@/constants";
import { setInterfaceLocale } from "@/lib/i18n";
import { logError } from "@/logger";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { AppContext } from "@/context";
import { App, type Command, Notice, type Plugin, TFile, type Workspace } from "obsidian";
import React from "react";

jest.mock("obsidian", () => {
  const actual = jest.requireActual<typeof import("obsidian")>("obsidian");
  const { nativeModalFixture } = jest.requireActual<
    typeof import("@/agentMode/ui/testing/nativeModalFixture")
  >("@/agentMode/ui/testing/nativeModalFixture");
  return { ...actual, Modal: nativeModalFixture(actual.Modal) };
});
jest.mock("@/logger");
jest.mock("@/utils/renderMarkdown", () => ({
  renderMarkdown: jest.fn((_app, markdown: string, el: HTMLElement) => {
    el.textContent = markdown;
    return Promise.resolve();
  }),
}));

const BEFORE = "The quick brown fox.\n";
const AFTER = "The quick red fox.\n";
const PARSE: RecordedParse = { sections: [["paragraph", 0, 0]] };
const apps: App[] = [];
function change(path = "notes/alpha.md", overrides: Partial<TurnFileChange> = {}): TurnFileChange {
  return {
    path,
    status: "modified",
    before: BEFORE,
    after: AFTER,
    additions: 1,
    deletions: 1,
    ...overrides,
  };
}
function fakeApp(files: TFile[] = [], parse: RecordedParse | Promise<RecordedParse> = PARSE): App {
  const app = {
    ...appParsing(async () => parse),
    keymap: { pushScope: jest.fn(), popScope: jest.fn() },
    workspace: {
      getActiveFile: () => null,
      iterateAllLeaves: jest.fn(),
      getLeaf: jest.fn(() => ({ openFile: jest.fn().mockResolvedValue(undefined) })),
    },
    vault: {
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
    },
  } as unknown as App;
  apps.push(app);
  return app;
}
async function opened(
  app = fakeApp(),
  fileChange = change(),
  turnId = "turn-1"
): Promise<TurnDiffModal> {
  let modal!: TurnDiffModal;
  await act(async () => {
    modal = await openTurnDiff(app, fileChange, turnId);
  });
  return modal;
}
function header(modal: TurnDiffModal): HTMLElement {
  return within(modal.contentEl).getByTitle(/\.(md|canvas|json)$/).parentElement!;
}
const textOf = (modal: TurnDiffModal, selector: string) =>
  [...modal.contentEl.querySelectorAll(selector)].map((element) => element.textContent);
async function rendered(app = fakeApp()): Promise<TurnDiffModal> {
  const modal = await opened(app);
  await waitFor(() => expect(within(header(modal)).getByText("1 of 1")).toBeTruthy());
  return modal;
}

describe("TurnDiffView", () => {
  beforeEach(() => {
    HTMLElement.prototype.animate = jest.fn();
    jest.spyOn(window, "focus").mockImplementation(() => {
      window.activeWindow = window;
      window.activeDocument = window.document;
    });
  });
  afterEach(() => {
    act(() => {
      for (const app of apps.splice(0)) closeAgentDetailModals(app);
    });
    jest.restoreAllMocks();
    setInterfaceLocale("en");
  });

  describe("TurnDiffModal", () => {
    describe("renderContent()", () => {
      it("shows the file title and rendered changes above the chat without opening an operating-system window", async () => {
        const app = fakeApp();
        const modal = await opened(app, change("notes/alpha.md", { additions: 4, deletions: 2 }));
        expect(modal.titleEl.textContent).toBe("alpha.md");
        expect(modal.containerEl.isConnected).toBe(true);
        expect(app.workspace.getLeaf).not.toHaveBeenCalled();
        expect(within(header(modal)).getByText("+4")).toBeTruthy();
        expect(within(header(modal)).getByText("−2")).toBeTruthy();
        await waitFor(() => expect(textOf(modal, "del")).toEqual(["brown"]));
        expect(textOf(modal, "ins")).toEqual(["red"]);
        expect(modal.contentEl.querySelector("pre")).toBeNull();
      });

      it("shows the header immediately and change navigation only after the note has parsed", async () => {
        let finish!: (parse: RecordedParse) => void;
        const parse = new Promise<RecordedParse>((resolve) => {
          finish = resolve;
        });
        const modal = await opened(fakeApp([], parse));
        expect(within(header(modal)).getByTitle("notes/alpha.md")).toBeTruthy();
        expect(modal.contentEl.querySelector(".markdown-rendered")?.childNodes).toHaveLength(0);
        expect(modal.stepChange(1, true)).toBe(false);
        finish(PARSE);
        await waitFor(() =>
          expect(
            within(modal.contentEl).getByRole("button", { name: "Go to change 1 of 1" })
          ).toBeTruthy()
        );
      });

      it("shows created and deleted files truthfully and offers no Open note for a deleted file", async () => {
        const app = fakeApp();
        const created = await opened(
          app,
          change("notes/new.md", { status: "created", before: null })
        );
        expect(within(header(created)).getByText("new")).toBeTruthy();
        const deleted = await opened(
          app,
          change("notes/gone.md", { status: "deleted", after: null })
        );
        expect(within(header(deleted)).getByText("deleted")).toBeTruthy();
        expect(within(header(deleted)).queryByText("Open note")).toBeNull();
      });

      it("shows non-markdown files as a whole-file line diff", async () => {
        const modal = await opened(
          fakeApp(),
          change("notes/board.canvas", { before: '{"nodes": []}\n', after: '{"nodes": [1]}\n' })
        );
        const lineDiff = modal.contentEl.querySelector("pre")!;
        expect(lineDiff.querySelector("[data-change=deleted]")?.textContent).toBe('{"nodes": []}');
        expect(lineDiff.querySelector("[data-change=inserted]")?.textContent).toBe(
          '{"nodes": [1]}'
        );
      });

      it("opens the note only when explicitly requested and keeps the diff modal available", async () => {
        const file = Object.assign(new TFile(), { path: "notes/alpha.md" });
        const app = fakeApp([file]);
        const modal = await rendered(app);
        fireEvent.click(within(header(modal)).getByText("Open note"));
        expect(app.workspace.getLeaf).toHaveBeenCalledWith("tab");
        const leaf = jest.mocked(app.workspace.getLeaf).mock.results[0].value;
        expect(leaf.openFile).toHaveBeenCalledWith(file);
        expect(modal.containerEl.isConnected).toBe(true);
      });

      it("does not recreate a file that was renamed or deleted after the turn https://github.com/Brevilabs/obsidian-copilot-private/issues/348", async () => {
        const app = fakeApp();
        const modal = await rendered(app);
        fireEvent.click(within(header(modal)).getByText("Open note"));
        expect(app.workspace.getLeaf).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith("notes/alpha.md no longer exists.");
      });

      it("logs a failure to open the note without closing the diff", async () => {
        const file = Object.assign(new TFile(), { path: "notes/alpha.md" });
        const app = fakeApp([file]);
        const failure = new Error("Cannot open note");
        jest
          .mocked(app.workspace.getLeaf)
          .mockReturnValue({ openFile: jest.fn().mockRejectedValue(failure) } as never);
        const modal = await rendered(app);
        fireEvent.click(within(header(modal)).getByText("Open note"));
        await waitFor(() =>
          expect(logError).toHaveBeenCalledWith("[TurnDiffView] failed to open the note", failure)
        );
        expect(modal.containerEl.isConnected).toBe(true);
      });
    });

    describe("stepChange()", () => {
      it("reports available changes without moving during a check and moves when requested", async () => {
        const modal = await rendered();
        expect(modal.stepChange(1, true)).toBe(true);
        act(() => {
          expect(modal.stepChange(1, false)).toBe(true);
        });
        expect(within(header(modal)).getByText("1 of 1")).toBeTruthy();
      });
    });

    describe("onClose()", () => {
      it("unmounts its content and disables navigation when closed", async () => {
        const modal = await rendered();
        act(() => modal.close());
        expect(modal.contentEl.childNodes).toHaveLength(0);
        expect(modal.containerEl.isConnected).toBe(false);
        expect(modal.stepChange(1, true)).toBe(false);
      });
    });
  });

  describe("openTurnDiff()", () => {
    it("reuses a file modal on concurrent clicks, keeps other files separate, and brings the requested modal forward", async () => {
      const app = fakeApp();
      let first!: TurnDiffModal;
      let duplicate!: TurnDiffModal;
      await act(async () => {
        [first, duplicate] = await Promise.all([
          openTurnDiff(app, change(), "turn-1"),
          openTurnDiff(app, change(), "turn-1"),
        ]);
      });
      expect(duplicate).toBe(first);
      await waitFor(() => expect(first.stepChange(1, true)).toBe(true));
      const second = await opened(app, change("notes/beta.md"));
      expect(second).not.toBe(first);
      expect(activeAgentDetailModal(app)).toBe(second);
      await act(async () => {
        await openTurnDiff(app, change(), "turn-1");
      });
      expect(activeAgentDetailModal(app)).toBe(first);
      expect(first.containerEl.isConnected).toBe(true);
      expect(first.stepChange(1, true)).toBe(true);
      const laterTurn = await opened(app, change(), "turn-2");
      expect(laterTurn).not.toBe(first);
    });

    it("releases a failed modal and permits retrying the same file", async () => {
      const app = fakeApp();
      jest.spyOn(TurnDiffModal.prototype, "onOpen").mockImplementationOnce(() => {
        throw new Error("Failed to open");
      });
      await expect(openTurnDiff(app, change(), "turn-1")).rejects.toThrow("Failed to open");
      expect(activeAgentDetailModal(app)).toBeNull();
      expect((await opened(app)).containerEl.isConnected).toBe(true);
    });
  });

  describe("TurnDiffPane()", () => {
    it("renders the saved file change and exposes navigation once the content is ready", async () => {
      const onStepperChange = jest.fn();
      const result = render(
        <AppContext.Provider value={fakeApp()}>
          <TurnDiffPane
            state={{ ...change(), turnId: "turn-1" }}
            onStepperChange={onStepperChange}
          />
        </AppContext.Provider>
      );
      await waitFor(() =>
        expect(
          within(result.container).getByRole("button", { name: "Go to change 1 of 1" })
        ).toBeTruthy()
      );
      expect(within(result.container).getByTitle("notes/alpha.md")).toBeTruthy();
      expect(onStepperChange).toHaveBeenLastCalledWith(expect.any(Function));
      result.unmount();
      expect(onStepperChange).toHaveBeenLastCalledWith(null);
    });
  });

  describe("registerTurnDiffCommands()", () => {
    function commands(app: App): Command[] {
      const result: Command[] = [];
      registerTurnDiffCommands({
        app,
        addCommand: (command: Command) => result.push(command),
      } as unknown as Plugin);
      return result;
    }
    it("preserves Chinese command names and identifiers", () => {
      setInterfaceLocale("zh-CN");
      expect(commands(fakeApp()).map(({ id, name }) => ({ id, name }))).toEqual([
        { id: "turn-diff-next-change", name: "跳到文件差异中的下一处修改" },
        { id: "turn-diff-previous-change", name: "跳到文件差异中的上一处修改" },
      ]);
    });
    it("navigates the active diff modal and becomes unavailable after it closes", async () => {
      const app = fakeApp();
      const modal = await rendered(app);
      const [next, previous] = commands(app);
      expect(next.checkCallback?.(true)).toBe(true);
      act(() => {
        previous.checkCallback?.(false);
      });
      expect(within(header(modal)).getByText("1 of 1")).toBeTruthy();
      act(() => modal.close());
      expect(next.checkCallback?.(true)).toBe(false);
    });
  });

  describe("closeRestoredTurnDiffs()", () => {
    it("closes legacy diff tabs and task windows once the workspace is ready", () => {
      let ready!: () => void;
      const detachLeavesOfType = jest.fn();
      closeRestoredTurnDiffs({
        onLayoutReady: (callback: () => void) => {
          ready = callback;
        },
        detachLeavesOfType,
      } as unknown as Workspace);
      expect(detachLeavesOfType).not.toHaveBeenCalled();
      ready();
      expect(detachLeavesOfType.mock.calls).toEqual([
        [TURN_DIFF_VIEW_TYPE],
        ["scribe-task-detail-view"],
      ]);
    });
  });
});
