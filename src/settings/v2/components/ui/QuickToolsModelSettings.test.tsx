import { setInterfaceLocale } from "@/lib/i18n";
import { QuickToolsModelSettings } from "@/settings/v2/components/ui/QuickToolsModelSettings";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import quickToolsStories from "./QuickToolsModelSettings.stories";

describe("QuickToolsModelSettings", () => {
  afterEach(() => setInterfaceLocale("en"));

  describe("QuickToolsModelSettings()", () => {
    it("translates the empty model option while retaining model identifiers", () => {
      setInterfaceLocale("zh-CN");
      const onDefaultModelChange = jest.fn();
      render(
        <QuickToolsModelSettings
          defaultModelId={undefined}
          options={[{ label: "My English model", value: "custom-model" }]}
          onDefaultModelChange={onDefaultModelChange}
        >
          <div>我的模型</div>
        </QuickToolsModelSettings>
      );
      expect(screen.queryByText("快捷工具模型")).toBeNull();
      expect(screen.getByDisplayValue("选择模型")).not.toBeNull();
      expect(screen.getByRole<HTMLOptionElement>("option", { name: "选择模型" }).disabled).toBe(
        true
      );
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "custom-model" } });
      expect(onDefaultModelChange).toHaveBeenCalledWith("custom-model");
      expect(screen.getByRole("option", { name: "My English model" })).not.toBeNull();
    });

    it("offers a placeholder until a usable default is selected and forwards model changes", () => {
      const onDefaultModelChange = jest.fn();
      render(
        <QuickToolsModelSettings
          defaultModelId={undefined}
          options={[{ label: "Model A", value: "a" }]}
          onDefaultModelChange={onDefaultModelChange}
        >
          <div>Model switches</div>
        </QuickToolsModelSettings>
      );
      expect(screen.getByDisplayValue("Select model")).not.toBeNull();
      expect(screen.getByText("Model switches")).not.toBeNull();
      expect(screen.getByRole<HTMLOptionElement>("option", { name: "Select model" }).disabled).toBe(
        true
      );
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "a" } });
      expect(onDefaultModelChange).toHaveBeenCalledWith("a");
    });
    it("shows the saved default while keeping the placeholder unavailable", () => {
      render(
        <QuickToolsModelSettings
          defaultModelId="a"
          options={[{ label: "Model A", value: "a" }]}
          onDefaultModelChange={() => undefined}
        >
          <div>Model switches</div>
        </QuickToolsModelSettings>
      );
      expect(screen.getByDisplayValue("Model A")).not.toBeNull();
      expect(screen.getByRole<HTMLOptionElement>("option", { name: "Select model" }).disabled).toBe(
        true
      );
    });
  });

  describe("QuickToolsModelSettingsStory()", () => {
    it.each([false, true])(
      "translates the model search and setup instructions when empty is %s",
      (empty) => {
        setInterfaceLocale("zh-CN");
        const Story = quickToolsStories.component;
        render(<Story empty={empty} />);

        expect(screen.queryByText("快捷工具模型")).toBeNull();
        expect(screen.getByPlaceholderText("搜索快捷工具模型…")).not.toBeNull();
        expect(screen.queryByText(/Quick tools/)).toBeNull();
        if (empty) expect(screen.getByText(/中添加聊天模型后用于快捷工具/)).not.toBeNull();
      }
    );
  });
});
