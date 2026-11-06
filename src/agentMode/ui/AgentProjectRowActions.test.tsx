import { AgentProjectRowActions, revealProjectFolder } from "@/agentMode/ui/AgentProjectRowActions";
import { setInterfaceLocale } from "@/lib/i18n";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TFolder, type App, type Modal } from "obsidian";
import React from "react";

const mockValidateWorkspace = jest.fn(async (_app: unknown, path: string) => path);
jest.mock("@/projects/projectWorkspace", () => ({
  validateProjectWorkspace: (...args: [unknown, string]) => mockValidateWorkspace(...args),
}));
import { updateCachedProjectRecords } from "@/projects/state";
import type { ProjectConfig } from "@/aiParams";

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
  describe("revealProjectFolder()", () => {
    afterEach(() => updateCachedProjectRecords([]));
    it("validates the actual workspace before revealing it and refuses an outside link", async () => {
      const project = { id: "p", name: "P", workspacePath: "Research" } as ProjectConfig;
      updateCachedProjectRecords([
        { project, filePath: ".scribe/projects/p/project.md", folderName: "p" },
      ]);
      const folder = new (TFolder as unknown as new (path: string) => TFolder)("Research");
      const reveal = jest.fn();
      const app = {
        vault: { getAbstractFileByPath: () => folder },
        internalPlugins: {
          getPluginById: () => ({ enabled: true, instance: { revealInFolder: reveal } }),
        },
      } as unknown as App;
      await revealProjectFolder(app, project);
      expect(reveal).toHaveBeenCalledWith(folder);
      mockValidateWorkspace.mockRejectedValueOnce(new Error("Outside vault"));
      await revealProjectFolder(app, project);
      expect(reveal).toHaveBeenCalledTimes(1);
    });
  });
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

    it("explains in English that deletion preserves the workspace and notes", async () => {
      setInterfaceLocale("en");
      render(<AgentProjectRowActions app={{} as App} project={project} />);
      fireEvent.click(screen.getByRole("button", { name: "Delete project Research" }));

      expect(
        await screen.findByText(
          'Delete project "Research"? Only its Scribe configuration will be removed. The workspace, AGENTS.md, and all notes will stay where they are.'
        )
      ).toBeTruthy();
    });

    it("explains in Chinese that deletion preserves the workspace and notes", async () => {
      setInterfaceLocale("zh-CN");
      render(<AgentProjectRowActions app={{} as App} project={project} />);
      fireEvent.click(screen.getByRole("button", { name: "删除项目 Research" }));

      expect(
        await screen.findByText(
          "要删除项目“Research”吗？只会移除 Scribe 中的项目配置，工作文件夹、AGENTS.md 和所有笔记都会保留在原处。"
        )
      ).toBeTruthy();
    });
  });
});
