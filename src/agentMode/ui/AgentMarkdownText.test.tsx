import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { AppContext } from "@/context";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { render, screen } from "@testing-library/react";
import { App, TFile } from "obsidian";
import * as React from "react";

jest.mock("@/utils/renderMarkdown", () => ({ renderMarkdown: jest.fn() }));

describe("AgentMarkdownText", () => {
  describe("AgentMarkdownText()", () => {
    beforeEach(() => {
      jest.mocked(renderMarkdown).mockImplementation(async (_app, text, target) => {
        target.textContent = text;
      });
    });

    it("renders the response with an empty source path when no note is active", async () => {
      const app = new App();
      jest.mocked(app.workspace.getActiveFile).mockReturnValue(null);
      render(
        <AppContext.Provider value={app}>
          <AgentMarkdownText app={app} text="The notes agree." />
        </AppContext.Provider>
      );

      expect(await screen.findByText("The notes agree.")).not.toBeNull();
      expect(renderMarkdown).toHaveBeenCalledWith(
        app,
        "The notes agree.",
        expect.any(HTMLElement),
        "",
        expect.anything()
      );
    });

    it("keeps response links rooted in the vault when a note is active https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
      const app = new App();
      const TFileConstructor = TFile as unknown as new (path: string) => TFile;
      jest
        .mocked(app.workspace.getActiveFile)
        .mockReturnValue(new TFileConstructor("Projects/Active note.md"));
      render(
        <AppContext.Provider value={app}>
          <AgentMarkdownText app={app} text="[[Related note]]" />
        </AppContext.Provider>
      );

      expect(await screen.findByText("[[Related note]]")).not.toBeNull();
      expect(renderMarkdown).toHaveBeenCalledWith(
        app,
        "[[Related note]]",
        expect.any(HTMLElement),
        "",
        expect.anything()
      );
    });

    it("uses the explicit source without reading the active note https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
      const app = new App();
      render(
        <AppContext.Provider value={app}>
          <AgentMarkdownText
            app={app}
            text="[[Related note]]"
            sourcePath="Notes/Question.md"
            renderIdentity="chat/response/7:0"
          />
        </AppContext.Provider>
      );

      expect(await screen.findByText("[[Related note]]")).not.toBeNull();
      expect(renderMarkdown).toHaveBeenCalledWith(
        app,
        "[[Related note]]",
        expect.any(HTMLElement),
        "Notes/Question.md",
        expect.anything()
      );
      expect(app.workspace.getActiveFile).not.toHaveBeenCalled();
    });
  });
});
