import { DEFAULT_SETTINGS } from "@/constants";
import { settingsAtom, settingsStore } from "@/settings/model";
import { AdvancedSettings } from "@/settings/v2/components/AdvancedSettings";
import { render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/context", () => ({ useApp: jest.fn(() => ({})) }));
jest.mock("@/contexts/PluginContext", () => ({ usePlugin: jest.fn(() => ({})) }));
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: () => false }));
jest.mock("@/services/keychainService", () => ({
  KeychainService: { getInstance: () => ({ isAvailable: () => false }) },
}));

describe("AdvancedSettings", () => {
  describe("AdvancedSettings()", () => {
    beforeEach(() => settingsStore.set(settingsAtom, DEFAULT_SETTINGS));

    it("keeps key storage in Others and support controls in Debugging and support", () => {
      const view = render(<AdvancedSettings section="others" />);
      expect(screen.getByText("API key storage")).toBeTruthy();
      expect(screen.queryByText("Debug mode")).toBeNull();

      view.rerender(<AdvancedSettings section="debug" />);
      expect(screen.getByText("Debug mode")).toBeTruthy();
      expect(screen.queryByText("API key storage")).toBeNull();
    });
  });
});
