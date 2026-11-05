import { AgentProjectRowActions } from "@/agentMode/ui/AgentProjectRowActions";
import { setInterfaceLocale } from "@/lib/i18n";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { App, Modal } from "obsidian";
import React from "react";

const mockOpenedModals: Modal[] = [];

jest.mock("obsidian", () => {
  const actual = jest.requireActual("obsidian");
  class OpenableModal extends actual.Modal {
    constructor(app: unknown) {
      super(app);
      delete this.onOpen;
      delete this.onClose;
      this.setTitle = (title: string) => (this.titleEl.textContent = title);
      this.open = () => {
        mockOpenedModals.push(this as unknown as Modal);
        document.body.appendChild(this.containerEl);
        this.onOpen();
      };
      this.close = () => {
        this.onClose();
        this.containerEl.remove();
      };
    }
  }
  return { ...actual, Modal: OpenableModal };
});

describe("AgentProjectRowActions", () => {
  describe("AgentProjectRowActions()", () => {
    const project = {
      id: "research",
      name: "Research",
      systemPrompt: "",
      contextSource: {},
      created: 1,
      UsageTimestamps: 1,
    };

    afterEach(() => {
      act(() => mockOpenedModals.splice(0).forEach((modal) => modal.close()));
      setInterfaceLocale("en");
    });

    it("explains in English that deletion keeps instructions but recreating the project may change them", async () => {
      setInterfaceLocale("en");
      render(<AgentProjectRowActions app={{} as App} project={project} />);
      fireEvent.click(screen.getByRole("button", { name: "Delete project Research" }));

      expect(
        await screen.findByText(
          'Delete project "Research"? This removes the project configuration; project instructions and other notes stay in the vault. If you create another project with the same name, its existing instructions may be changed when it opens. Save a copy of any instructions you want to keep before recreating the project.'
        )
      ).toBeTruthy();
    });

    it("explains in Chinese that deletion keeps instructions but recreating the project may change them", async () => {
      setInterfaceLocale("zh-CN");
      render(<AgentProjectRowActions app={{} as App} project={project} />);
      fireEvent.click(screen.getByRole("button", { name: "删除项目 Research" }));

      expect(
        await screen.findByText(
          "要删除项目“Research”吗？这会移除项目配置，项目说明和其他笔记会保留在库中。如果之后新建同名项目，打开时可能修改原有说明。重新创建前，请先保存需要保留的项目说明副本。"
        )
      ).toBeTruthy();
    });
  });
});
