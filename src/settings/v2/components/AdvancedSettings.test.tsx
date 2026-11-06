import { DEFAULT_SETTINGS } from "@/constants";
import { settingsAtom, settingsStore } from "@/settings/model";
import { AdvancedSettings } from "@/settings/v2/components/AdvancedSettings";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("AdvancedSettings", () => {
  describe("AdvancedSettings()", () => {
    beforeEach(() => settingsStore.set(settingsAtom, DEFAULT_SETTINGS));
    it("retains debugging controls without the retired key storage section", () => {
      render(<AdvancedSettings />);
      expect(screen.queryByText("API key storage")).toBeNull();
      expect(screen.queryByRole("button", { name: /Forget|Remove.*keys/i })).toBeNull();
      fireEvent.click(screen.getByRole("switch"));
      expect(settingsStore.get(settingsAtom).debug).toBe(true);
    });
  });
});
