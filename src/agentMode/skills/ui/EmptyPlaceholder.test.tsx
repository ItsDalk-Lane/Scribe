import { EmptyPlaceholder } from "@/agentMode/skills/ui/EmptyPlaceholder";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("EmptyPlaceholder", () => {
  describe("EmptyPlaceholder()", () => {
    it("shows a concise empty state without old storage descriptions", () => {
      const { container } = render(<EmptyPlaceholder />);

      expect(screen.getByText("No skills yet")).toBeTruthy();
      expect(
        Array.from(container.querySelectorAll("code"), (element) => element.textContent)
      ).toEqual([]);
    });
  });
});
