import { QuickAskMessageComponent } from "@/components/quick-ask/QuickAskMessage";
import { AppContext } from "@/context";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

jest.mock("@/utils/renderMarkdown", () => ({ renderMarkdown: jest.fn() }));

const message = {
  id: "answer",
  role: "assistant" as const,
  content: "A complete answer",
  timestamp: 1,
};
const callbacks = { onCopy: jest.fn(), onInsert: jest.fn(), onReplace: jest.fn() };
const props = {
  message,
  isStreaming: false,
  isLastAssistantMessage: true,
  ...callbacks,
  hasSelection: true,
  isReplaceValid: true,
  replaceInvalidReason: null,
  filePathSnapshot: "source/Note.md",
};

describe("QuickAskMessage", () => {
  describe("QuickAskMessageComponent", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.mocked(renderMarkdown).mockImplementation(async (_app, text, target) => {
        target.textContent = text;
      });
    });

    it("keeps streaming plain and renders completion with its captured note source https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
      const app = new App();
      const view = render(
        <AppContext.Provider value={app}>
          <QuickAskMessageComponent {...props} isStreaming />
        </AppContext.Provider>
      );
      expect(screen.getByText(message.content)).toBeTruthy();
      expect(renderMarkdown).not.toHaveBeenCalled();
      view.rerender(
        <AppContext.Provider value={app}>
          <QuickAskMessageComponent {...props} />
        </AppContext.Provider>
      );
      await waitFor(() => expect(renderMarkdown).toHaveBeenCalled());
      expect(jest.mocked(renderMarkdown).mock.calls[0][3]).toBe("source/Note.md");
      expect(await screen.findByText(message.content)).toBeTruthy();
      fireEvent.click(screen.getByTitle("Copy to clipboard"));
      fireEvent.click(screen.getByTitle("Insert at cursor"));
      fireEvent.click(screen.getByTitle("Replace selection"));
      expect(callbacks.onCopy).toHaveBeenCalledWith("answer");
      expect(callbacks.onInsert).toHaveBeenCalledWith("answer");
      expect(callbacks.onReplace).toHaveBeenCalledWith("answer");
    });

    it("keeps user messages plain without starting host rendering https://github.com/ItsDalk-Lane/Scribe/issues/72", () => {
      render(
        <AppContext.Provider value={new App()}>
          <QuickAskMessageComponent {...props} message={{ ...message, role: "user" }} />
        </AppContext.Provider>
      );
      expect(screen.getByText(message.content)).toBeTruthy();
      expect(renderMarkdown).not.toHaveBeenCalled();
    });
  });
});
