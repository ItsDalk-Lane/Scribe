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
    it("renders contiguous same-provider options inside optgroups and selects through them https://github.com/ItsDalk-Lane/Scribe/issues/69", () => {
      const onChange = jest.fn();
      render(
        <CommandModelSelect
          value=""
          options={[
            { label: "Alpha A", value: "a1", group: "Alpha" },
            { label: "Alpha B", value: "a2", group: "Alpha" },
            { label: "Zeta C", value: "z1", group: "Zeta" },
          ]}
          onChange={onChange}
        />
      );
      const select = screen.getByLabelText<HTMLSelectElement>("Model (optional)");
      const groups = select.querySelectorAll("optgroup");
      expect(groups).toHaveLength(2);
      expect(groups[0].label).toBe("Alpha");
      expect(groups[0].querySelectorAll("option")).toHaveLength(2);
      expect(groups[1].label).toBe("Zeta");
      fireEvent.change(select, { target: { value: "a2" } });
      expect(onChange).toHaveBeenCalledWith("a2");
    });
    it("keeps options without a provider group flat instead of rendering empty optgroups https://github.com/ItsDalk-Lane/Scribe/issues/69", () => {
      const { container } = render(
        <CommandModelSelect
          value=""
          options={[{ label: "Only", value: "only" }]}
          onChange={jest.fn()}
        />
      );
      expect(container.querySelectorAll("optgroup")).toHaveLength(0);
      expect(screen.getByRole("option", { name: "Only" })).not.toBeNull();
    });
  });
});
