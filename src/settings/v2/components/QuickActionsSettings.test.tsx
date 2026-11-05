import { setInterfaceLocale } from "@/lib/i18n";
import { QuickActionsSettings } from "@/settings/v2/components/QuickActionsSettings";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

jest.mock("@/modelManagement", () => ({
  ModelsAndProvidersPanel: () => <div>models and providers content</div>,
}));
jest.mock("@/settings/v2/components/QuickToolsPanel", () => ({
  QuickToolsPanel: () => <div>quick-tools-content</div>,
}));
jest.mock("@/settings/v2/components/CommandSettings", () => ({
  CommandSettings: () => <div>my-commands-content</div>,
}));

describe("QuickActionsSettings", () => {
  describe("QuickActionsSettings()", () => {
    afterEach(() => setInterfaceLocale("en"));

    it("opens 模型与供应商 first and switches sections without mixing their content", () => {
      setInterfaceLocale("zh-CN");
      render(<QuickActionsSettings />);
      const tabs = within(screen.getByRole("tablist", { name: "快捷操作设置" }));
      const labels = ["模型与供应商", "工具配置", "我的指令"];
      const contents = [
        "models and providers content",
        "quick-tools-content",
        "my-commands-content",
      ];
      expect(tabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(labels);
      expect(screen.getByRole("tabpanel").textContent).toBe("models and providers content");

      labels.forEach((label, index) => {
        const tab = tabs.getByRole("tab", { name: label });
        fireEvent.click(tab);
        expect(tab.getAttribute("aria-selected")).toBe("true");
        expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
        expect(screen.getByRole("tabpanel").textContent).toBe(contents[index]);
        expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tab.id);
      });
    });

    it("labels the tab strip for assistive technology", () => {
      render(<QuickActionsSettings />);
      expect(screen.getByRole("tablist", { name: "Quick actions settings" })).not.toBeNull();
    });

    it("uses Models and providers for the English settings tab", () => {
      render(<QuickActionsSettings />);
      expect(screen.getByRole("tab", { name: "Models and providers" })).toBeTruthy();
    });
  });
});
