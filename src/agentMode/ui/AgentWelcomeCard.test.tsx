import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentWelcomeCard } from "@/agentMode/ui/AgentWelcomeCard";
import { setInterfaceLocale } from "@/lib/i18n";

describe("AgentWelcomeCard", () => {
  describe("AgentWelcomeCard()", () => {
    afterEach(() => setInterfaceLocale("en"));

    it("explains project references and separate chat history in English", () => {
      setInterfaceLocale("en");
      render(<AgentWelcomeCard onCreate={jest.fn()} onDismiss={jest.fn()} />);
      expect(
        screen.getByText(
          "Save references to notes, URLs, PDFs, and folders in a project. Each project keeps its own chat history."
        )
      ).toBeTruthy();
    });

    it("explains project references and separate chat history in Chinese", () => {
      setInterfaceLocale("zh-CN");
      render(<AgentWelcomeCard onCreate={jest.fn()} onDismiss={jest.fn()} />);
      expect(
        screen.getByText(
          "在项目中保存笔记、网址、PDF 和文件夹的参考信息，并为每个项目保留独立的聊天记录。"
        )
      ).toBeTruthy();
    });

    it("invokes onCreate when the CTA is clicked", () => {
      const onCreate = jest.fn();
      render(<AgentWelcomeCard onCreate={onCreate} onDismiss={jest.fn()} />);
      fireEvent.click(screen.getByText("New project"));
      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it("invokes onDismiss from the × control", () => {
      const onDismiss = jest.fn();
      render(<AgentWelcomeCard onCreate={jest.fn()} onDismiss={onDismiss} />);
      fireEvent.click(screen.getByLabelText("Dismiss"));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });
});
