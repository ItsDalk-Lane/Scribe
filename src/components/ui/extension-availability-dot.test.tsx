import { render, screen } from "@testing-library/react";
import React from "react";
import { ExtensionAvailabilityDot } from "./extension-availability-dot";

describe("ExtensionAvailabilityDot", () => {
  describe("ExtensionAvailabilityDot()", () => {
    it("renders nothing for an enabled state that carries no informational note", () => {
      const { container } = render(<ExtensionAvailabilityDot state={{ enabled: true }} />);
      expect(container.firstChild).toBeNull();
    });
    it.each([
      {
        label: "a failure",
        state: { enabled: false, reason: "Resolve the loading error before enabling this item." },
      },
      {
        label: "a connecting server",
        state: { enabled: false, connecting: true, reason: "Connecting…" },
      },
      {
        label: "a read-only entry",
        state: { enabled: true, informational: true, reason: "Read-only; manage at its source" },
      },
    ] as const)("exposes $label through its accessible label and hover text", ({ state }) => {
      render(<ExtensionAvailabilityDot state={{ ...state }} />);
      const dot = screen.getByRole("img", { name: state.reason });
      expect(dot.getAttribute("title")).toBe(state.reason);
    });
  });
});
