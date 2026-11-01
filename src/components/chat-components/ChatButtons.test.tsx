import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatButtons } from "@/components/chat-components/ChatButtons";
import { USER_SENDER } from "@/constants";
import type { ChatMessage } from "@/types/message";

jest.mock("@/utils", () => ({ cleanMessageForCopy: (s: string) => s }));
jest.mock("obsidian", () => ({ Platform: { isMobile: false } }));

function renderButtons(sender: string, onFork?: () => void, forkDisabled = false) {
  const message: ChatMessage = { sender, message: "body", isVisible: true, timestamp: null };
  return render(
    <TooltipProvider>
      <ChatButtons
        message={message}
        onInsertIntoEditor={() => undefined}
        onFork={onFork}
        forkDisabled={forkDisabled}
      />
    </TooltipProvider>
  );
}

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

describe("ChatButtons", () => {
  describe("ChatButtons()", () => {
    it("offers branching only when a completed assistant reply supplies the action", () => {
      const onFork = jest.fn();
      renderButtons("ai", onFork);
      fireEvent.click(screen.getByTitle("Fork conversation"));
      expect(onFork).toHaveBeenCalledTimes(1);
    });

    it("disables the fork action while a branch is being created", () => {
      const onFork = jest.fn();
      renderButtons("ai", onFork, true);
      fireEvent.click(screen.getByTitle("Fork conversation"));
      expect(onFork).not.toHaveBeenCalled();
    });

    it("shows Copy for a user message", () => {
      renderButtons(USER_SENDER);
      expect(screen.getByTitle("Copy")).toBeTruthy();
      expect(screen.queryByTitle("Insert / Replace at cursor")).toBeNull();
      expect(screen.queryByTitle("Edit")).toBeNull();
      expect(screen.queryByTitle("Delete")).toBeNull();
    });
    it("shows Insert and Copy for an assistant message", () => {
      renderButtons("AI");
      expect(screen.getByTitle("Insert / Replace at cursor")).toBeTruthy();
      expect(screen.getByTitle("Copy")).toBeTruthy();
      expect(screen.queryByTitle("Regenerate")).toBeNull();
      expect(screen.queryByTitle("Delete")).toBeNull();
    });
  });
});
