import {
  FULL_BLEED_MODAL_CLASS,
  FullBleedReactModal,
  ReactModal,
  UNTITLED_MODAL_CLASS,
} from "@/components/modals/ReactModal";
import { App } from "obsidian";
import React from "react";

class TestModal extends ReactModal {
  protected renderContent(): React.ReactElement {
    return <p>body</p>;
  }
}

class TestFullBleedModal extends FullBleedReactModal {
  protected renderContent(): React.ReactElement {
    return <p>body</p>;
  }
}

describe("ReactModal", () => {
  describe("ReactModal", () => {
    describe("constructor()", () => {
      it("marks the frame untitled when no title is given so the shell can collapse the empty header", () => {
        const modal = new TestModal(new App());

        expect(modal.titleEl.textContent).toBe("");
        expect(modal.modalEl.classList.contains(UNTITLED_MODAL_CLASS)).toBe(true);
      });

      it("writes the given title into the native title element without the untitled marker", () => {
        const modal = new TestModal(new App(), "Configure Codex");

        expect(modal.titleEl.textContent).toBe("Configure Codex");
        expect(modal.modalEl.classList.contains(UNTITLED_MODAL_CLASS)).toBe(false);
      });

      it("puts the given modal class on the frame rather than its content", () => {
        const modal = new TestModal(new App(), undefined, FULL_BLEED_MODAL_CLASS);

        expect(modal.modalEl.classList.contains(FULL_BLEED_MODAL_CLASS)).toBe(true);
        expect(modal.contentEl.classList.contains(FULL_BLEED_MODAL_CLASS)).toBe(false);
      });
    });
  });

  describe("FullBleedReactModal", () => {
    describe("constructor()", () => {
      it("applies the shared frame class before the modal is opened", () => {
        const modal = new TestFullBleedModal(new App());

        expect(modal.containerEl.isConnected).toBe(false);
        expect(modal.modalEl.classList.contains(FULL_BLEED_MODAL_CLASS)).toBe(true);
      });
    });
  });
});
