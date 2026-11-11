import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import { SkillModal } from "@/agentMode/skills/ui/SkillModal";
const mockClose = jest.fn();
const mockRender = jest.fn();
const mockUnmount = jest.fn();
const mockTitle = jest.fn();
jest.mock("@/components/modals/ReactModal", () => ({
  ReactModal: class {
    constructor(_app: unknown, title: string) {
      mockTitle(title);
    }
    onOpen() {
      mockRender(
        (
          this as unknown as { renderContent: (close: () => void) => React.ReactElement }
        ).renderContent(mockClose)
      );
    }
    onClose() {
      mockUnmount();
    }
  },
}));
describe("SkillModal", () => {
  describe("SkillModal", () => {
    beforeEach(() => jest.clearAllMocks());
    describe("constructor()", () => {
      it("passes the title and app to the shared modal lifecycle", () => {
        const modal = new SkillModal({} as App, "Skill details", () => <p>Skill content</p>);
        expect(mockTitle).toHaveBeenCalledWith("Skill details");
        modal.onOpen();
        expect(mockRender).toHaveBeenCalledTimes(1);
      });
    });
    describe("renderContent()", () => {
      it("renders the supplied view with the owning modal's close action", () => {
        const modal = new SkillModal({} as App, "Skill", (close) => (
          <button type="button" onClick={close}>
            Close skill
          </button>
        ));
        modal.onOpen();
        render(mockRender.mock.calls[0][0]);
        fireEvent.click(screen.getByRole("button", { name: "Close skill" }));
        expect(mockClose).toHaveBeenCalledTimes(1);
      });
    });
    describe("onClose()", () => {
      it("unmounts the shared root before notifying cancellation subscribers", () => {
        const order: string[] = [];
        mockUnmount.mockImplementation(() => order.push("unmount"));
        const modal = new SkillModal(
          {} as App,
          "Skill",
          () => <p>Content</p>,
          () => order.push("closed")
        );
        modal.onClose();
        expect(order).toEqual(["unmount", "closed"]);
      });
    });
  });
});
