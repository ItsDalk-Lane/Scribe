import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notice } from "obsidian";
import { QuickAskPanel } from "@/components/quick-ask/QuickAskPanel";
import type { QuickAskPanelProps } from "@/components/quick-ask/types";
import { useQuickAskSession } from "@/components/quick-ask/useQuickAskSession";
import { updateSetting } from "@/settings/model";

let mockDefaultModel: string | undefined;
const mockSend = jest.fn<Promise<boolean>, [string]>().mockResolvedValue(true);
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hooks; names must match the exports */
jest.mock("@/settings/model", () => ({
  useSettingsValue: () => ({
    quickCommandModelKey: "old-setting",
    quickCommandIncludeNoteContext: false,
  }),
  updateSetting: jest.fn(),
}));
jest.mock("@/hooks/useChatBackendModelOptions", () => ({
  useChatBackendModelOptions: () => ({
    options: mockDefaultModel ? [{ label: mockDefaultModel, value: mockDefaultModel }] : [],
  }),
}));
jest.mock("@/utils", () => ({ cleanMessageForCopy: (text: string) => text }));
jest.mock("@/hooks/use-draggable", () => ({
  useDraggable: () => ({ handlePointerDown: jest.fn() }),
}));
jest.mock("@/components/chat-components/useChatModelPicker", () => ({
  useChatModelPicker: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange: (value: string) => void;
  }) => ({ value: value ?? "", onChange, models: [] }),
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/components/ui/ModelSelector", () => ({
  ModelSelector: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <select aria-label="Model" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select model</option>
      <option value="gemini">Gemini</option>
      <option value="gpt">GPT</option>
    </select>
  ),
}));
jest.mock("@/components/quick-ask/QuickAskInput", () => ({
  QuickAskInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input aria-label="Question" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
jest.mock("@/components/quick-ask/QuickAskMessage", () => ({
  QuickAskMessageComponent: () => null,
}));
jest.mock("@/components/quick-ask/useQuickAskSession", () => ({ useQuickAskSession: jest.fn() }));
jest.mock("@/components/ui/help-tooltip", () => ({ HelpTooltip: () => null }));

const props = {
  plugin: { app: { workspace: { getActiveFile: () => null } } },
  view: {},
  editor: {},
  selectedText: "She go to school yesterday.",
  replaceGuard: { getRange: () => null },
  onClose: jest.fn(),
} as unknown as QuickAskPanelProps;

describe("QuickAskPanel", () => {
  describe("QuickAskPanel", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockSend.mockResolvedValue(true);
      mockDefaultModel = "gemini";
      jest.mocked(useQuickAskSession).mockImplementation(({ selectedModelKey }) => ({
        hasModel: !!selectedModelKey,
        messages: [],
        isStreaming: false,
        sendMessage: mockSend,
        stop: jest.fn(),
        clear: jest.fn(),
      }));
    });

    it("uses the first configured model despite a retired default and clears the submitted draft https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
      render(<QuickAskPanel {...props} />);
      expect(screen.getByLabelText<HTMLSelectElement>("Model").value).toBe("gemini");
      fireEvent.change(screen.getByLabelText("Question"), {
        target: { value: "Fix the sentence" },
      });
      fireEvent.click(screen.getByTitle("Send message"));
      await waitFor(() => expect(mockSend).toHaveBeenCalledWith("Fix the sentence"));
      expect(screen.getByLabelText<HTMLInputElement>("Question").value).toBe("");
    });

    it("retains a rejected long question for editing and clears it only after an accepted retry https://github.com/ItsDalk-Lane/Scribe/issues/64", async () => {
      mockSend.mockResolvedValueOnce(false);
      render(<QuickAskPanel {...props} />);
      fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Long question" } });
      fireEvent.click(screen.getByTitle("Send message"));
      await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
      expect(screen.getByLabelText<HTMLInputElement>("Question").value).toBe("Long question");
      fireEvent.change(screen.getByLabelText("Question"), {
        target: { value: "Shorter question" },
      });
      fireEvent.click(screen.getByTitle("Send message"));
      await waitFor(() =>
        expect(screen.getByLabelText<HTMLInputElement>("Question").value).toBe("")
      );
      expect(mockSend).toHaveBeenLastCalledWith("Shorter question");
    });

    it("keeps newer draft edits when an older accepted request finishes https://github.com/ItsDalk-Lane/Scribe/issues/64", async () => {
      let finish!: (value: boolean) => void;
      const pending = new Promise<boolean>((resolve) => {
        finish = resolve;
      });
      mockSend.mockReturnValueOnce(pending);
      render(<QuickAskPanel {...props} />);
      fireEvent.change(screen.getByLabelText("Question"), {
        target: { value: "Original question" },
      });
      fireEvent.click(screen.getByTitle("Send message"));
      expect(mockSend).toHaveBeenCalledWith("Original question");
      fireEvent.change(screen.getByLabelText("Question"), {
        target: { value: "New question draft" },
      });
      await act(async () => {
        finish(true);
        await pending;
      });
      expect(screen.getByLabelText<HTMLInputElement>("Question").value).toBe("New question draft");
    });

    it("retains the question when the master-password prompt is cancelled", async () => {
      mockSend.mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"));
      render(<QuickAskPanel {...props} />);
      fireEvent.change(screen.getByLabelText("Question"), {
        target: { value: "Keep this question" },
      });
      fireEvent.click(screen.getByTitle("Send message"));
      await waitFor(() => expect(mockSend).toHaveBeenCalledWith("Keep this question"));
      expect(screen.getByLabelText<HTMLInputElement>("Question").value).toBe("Keep this question");
    });

    it("submits only once while unlocking and allows retry after cancellation", async () => {
      let rejectUnlock!: (error: Error) => void;
      const waiting = new Promise<boolean>((_resolve, reject) => {
        rejectUnlock = reject;
      });
      mockSend.mockReturnValueOnce(waiting);
      render(<QuickAskPanel {...props} />);
      fireEvent.change(screen.getByLabelText("Question"), {
        target: { value: "Keep this question" },
      });
      fireEvent.click(screen.getByTitle("Send message"));
      fireEvent.click(screen.getByTitle("Send message"));
      expect(mockSend).toHaveBeenCalledTimes(1);
      await act(async () => {
        rejectUnlock(new DOMException("Cancelled", "AbortError"));
        await waiting.catch(() => undefined);
      });
      fireEvent.click(screen.getByTitle("Send message"));
      await waitFor(() =>
        expect(screen.getByLabelText<HTMLInputElement>("Question").value).toBe("")
      );
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("keeps a popup model choice local and reopens with the default", () => {
      const { unmount } = render(<QuickAskPanel {...props} />);
      fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt" } });
      expect(screen.getByLabelText<HTMLSelectElement>("Model").value).toBe("gpt");
      expect(updateSetting).not.toHaveBeenCalled();
      unmount();
      render(<QuickAskPanel {...props} />);
      expect(screen.getByLabelText<HTMLSelectElement>("Model").value).toBe("gemini");
    });

    it("preserves the question without a model and sends it after an explicit choice", async () => {
      mockDefaultModel = undefined;
      render(<QuickAskPanel {...props} />);
      expect(screen.getByLabelText<HTMLSelectElement>("Model").value).toBe("");
      fireEvent.change(screen.getByLabelText("Question"), {
        target: { value: "Fix the sentence" },
      });
      fireEvent.click(screen.getByTitle("Send message"));
      expect(mockSend).not.toHaveBeenCalled();
      expect(Notice).toHaveBeenCalledWith("Select a model to continue.");
      expect(screen.getByLabelText<HTMLInputElement>("Question").value).toBe("Fix the sentence");
      fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt" } });
      fireEvent.click(screen.getByTitle("Send message"));
      await waitFor(() => expect(mockSend).toHaveBeenCalledWith("Fix the sentence"));
    });
  });
});
