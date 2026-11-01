import { setInterfaceLocale } from "@/lib/i18n";
import { GeneralSettings } from "@/settings/v2/components/GeneralSettings";
import { resetSettings } from "@/settings/model";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

jest.mock("@/settings/v2/components/BasicSettings", () => ({
  BasicSettings: ({ section }: { section: string }) => <div>{section}-content</div>,
}));
jest.mock("@/settings/v2/components/AdvancedSettings", () => ({
  AdvancedSettings: ({ section }: { section: string }) => <div>{section}-content</div>,
}));

describe("GeneralSettings", () => {
  describe("GeneralSettings()", () => {
    afterEach(() => setInterfaceLocale("en"));

    it("opens General first and switches between all sections without mixing their content", () => {
      setInterfaceLocale("zh-CN");
      render(<GeneralSettings />);
      const tabs = within(screen.getByRole("tablist", { name: "通用设置" }));
      const labels = ["常规", "自定义说明", "聊天保存", "其他", "调试与支持", "关于"];
      const ids = ["general", "instructions", "saving", "others", "debug", "about"];
      expect(tabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(labels);
      expect(screen.getByRole("tabpanel").textContent).toBe("general-content");

      labels.forEach((label, index) => {
        const tab = tabs.getByRole("tab", { name: label });
        fireEvent.click(tab);
        expect(tab.getAttribute("aria-selected")).toBe("true");
        expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
        if (ids[index] === "about") {
          expect(screen.getByText("4.0.17")).toBeTruthy();
          fireEvent.click(screen.getByRole("button", { name: "重置设置" }));
          expect(mockOpen).toHaveBeenCalled();
          expect(confirmReset).toBeDefined();
        } else {
          expect(screen.getByRole("tabpanel").textContent).toBe(`${ids[index]}-content`);
        }
        expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tab.id);
      });
      expect(resetSettings).not.toHaveBeenCalled();
      act(() => confirmReset?.());
      expect(resetSettings).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("tabpanel").textContent).toBe("general-content");
    });
  });
});
