import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ModelSelector } from "./ModelSelector";
import type { ModelSelectorEntry } from "./ModelSelector";
const model = (over: Partial<ModelSelectorEntry>): ModelSelectorEntry => ({
  name: "gpt-5",
  provider: "openai",
  enabled: true,
  ...over,
});

describe("ModelSelector", () => {
  describe("ModelSelector()", () => {
    beforeEach(() => {
      jest.spyOn(window, "open").mockImplementation(() => null);
    });
    afterEach(() => jest.restoreAllMocks());

    it("selects an available model", async () => {
      const onChange = jest.fn();
      render(<ModelSelector value="" onChange={onChange} models={[model({})]} />);
      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
      fireEvent.click(await screen.findByRole("menuitem", { name: /gpt-5/ }));
      expect(onChange).toHaveBeenCalledWith("gpt-5|openai");
      expect(window.open).not.toHaveBeenCalled();
    });

    it("renders a row's subtitle under its name and keeps it off the collapsed trigger", async () => {
      const described = model({
        displayName: "Example model",
        _subtitle: "A model configured with your own API key.",
      });
      render(<ModelSelector value="gpt-5|openai" onChange={jest.fn()} models={[described]} />);

      expect(screen.queryByText("A model configured with your own API key.")).toBeNull();

      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });

      expect(await screen.findByText("A model configured with your own API key.")).toBeTruthy();
    });

    it("keeps the right-side reason for a row disabled for any other cause", async () => {
      const needsKey = model({ _disabledReason: "Add API key" });
      const onChange = jest.fn();
      render(<ModelSelector value="gpt-5|openai" onChange={onChange} models={[needsKey]} />);
      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });

      expect(await screen.findByText("Add API key")).toBeTruthy();
      const row = screen.getByRole("menuitem");
      fireEvent.click(row);
      fireEvent.keyDown(row, { key: "Enter" });
      expect(row.getAttribute("aria-disabled")).toBe("true");
      expect(onChange).not.toHaveBeenCalled();
      expect(window.open).not.toHaveBeenCalled();
    });
  });
});
