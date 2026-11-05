import { setInterfaceLocale } from "@/lib/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ChatAutosaveSetting } from "./ChatAutosaveSetting";

describe("ChatAutosaveSetting", () => {
  describe("ChatAutosaveSetting()", () => {
    afterEach(() => setInterfaceLocale("en"));

    it("lets the user enable automatic note creation from the off state", () => {
      const onCheckedChange = jest.fn();
      render(<ChatAutosaveSetting checked={false} onCheckedChange={onCheckedChange} />);

      fireEvent.click(screen.getByRole("switch"));
      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it("shows the note update boundary in Chinese", () => {
      setInterfaceLocale("zh-CN");
      render(<ChatAutosaveSetting checked={false} onCheckedChange={() => {}} />);

      expect(screen.getByText(/已关联的聊天和之前排队的保存仍可能写入/)).toBeTruthy();
    });
  });
});
