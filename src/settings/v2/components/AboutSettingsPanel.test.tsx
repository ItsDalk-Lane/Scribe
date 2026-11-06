import { setInterfaceLocale } from "@/lib/i18n";
import { resetSettings } from "@/settings/model";
import { AboutSettingsPanel } from "@/settings/v2/components/AboutSettingsPanel";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const mockOpen = jest.fn();
let confirmReset: (() => void) | undefined;
jest.mock("@/contexts/PluginContext", () => ({
  usePlugin: jest.fn().mockReturnValue({ manifest: { version: "4.0.17" }, app: {} }),
}));
jest.mock("@/components/modals/ResetSettingsConfirmModal", () => ({
  ResetSettingsConfirmModal: jest
    .fn()
    .mockImplementation((_app: unknown, onConfirm: () => void) => {
      confirmReset = onConfirm;
      return { open: mockOpen };
    }),
}));
jest.mock("@/settings/model", () => ({ resetSettings: jest.fn() }));
jest.mock("@/settings/v2/components/AgentNotificationSettings", () => ({
  AgentNotificationSettings: () => <div>notification-content</div>,
}));
jest.mock("@/settings/v2/components/AdvancedSettings", () => ({
  AdvancedSettings: () => <div>advanced-content</div>,
}));

describe("AboutSettingsPanel", () => {
  describe("AboutSettingsPanel", () => {
    describe("AboutSettingsPanel()", () => {
      afterEach(() => {
        setInterfaceLocale("en");
        jest.clearAllMocks();
        confirmReset = undefined;
      });

      it("orders notifications and support before reset and the plugin version", () => {
        render(<AboutSettingsPanel />);

        const ordered = [
          screen.getByText("notification-content"),
          screen.getByText("advanced-content"),
          screen.getByRole("button", { name: "Reset settings" }),
          screen.getByText("4.0.17"),
        ];
        ordered.slice(1).forEach((element, index) => {
          expect(ordered[index].compareDocumentPosition(element)).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING
          );
        });
      });

      it("resets settings only after the confirmation is accepted", () => {
        render(<AboutSettingsPanel />);

        fireEvent.click(screen.getByRole("button", { name: "Reset settings" }));
        expect(mockOpen).toHaveBeenCalledTimes(1);
        expect(resetSettings).not.toHaveBeenCalled();

        act(() => confirmReset?.());
        expect(resetSettings).toHaveBeenCalledTimes(1);
      });
    });
  });
});
