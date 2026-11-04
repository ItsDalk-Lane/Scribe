import { EmptyPlaceholder } from "@/agentMode/skills/ui/EmptyPlaceholder";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("EmptyPlaceholder", () => {
  describe("EmptyPlaceholder()", () => {
    it("shows the shared skills folder and only Scribe's automatic discovery folder", () => {
      const { container } = render(<EmptyPlaceholder folder="Scribe/skills" />);

      expect(screen.getByText("No skills yet")).toBeTruthy();
      expect(
        Array.from(container.querySelectorAll("code"), (element) => element.textContent)
      ).toEqual([".scribe/skills/", "<vault>/Scribe/skills/"]);
    });
  });
});
