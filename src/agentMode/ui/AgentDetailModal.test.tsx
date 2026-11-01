import {
  AgentDetailModal,
  activeAgentDetailModal,
  closeAgentDetailModals,
  openAgentDetailModal,
} from "@/agentMode/ui/AgentDetailModal";
import { act, within } from "@testing-library/react";
import { type App, Modal } from "obsidian";
import React from "react";
import { nativeModalHistoryBack } from "@/agentMode/ui/testing/nativeModalFixture";

jest.mock("obsidian", () => {
  const actual = jest.requireActual<typeof import("obsidian")>("obsidian");
  const { nativeModalFixture } = jest.requireActual<
    typeof import("@/agentMode/ui/testing/nativeModalFixture")
  >("@/agentMode/ui/testing/nativeModalFixture");
  return { ...actual, Modal: nativeModalFixture(actual.Modal) };
});

class Detail extends AgentDetailModal {
  protected renderContent(): React.ReactElement {
    return (
      <label>
        Review notes
        <input defaultValue="Keep this draft" />
      </label>
    );
  }
}
function fixture(): App {
  return { keymap: { pushScope: jest.fn(), popScope: jest.fn() } } as unknown as App;
}
const apps: App[] = [];
function open(app: App, key = "detail-1") {
  apps.push(app);
  let modal!: Detail;
  act(() => {
    modal = openAgentDetailModal(app, key, () => new Detail(app, key, "Task details"));
  });
  return modal;
}

describe("AgentDetailModal", () => {
  beforeEach(() => {
    jest.spyOn(window, "focus").mockImplementation(() => {
      window.activeWindow = window;
      window.activeDocument = window.document;
    });
  });
  afterEach(() => {
    act(() => {
      for (const app of apps.splice(0)) closeAgentDetailModals(app);
    });
    window.activeWindow = window;
    window.activeDocument = window.document;
    jest.restoreAllMocks();
  });

  describe("AgentDetailModal", () => {
    describe("constructor()", () => {
      it("uses the existing native React modal with its native title and content", () => {
        const app = fixture();
        const modal = open(app);
        expect(modal).toBeInstanceOf(Modal);
        expect(modal.detailKey).toBe("detail-1");
        expect(modal.titleEl.textContent).toBe("Task details");
        expect(within(modal.contentEl).getByRole("textbox")).toBeTruthy();
      });
    });
    describe("bringToFront()", () => {
      it("keeps native history aligned so Back closes the raised modal rather than the covered one", () => {
        const app = fixture();
        const first = open(app);
        const second = open(app, "detail-2");
        first.bringToFront();
        act(() => nativeModalHistoryBack(window));
        expect(first.containerEl.isConnected).toBe(false);
        expect(second.containerEl.isConnected).toBe(true);
        expect(activeAgentDetailModal(app)).toBe(second);
      });

      it("returns to the modal's owning window before changing native keyboard scopes", () => {
        const app = fixture();
        const first = open(app);
        const iframe = document.createElement("iframe");
        document.body.appendChild(iframe);
        const other = iframe.contentWindow!;
        const scopeWindows: Window[] = [];
        jest.mocked(app.keymap.pushScope).mockImplementation(() => {
          scopeWindows.push(activeWindow);
        });
        jest.spyOn(window, "focus").mockImplementation(() => {
          window.activeWindow = window;
          window.activeDocument = window.document;
        });
        window.activeWindow = other;
        window.activeDocument = other.document;
        first.bringToFront();
        expect(scopeWindows.at(-1) === window).toBe(true);
        expect(first.containerEl.doc).toBe(window.document);
        expect(activeWindow === window).toBe(true);
        iframe.remove();
      });

      it("raises the same modal and its keyboard scope while retaining its entered content", () => {
        const app = fixture();
        const first = open(app);
        open(app, "detail-2");
        const input = within(first.contentEl).getByRole<HTMLInputElement>("textbox");
        input.value = "Review in progress";
        first.bringToFront();
        expect(activeAgentDetailModal(app)).toBe(first);
        expect(input.value).toBe("Review in progress");
        expect(app.keymap.pushScope).toHaveBeenLastCalledWith(first.scope);
        expect(first.modalEl.doc.activeElement).toBe(first.modalEl);
      });
    });
    describe("onClose()", () => {
      it("unmounts the modal and removes it from the reusable modal registry", () => {
        const app = fixture();
        const first = open(app);
        act(() => first.close());
        expect(first.contentEl.childNodes).toHaveLength(0);
        expect(activeAgentDetailModal(app)).toBeNull();
        expect(open(app)).not.toBe(first);
      });
    });
  });
  describe("openAgentDetailModal()", () => {
    it("reuses an open modal for the same object and isolates different app instances", () => {
      const app = fixture();
      const first = open(app);
      const create = jest.fn(() => new Detail(app, "detail-1", "Task details"));
      const duplicate = openAgentDetailModal(app, "detail-1", create);
      expect(duplicate).toBe(first);
      expect(create).not.toHaveBeenCalled();
      expect(open(fixture())).not.toBe(first);
    });
  });
  describe("activeAgentDetailModal()", () => {
    it("selects the top detail in the focused document when the same app has multiple windows", () => {
      const app = fixture();
      open(app);
      const iframe = document.createElement("iframe");
      document.body.appendChild(iframe);
      const other = iframe.contentWindow!;
      try {
        window.activeWindow = other;
        window.activeDocument = other.document;
        const second = open(app, "detail-2");
        expect(activeAgentDetailModal(app) === second).toBe(true);
      } finally {
        act(() => closeAgentDetailModals(app));
        iframe.remove();
      }
    });
    it("reports no active detail when another native modal covers it", () => {
      const app = fixture();
      const first = open(app);
      const unrelated = document.createElement("div");
      unrelated.className = "modal-container";
      document.body.appendChild(unrelated);
      expect(activeAgentDetailModal(app)).toBeNull();
      unrelated.remove();
      expect(activeAgentDetailModal(app)).toBe(first);
    });
  });
  describe("closeAgentDetailModals()", () => {
    it("closes all detail modals during plugin cleanup while leaving unrelated content alone", () => {
      const app = fixture();
      const first = open(app);
      const second = open(app, "detail-2");
      act(() => closeAgentDetailModals(app));
      expect(first.containerEl.isConnected).toBe(false);
      expect(second.containerEl.isConnected).toBe(false);
      expect(activeAgentDetailModal(app)).toBeNull();
    });
  });
});
