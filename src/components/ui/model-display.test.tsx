import { render, screen } from "@testing-library/react";
import React from "react";
import {
  ModelCapabilityIcons,
  ModelDisplay,
  hasCapabilityIcons,
} from "@/components/ui/model-display";
import type { CustomModel } from "@/aiParams";
import { ModelCapability } from "@/constants";

const NO_VISION = "model-cap-no-vision";

const model = (overrides: Partial<CustomModel> = {}): CustomModel => ({
  name: "omni",
  provider: "openai",
  enabled: true,
  ...overrides,
});

describe("model-display", () => {
  describe("hasCapabilityIcons()", () => {
    it("is false for unknown capabilities and any vision-capable model", () => {
      expect(hasCapabilityIcons(undefined)).toBe(false);
      expect(hasCapabilityIcons([ModelCapability.VISION])).toBe(false);
      expect(hasCapabilityIcons([ModelCapability.VISION, ModelCapability.REASONING])).toBe(false);
    });

    it("is true when the model is known to lack vision", () => {
      expect(hasCapabilityIcons([])).toBe(true);
      expect(hasCapabilityIcons([ModelCapability.REASONING])).toBe(true);
    });
  });

  describe("ModelCapabilityIcons()", () => {
    it("renders nothing for unknown capabilities", () => {
      const { container, queryByTestId } = render(
        <ModelCapabilityIcons capabilities={undefined} />
      );
      expect(container.querySelectorAll("svg")).toHaveLength(0);
      expect(queryByTestId(NO_VISION)).toBeNull();
    });

    it("renders the eye-off for a known model that lacks vision", () => {
      const { container, queryByTestId } = render(<ModelCapabilityIcons capabilities={[]} />);
      expect(queryByTestId(NO_VISION)).not.toBeNull();
      expect(container.querySelectorAll("svg")).toHaveLength(1);
    });

    it("renders no icon for a vision-capable model", () => {
      const { container, queryByTestId } = render(
        <ModelCapabilityIcons capabilities={[ModelCapability.VISION]} />
      );
      expect(container.querySelectorAll("svg")).toHaveLength(0);
      expect(queryByTestId(NO_VISION)).toBeNull();
    });
  });

  describe("ModelDisplay()", () => {
    it("renders the display name without a capability icon when support is unknown", () => {
      render(<ModelDisplay model={model({ displayName: "Omni Display" })} />);

      expect(screen.getByText("Omni Display")).toBeTruthy();
      expect(screen.queryByTestId(NO_VISION)).toBeNull();
    });
  });
});
