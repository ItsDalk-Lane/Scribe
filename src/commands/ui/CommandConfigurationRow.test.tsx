import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { EMPTY_COMMAND } from "@/commands/constants";
import { CommandConfigurationRow } from "./CommandConfigurationRow";

const command = {
  ...EMPTY_COMMAND,
  title: "Review notes",
  content: "Read the notes.\n\nList missing context.",
  showInContextMenu: true,
  showInSlashMenu: true,
};
function actions() {
  return { onEnabledChange: jest.fn(), onEdit: jest.fn(), onCopy: jest.fn(), onDelete: jest.fn() };
}

describe("CommandConfigurationRow", () => {
  describe("CommandConfigurationRow()", () => {
    it("shows a single command summary with saved menu preferences and its total enablement", () => {
      render(<CommandConfigurationRow command={command} {...actions()} />);
      expect(screen.getByRole("article", { name: "Review notes" })).toBeTruthy();
      expect(screen.getByText("Read the notes. List missing context.")).toBeTruthy();
      expect(screen.getByText("Right-click")).toBeTruthy();
      expect(screen.getByText("Slash menu")).toBeTruthy();
      const title = screen.getByText("Review notes");
      expect(title.parentElement?.contains(screen.getByText("Right-click"))).toBe(true);
      expect(title.parentElement?.contains(screen.getByText("Slash menu"))).toBe(true);
      expect(
        screen.getByRole("switch", { name: "Enable Review notes" }).getAttribute("aria-checked")
      ).toBe("true");
      expect(screen.queryByRole("checkbox")).toBeNull();
    });
    it("retains both preference badges while the command is disabled", () => {
      render(<CommandConfigurationRow command={{ ...command, enabled: false }} {...actions()} />);
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
      expect(screen.getByText("Right-click")).toBeTruthy();
      expect(screen.getByText("Slash menu")).toBeTruthy();
    });
    it("reports the enable, edit, duplicate and delete actions independently", () => {
      const handlers = actions();
      render(<CommandConfigurationRow command={command} {...handlers} />);
      fireEvent.click(screen.getByRole("switch"));
      fireEvent.click(screen.getByRole("button", { name: "Review notes" }));
      fireEvent.click(screen.getByRole("button", { name: "Duplicate Review notes" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete Review notes" }));
      expect(handlers.onEnabledChange).toHaveBeenCalledWith(false);
      expect(handlers.onEdit).toHaveBeenCalledTimes(1);
      expect(handlers.onCopy).toHaveBeenCalledTimes(1);
      expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    });
    it("does not advertise menu preferences that are switched off", () => {
      render(
        <CommandConfigurationRow
          command={{ ...command, showInContextMenu: false, showInSlashMenu: false }}
          {...actions()}
        />
      );
      expect(screen.queryByText("Right-click")).toBeNull();
      expect(screen.queryByText("Slash menu")).toBeNull();
    });
  });
});
