import React from "react";
import { render, screen } from "@testing-library/react";
import { ModePicker } from "./ModePicker";

function renderWithValue(value: "default" | "plan" | "auto") {
  render(
    <ModePicker
      override={{
        options: [
          { label: "Default", value: "default" },
          { label: "Plan", value: "plan" },
          { label: "Auto", value: "auto" },
        ],
        value,
        onChange: () => undefined,
      }}
    />
  );
}

describe("ModePicker", () => {
  describe("ModePicker()", () => {
    it.each([
      ["default", "Default"],
      ["plan", "Plan"],
      ["auto", "Auto"],
    ] as const)(
      "shows the documented mode name %s as %s on the closed picker (https://github.com/ItsDalk-Lane/Scribe/issues/26)",
      (value, label) => {
        renderWithValue(value);

        expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
      }
    );

    it("never labels the default mode as Safe (https://github.com/ItsDalk-Lane/Scribe/issues/26)", () => {
      renderWithValue("default");

      expect(screen.queryByText(/Safe/)).toBeNull();
    });
  });
});
