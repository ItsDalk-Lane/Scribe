import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SkillDraftReview, reviewSkillDraft } from "@/agentMode/skills/ui/SkillDraftModal";
import type { App } from "obsidian";

jest.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    disabled,
    onCheckedChange,
    ...props
  }: {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange: (checked: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.target.checked)}
      {...props}
    />
  ),
}));
const mockCreate = jest.fn();
let mockModal: { close: () => void; content: React.ReactElement };
jest.mock("@/agentMode/skills/SkillManager", () => ({
  SkillManager: { getInstance: () => ({ createSkill: mockCreate }) },
}));
jest.mock("@/agentMode/skills/ui/SkillModal", () => ({
  SkillModal: class {
    content: React.ReactElement;
    constructor(
      _app: unknown,
      _title: string,
      content: (close: () => void) => React.ReactElement,
      private onClosed: () => void
    ) {
      this.content = content(() => this.close());
      mockModal = { content: this.content, close: () => this.close() };
    }
    open() {}
    close() {
      this.onClosed();
    }
  },
}));
const draft = { name: "review-notes", description: "Review notes", body: "Complete instructions" };
describe("SkillDraftModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ ok: true });
  });
  describe("SkillDraftReview()", () => {
    it("shows the full editable draft and writes only after Save", async () => {
      const onSaved = jest.fn();
      render(<SkillDraftReview draft={draft} onSaved={onSaved} onCancel={jest.fn()} />);
      expect(screen.getByLabelText<HTMLTextAreaElement>("File contents").value).toContain(
        "Complete instructions"
      );
      expect(mockCreate).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText("File contents"), {
        target: {
          value: screen
            .getByLabelText<HTMLTextAreaElement>("File contents")
            .value.replace('"review-notes"', '"better-review"'),
        },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      expect(mockCreate).toHaveBeenCalledWith(
        "better-review",
        expect.stringContaining("Complete instructions"),
        undefined
      );
      expect(onSaved).toHaveBeenCalledWith("better-review");
    });
    it("keeps a rejected draft editable without losing the user's changes", async () => {
      mockCreate.mockResolvedValue({ ok: false, message: "Name conflict" });
      render(<SkillDraftReview draft={draft} onSaved={jest.fn()} onCancel={jest.fn()} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      expect(screen.getByRole("alert").textContent).toContain("Name conflict");
      expect(screen.getByLabelText<HTMLTextAreaElement>("File contents").value).toContain(
        draft.body
      );
    });
  });
  describe("reviewSkillDraft()", () => {
    it("returns the saved name only after explicit confirmation", async () => {
      const result = reviewSkillDraft({} as App, draft);
      render(mockModal.content);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      await expect(result).resolves.toEqual({ name: "review-notes" });
    });
    it("returns null without saving when the user dismisses the draft", async () => {
      const result = reviewSkillDraft({} as App, draft);
      render(mockModal.content);
      act(() => mockModal.close());
      await expect(result).resolves.toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });
    it("aborts the pending library write when the draft is closed during saving", async () => {
      let complete!: (result: { ok: boolean; message?: string }) => void;
      const gate = new Promise<{ ok: boolean; message?: string }>((resolve) => {
        complete = resolve;
      });
      mockCreate.mockReturnValue(gate);
      const result = reviewSkillDraft({} as App, draft);
      render(mockModal.content);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      const signal = mockCreate.mock.calls[0][2] as AbortSignal;
      expect(signal.aborted).toBe(false);
      act(() => mockModal.close());
      expect(signal.aborted).toBe(true);
      await act(async () => {
        complete({ ok: false, message: "Cancelled" });
        await gate;
      });
      await expect(result).resolves.toBeNull();
    });
    it("reports a completed install honestly when closing races with the final commit", async () => {
      let complete!: (result: { ok: boolean }) => void;
      const gate = new Promise<{ ok: boolean }>((resolve) => {
        complete = resolve;
      });
      mockCreate.mockReturnValue(gate);
      const result = reviewSkillDraft({} as App, draft);
      render(mockModal.content);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      act(() => mockModal.close());
      await act(async () => {
        complete({ ok: true });
        await gate;
      });
      await expect(result).resolves.toEqual({ name: draft.name });
    });
    it("propagates external cancellation and ignores an already aborted request", async () => {
      const controller = new AbortController();
      const result = reviewSkillDraft({} as App, draft, controller.signal);
      act(() => controller.abort());
      await expect(result).resolves.toBeNull();
      await expect(reviewSkillDraft({} as App, draft, controller.signal)).resolves.toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});
