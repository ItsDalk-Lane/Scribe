import { render, screen } from "@testing-library/react";
import React from "react";
import { SkillRowLayout } from "./SkillRowLayout";

describe("SkillRowLayout", () => {
  describe("SkillRowLayout", () => {
    it("shares name, description, annotations and controls across skill ownership", () => {
      render(
        <SkillRowLayout
          name="writing-helper"
          description="Review writing"
          annotations={<span>Requires a local tool</span>}
          controls={<button type="button">Agent</button>}
          actions={<button type="button">More actions</button>}
        />
      );
      expect(screen.getByText("writing-helper")).toBeTruthy();
      expect(screen.getByText("Review writing")).toBeTruthy();
      expect(screen.getByText("Requires a local tool")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Agent" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
      expect(screen.getByRole("button", { name: /writing-helper/ })).toBeTruthy();
    });
  });
});
