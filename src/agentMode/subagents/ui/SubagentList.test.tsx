import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SubagentList } from "./SubagentList";
const item = {
  id: "reviewer",
  name: "Reviewer",
  description: "Review facts",
  instructions: "Check claims",
  enabled: true,
};

describe("SubagentList", () => {
  describe("SubagentList()", () => {
    it("lists independently enabled subagents and routes edits, deletion and toggles to the selected item", () => {
      const edit = jest.fn(),
        remove = jest.fn(),
        toggle = jest.fn();
      render(
        <SubagentList
          items={[item, { ...item, id: "writer", name: "Writer", enabled: false }]}
          onEdit={edit}
          onRemove={remove}
          onToggle={toggle}
        />
      );
      expect(
        screen.getByRole("switch", { name: "Enable Reviewer" }).getAttribute("aria-checked")
      ).toBe("true");
      expect(
        screen.getByRole("switch", { name: "Enable Writer" }).getAttribute("aria-checked")
      ).toBe("false");
      fireEvent.click(screen.getByRole("button", { name: "Edit Reviewer" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete Reviewer" }));
      fireEvent.click(screen.getByRole("switch", { name: "Enable Reviewer" }));
      expect(edit).toHaveBeenCalledWith(item);
      expect(remove).toHaveBeenCalledWith(item);
      expect(toggle).toHaveBeenCalledWith(item, false);
    });
    it("shows the empty state and prevents actions during a pending save", () => {
      const { rerender } = render(
        <SubagentList items={[]} onEdit={() => {}} onRemove={() => {}} onToggle={() => {}} />
      );
      expect(screen.getByText("No custom subagents yet.")).toBeTruthy();
      rerender(
        <SubagentList
          items={[item]}
          busy
          onEdit={() => {}}
          onRemove={() => {}}
          onToggle={() => {}}
        />
      );
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Edit Reviewer" }).disabled
      ).toBe(true);
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Delete Reviewer" }).disabled
      ).toBe(true);
      expect(
        screen.getByRole("switch", { name: "Enable Reviewer" }).getAttribute("aria-disabled")
      ).toBe("true");
    });
  });
});
