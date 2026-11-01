import { InstructionsTextarea } from "@/instructions/InstructionsTextarea";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { setInterfaceLocale } from "@/lib/i18n";

describe("InstructionsTextarea", () => {
  afterEach(() => setInterfaceLocale("en"));
  describe("InstructionsTextarea()", () => {
    it("shows a Chinese example while preserving the user's original instructions", () => {
      setInterfaceLocale("zh-CN");
      render(
        <InstructionsTextarea
          value="Keep my English instructions unchanged."
          onChange={jest.fn()}
          label="说明"
        />
      );
      const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "说明" });
      expect(field.placeholder).toBe("例如：将新建笔记放入 Inbox/，并链接到相关笔记。");
      expect(field.value).toBe("Keep my English instructions unchanged.");
    });
    it("shows an example placeholder while empty and the current text once instructions exist", () => {
      const props = { onChange: jest.fn(), label: "Instructions" };
      const { rerender } = render(<InstructionsTextarea {...props} value="" />);
      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Instructions" });
      expect(textarea.placeholder).toBe(
        "e.g. Put new notes you create in Inbox/ and link them to a related note."
      );

      rerender(<InstructionsTextarea {...props} value="My rules" />);
      expect(textarea.value).toBe("My rules");
    });

    it("reports what the user typed", () => {
      const onChange = jest.fn();
      render(<InstructionsTextarea value="" onChange={onChange} label="Instructions" />);
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Cite every source." } });
      expect(onChange).toHaveBeenCalledWith("Cite every source.");
    });
  });
});
