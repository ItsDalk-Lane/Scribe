import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ModelEffortPicker } from "./ModelEffortPicker";

const models = [{ name: "model", provider: "agent", enabled: true }];
const options = ["high", "low"].map((value) => ({ value, label: value }));

describe("ModelEffortPicker", () => {
  beforeAll(() => {
    window.ResizeObserver = jest.fn(() => ({
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
    }));
  });
  describe("ModelEffortPicker()", () => {
    it("commits an available model only when dismissed", async () => {
      const commitSelection = jest.fn();
      render(
        <ModelEffortPicker
          override={{
            models: [...models, { name: "other", provider: "agent", enabled: true }],
            value: "model|agent",
            effortOptionsByModelKey: {},
            commitSelection,
          }}
        />
      );
      fireEvent.click(screen.getByTitle("Model · effort"));
      fireEvent.click(await screen.findByRole("option", { name: /other/ }));
      expect(commitSelection).not.toHaveBeenCalled();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(commitSelection).toHaveBeenCalledWith("other|agent", null);
    });

    it("keeps models disabled for other reasons unavailable", async () => {
      const commitSelection = jest.fn();
      render(
        <ModelEffortPicker
          override={{
            models: [
              ...models,
              {
                name: "unavailable",
                provider: "agent",
                enabled: true,
                _disabledReason: "Agent unavailable",
              },
            ],
            value: "model|agent",
            effortOptionsByModelKey: {},
            commitSelection,
          }}
        />
      );
      fireEvent.click(screen.getByTitle("Model · effort"));
      const row = await screen.findByRole("option", { name: /unavailable/ });
      expect(row.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(row);
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(commitSelection).not.toHaveBeenCalled();
      expect(screen.queryByRole("link")).toBeNull();
    });
    it.each([null, "removed"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 resolves effort %p to the lowest supported choice when committing the picker",
      async (value) => {
        const onChange = jest.fn();
        render(
          <ModelEffortPicker
            override={{
              models,
              value: "model|agent",
              effort: { options, value, onChange },
              effortOptionsByModelKey: { "model|agent": options },
              commitSelection: jest.fn(),
            }}
          />
        );
        fireEvent.click(screen.getByTitle("Model · effort"));
        fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
        expect(onChange).toHaveBeenCalledWith("low");
      }
    );
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 preserves a supported effort when the picker closes unchanged", async () => {
      const onChange = jest.fn();
      render(
        <ModelEffortPicker
          override={{
            models,
            value: "model|agent",
            effort: { options, value: "high", onChange },
            effortOptionsByModelKey: { "model|agent": options },
            commitSelection: jest.fn(),
          }}
        />
      );
      fireEvent.click(screen.getByTitle("Model · effort"));
      fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
