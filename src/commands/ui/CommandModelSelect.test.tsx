import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { CommandModelSelect } from "./CommandModelSelect";
describe("CommandModelSelect", () => {
  describe("CommandModelSelect()", () => {
    it("shows an unavailable explicit model instead of making the default appear selected", () => {
      render(<CommandModelSelect value="disabled-model" options={[]} onChange={jest.fn()} />);
      expect(screen.getByLabelText<HTMLSelectElement>("Model (optional)").value).toBe(
        "disabled-model"
      );
      expect(
        screen.getByRole<HTMLOptionElement>("option", { name: "disabled-model · Unavailable" })
          .disabled
      ).toBe(true);
    });
    it("shows Default model and lets the user choose a command-specific model", () => {
      const onChange = jest.fn();
      render(
        <CommandModelSelect
          value=""
          options={[{ label: "GPT-4o", value: "gpt4o" }]}
          onChange={onChange}
        />
      );
      expect(screen.getByDisplayValue("Default model")).not.toBeNull();
      fireEvent.change(screen.getByLabelText("Model (optional)"), { target: { value: "gpt4o" } });
      expect(onChange).toHaveBeenCalledWith("gpt4o");
    });
  });
});
