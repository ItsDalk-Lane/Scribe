import React from "react";
import { fireEvent, render, screen, waitFor, cleanup, act } from "@testing-library/react";
import { SubagentsSettings } from "./SubagentsSettings";

const mockRefresh = jest.fn(async () => []);
const mockSave = jest.fn(async (_value: object) => {});
const mockRemove = jest.fn(async (_id: string) => {});
const mockClose = jest.fn();
const mockManager = { refresh: mockRefresh, save: mockSave, remove: mockRemove };
let mockConfirm: () => void | Promise<void>;
let mockItems = [
  {
    id: "one",
    name: "Reviewer",
    description: "Check notes",
    instructions: "Read facts.",
    enabled: true,
    revision: "original",
  },
];
jest.mock("@/context", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- matches the real hook export
  useApp: () => ({}),
}));
jest.mock("@/agentMode/subagents/SubagentManager", () => ({
  SubagentManager: {
    getInstance: () => mockManager,
  },
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- matches the real hook export
  useSubagents: () => mockItems,
}));
jest.mock("@/components/modals/ReactModal", () => ({
  ReactModal: class {
    renderContent(_close: () => void) {
      return <div />;
    }
    open() {
      render(this.renderContent(mockClose));
    }
  },
}));
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: class {
    constructor(_app: unknown, confirm: () => void | Promise<void>) {
      mockConfirm = confirm;
    }
    open() {}
  },
}));

describe("SubagentsSettings", () => {
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = document;
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });
  describe("SubagentsSettings()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockSave.mockResolvedValue();
      mockRefresh.mockResolvedValue([]);
      mockItems = [
        {
          id: "one",
          name: "Reviewer",
          description: "Check notes",
          instructions: "Read facts.",
          enabled: true,
          revision: "original",
        },
      ];
    });
    it("refreshes on opening and reopening, and preserves the opening revision when toggling", async () => {
      const changed = jest.fn(async () => {});
      const view = render(<SubagentsSettings onChanged={changed} />);
      await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole("switch", { name: "Enable Reviewer" }));
      await waitFor(() =>
        expect(mockSave).toHaveBeenCalledWith({ ...mockItems[0], enabled: false })
      );
      await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
      view.unmount();
      render(<SubagentsSettings />);
      await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(2));
    });
    it("creates a new definition and keeps an edited draft open after a failed save", async () => {
      render(<SubagentsSettings />);
      fireEvent.click(screen.getByRole("button", { name: "New subagent" }));
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Writer" } });
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Draft notes" } });
      fireEvent.change(screen.getByLabelText("Instructions"), {
        target: { value: "Write clearly." },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          name: "Writer",
          instructions: "Write clearly.",
        })
      );
      cleanup();
      mockSave.mockRejectedValueOnce(new Error("Conflict"));
      render(<SubagentsSettings />);
      fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for Reviewer" }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText("Instructions"), {
        target: { value: "Keep this draft" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Conflict");
      expect(screen.getByLabelText<HTMLTextAreaElement>("Instructions").value).toBe(
        "Keep this draft"
      );
      expect(mockSave).toHaveBeenLastCalledWith({
        ...mockItems[0],
        instructions: "Keep this draft",
      });
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
    it("requires confirmation before deletion and displays removal failures", async () => {
      mockRemove.mockRejectedValueOnce(new Error("Removal failed"));
      render(<SubagentsSettings />);
      fireEvent.pointerDown(screen.getByRole("button", { name: "More actions for Reviewer" }), {
        button: 0,
        ctrlKey: false,
      });
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
      expect(mockRemove).not.toHaveBeenCalled();
      await act(async () => {
        await mockConfirm();
      });
      expect((await screen.findByRole("alert")).textContent).toBe("Removal failed");
      expect(mockRemove).toHaveBeenCalledWith("one");
    });
    it("filters the list and reports refresh failures without discarding saved definitions", async () => {
      mockRefresh.mockRejectedValueOnce(new Error("Cannot read files"));
      render(<SubagentsSettings query="missing" />);
      expect((await screen.findByRole("alert")).textContent).toBe("Cannot read files");
      expect(screen.queryByText("Reviewer")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    });
  });
});
