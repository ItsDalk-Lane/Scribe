import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExtensionAvailabilitySwitch } from "./extension-availability-switch";

describe("ExtensionAvailabilitySwitch", () => {
  describe("ExtensionAvailabilitySwitch()", () => {
    it("shows the confirmed state and requests the opposite state on click or keyboard activation", () => {
      const onToggle = jest.fn();
      const { rerender } = render(
        <ExtensionAvailabilitySwitch
          label="Enable notes"
          state={{ checked: false, disabled: false }}
          onToggle={onToggle}
        />
      );
      const control = screen.getByRole("switch", { name: "Enable notes" });
      expect(control.getAttribute("aria-checked")).toBe("false");
      expect(control.getAttribute("aria-disabled")).toBe("false");
      fireEvent.click(control);
      expect(onToggle).toHaveBeenLastCalledWith(true);

      rerender(
        <ExtensionAvailabilitySwitch
          label="Enable notes"
          state={{ checked: true, disabled: false }}
          onToggle={onToggle}
        />
      );
      expect(control.getAttribute("aria-checked")).toBe("true");
      fireEvent.keyDown(control, { key: " " });
      expect(onToggle).toHaveBeenLastCalledWith(false);
      fireEvent.keyDown(control, { key: "Enter" });
      expect(onToggle).toHaveBeenCalledTimes(3);
    });

    it("keeps a locked item checked and exposes why it cannot be changed", () => {
      const onToggle = jest.fn();
      const reason = "Managed by its plugin; it cannot be switched independently.";
      render(
        <ExtensionAvailabilitySwitch
          label="Enable notes"
          state={{ checked: true, disabled: true, reason }}
          onToggle={onToggle}
        />
      );

      const control = screen.getByRole("switch", { name: "Enable notes" });
      expect(control.getAttribute("aria-checked")).toBe("true");
      expect(control.getAttribute("aria-disabled")).toBe("true");
      expect(control.getAttribute("aria-description")).toBe(reason);
      expect(control.tabIndex).toBe(-1);
      fireEvent.click(control);
      fireEvent.keyDown(control, { key: "Enter" });
      expect(onToggle).not.toHaveBeenCalled();
    });

    it.each(["checking", "pending"] as const)(
      "keeps the last state and exposes an accessible icon while %s",
      (phase) => {
        const reason = "Availability could not be confirmed. Check again.";
        render(
          <ExtensionAvailabilitySwitch
            label="Enable notes"
            state={{ checked: true, disabled: true, phase, reason }}
            onToggle={jest.fn()}
          />
        );

        const control = screen.getByRole("switch", { name: "Enable notes" });
        expect(control.getAttribute("aria-checked")).toBe("true");
        expect(control.getAttribute("aria-disabled")).toBe("true");
        expect(screen.getByLabelText(reason).tagName.toLowerCase()).toBe("svg");
        expect(screen.queryByText(reason)).toBeNull();
      }
    );

    it("locks an in-progress change and exposes its waiting reason without changing the confirmed state", () => {
      const onToggle = jest.fn();
      render(
        <ExtensionAvailabilitySwitch
          label="Enable notes"
          state={{ checked: false, disabled: false }}
          busy
          onToggle={onToggle}
        />
      );

      const reason = "Waiting for configuration changes to take effect.";
      const control = screen.getByRole("switch", { name: "Enable notes" });
      expect(control.getAttribute("aria-checked")).toBe("false");
      expect(control.getAttribute("aria-disabled")).toBe("true");
      expect(control.getAttribute("aria-description")).toBe(reason);
      expect(screen.getByLabelText(reason)).toBeTruthy();
      fireEvent.click(control);
      expect(onToggle).not.toHaveBeenCalled();
    });

    it("displays a read-only state when no toggle action is supplied", () => {
      render(
        <ExtensionAvailabilitySwitch
          label="Enable notes"
          state={{ checked: true, disabled: false }}
        />
      );

      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
      expect(screen.getByRole("switch").getAttribute("aria-disabled")).toBe("true");
    });
  });
});
