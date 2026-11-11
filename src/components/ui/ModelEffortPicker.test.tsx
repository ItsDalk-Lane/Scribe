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
  describe("ModelEffortPicker", () => {
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
      "resolves effort %p to the lowest supported choice when committing the picker",
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
    it("preserves a supported effort when the picker closes unchanged", async () => {
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
    it("keeps the chosen draft effort when Enter reselects the already selected model", async () => {
      const onChange = jest.fn();
      const reasoningOptions = ["default", "low", "high", "max"].map((value) => ({
        value,
        label: value,
      }));
      render(
        <ModelEffortPicker
          override={{
            models,
            value: "model|agent",
            effort: { options: reasoningOptions, value: "default", onChange },
            effortOptionsByModelKey: { "model|agent": reasoningOptions },
            commitSelection: jest.fn(),
          }}
        />
      );
      fireEvent.click(screen.getByTitle("Model · effort"));
      const dialog = await screen.findByRole("dialog");
      fireEvent.keyDown(dialog, { key: "ArrowRight" });
      expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("1");
      fireEvent.keyDown(dialog, { key: "Enter" });
      expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("1");
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(onChange).toHaveBeenCalledWith("low");
    });
    it("keeps an uncommitted effort when equivalent model props are refreshed while the menu is open", async () => {
      const onChange = jest.fn();
      const reasoningOptions = ["default", "low", "high", "max"].map((value) => ({
        value,
        label: value,
      }));
      const override = {
        models,
        value: "model|agent",
        effort: { options: reasoningOptions, value: "default", onChange },
        effortOptionsByModelKey: { "model|agent": reasoningOptions },
        commitSelection: jest.fn(),
      };
      const view = render(<ModelEffortPicker override={override} />);
      fireEvent.click(screen.getByTitle("Model · effort"));
      const dialog = await screen.findByRole("dialog");
      fireEvent.keyDown(dialog, { key: "ArrowRight" });
      view.rerender(
        <ModelEffortPicker
          override={{
            ...override,
            models: [...models],
            effortOptionsByModelKey: { "model|agent": [...reasoningOptions] },
          }}
        />
      );
      expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("1");
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(onChange).toHaveBeenCalledWith("low");
    });
  });
});
