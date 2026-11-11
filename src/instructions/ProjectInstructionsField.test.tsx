import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProjectInstructionsField } from "@/instructions/ProjectInstructionsField";
import { setInterfaceLocale } from "@/lib/i18n";

describe("ProjectInstructionsField", () => {
  afterEach(() => setInterfaceLocale("en"));

  describe("ProjectInstructionsField()", () => {
    it("shows Chinese labels without translating the user's instruction text", () => {
      setInterfaceLocale("zh-CN");
      render(<ProjectInstructionsField value="Cite only #verified notes." onChange={jest.fn()} />);
      expect(screen.getByLabelText<HTMLTextAreaElement>("项目说明").value).toBe(
        "Cite only #verified notes."
      );
      expect(screen.getByText(/保存在项目文件夹中的 AGENTS\.md/)).toBeTruthy();
      expect(screen.getByText(/本次要求、项目说明、资料库说明、Scribe 默认要求/)).toBeTruthy();
    });
    it("shows the draft and says where the text is saved", () => {
      render(<ProjectInstructionsField value="Cite only #verified notes." onChange={jest.fn()} />);

      expect(screen.getByLabelText<HTMLTextAreaElement>("Project instructions").value).toBe(
        "Cite only #verified notes."
      );
      expect(screen.getByText(/Saved to AGENTS\.md in the project folder/)).toBeTruthy();
      expect(
        screen.getByText(
          /current request comes first, followed by project instructions, vault instructions/
        )
      ).toBeTruthy();
    });

    it("reports each edit so the dialog can hold the draft", () => {
      const onChange = jest.fn();
      render(<ProjectInstructionsField value="" onChange={onChange} />);

      fireEvent.change(screen.getByLabelText("Project instructions"), {
        target: { value: "New rules" },
      });

      expect(onChange).toHaveBeenCalledWith("New rules");
    });
  });
});
