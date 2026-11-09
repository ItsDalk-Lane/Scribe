import { Notice } from "obsidian";
import { ProviderRequestError } from "@/LLMProviders/providerRequestFailure";
import type { UseStreamingChatSessionParams } from "@/hooks/use-streaming-chat-session";
import { act, renderHook } from "@testing-library/react";
import { useQuickAskSession } from "./useQuickAskSession";
import { useResolvedChatBackendModel } from "@/hooks/useResolvedChatBackendModel";

const mockModel = {
  name: "selected",
  configuredModelId: "selected",
  provider: "openai",
  enabled: true,
};
const mockApp = {};
const mockWithSecret = jest.fn<Promise<void>, [string, (value: string) => Promise<void>]>();
jest.mock("@/services/secretStore", () => ({
  SecretStore: { getInstance: () => ({ withSecret: mockWithSecret }) },
}));
const mockRunTurn = jest.fn<Promise<string | null>, []>().mockResolvedValue("Answer");
let mockCallbacks: UseStreamingChatSessionParams;
const mockStop = jest.fn();
const mockReset = jest.fn();
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hooks; names must match the exports */
jest.mock("@/context", () => ({ useApp: () => mockApp }));
jest.mock("@/hooks/useResolvedChatBackendModel", () => ({
  useResolvedChatBackendModel: jest.fn(() => mockModel),
}));
jest.mock("@/hooks/use-streaming-chat-session", () => ({
  useStreamingChatSession: (params: UseStreamingChatSessionParams) => {
    mockCallbacks = params;
    return {
      isStreaming: false,
      streamingText: "",
      runTurn: mockRunTurn,
      stop: mockStop,
      reset: mockReset,
    };
  },
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/commands/customCommandUtils", () => ({ processCommandPrompt: jest.fn() }));
jest.mock("@/logger", () => ({ logError: jest.fn() }));

describe("useQuickAskSession", () => {
  describe("useQuickAskSession", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockRunTurn.mockReset().mockResolvedValue("Answer");
      mockWithSecret.mockReset().mockResolvedValue(undefined);
      jest.mocked(useResolvedChatBackendModel).mockReturnValue(mockModel);
    });
    it("adds the question and answer using the explicitly selected model", async () => {
      const { result } = renderHook(() =>
        useQuickAskSession({
          selectedText: "selection",
          selectedModelKey: "selected",
          includeNoteContext: false,
        })
      );
      await act(async () => {
        await result.current.sendMessage("Explain this");
      });
      expect(result.current.messages.map(({ role, content }) => ({ role, content }))).toEqual([
        { role: "user", content: "Explain this" },
        { role: "assistant", content: "Answer" },
      ]);
      act(() => result.current.stop());
      expect(mockStop).toHaveBeenCalled();
      act(() => result.current.clear());
      expect(result.current.messages).toEqual([]);
      expect(mockReset).toHaveBeenCalled();
    });
    it("reports a local context rejection without accepting messages and permits retry https://github.com/ItsDalk-Lane/Scribe/issues/64", async () => {
      mockRunTurn.mockImplementationOnce(async () => {
        mockCallbacks.onNonAbortError?.(
          new ProviderRequestError("Shorten this question or choose a larger model.", {
            kind: "context",
          })
        );
        return null;
      });
      const { result } = renderHook(() =>
        useQuickAskSession({
          selectedText: "selection",
          selectedModelKey: "selected",
          includeNoteContext: false,
        })
      );
      await act(async () => {
        expect(await result.current.sendMessage("Long question")).toBe(false);
      });
      expect(Notice).toHaveBeenCalledWith("Shorten this question or choose a larger model.");
      expect(result.current.messages).toEqual([]);
      await act(async () => {
        expect(await result.current.sendMessage("Short question")).toBe(true);
      });
      expect(result.current.messages.map((message) => message.content)).toEqual([
        "Short question",
        "Answer",
      ]);
    });

    it("shows a separate truncation notice and keeps the partial answer https://github.com/ItsDalk-Lane/Scribe/issues/64", async () => {
      mockRunTurn.mockImplementationOnce(async () => {
        mockCallbacks.onTruncated?.();
        return "Partial answer";
      });
      const { result } = renderHook(() =>
        useQuickAskSession({
          selectedText: "selection",
          selectedModelKey: "selected",
          includeNoteContext: false,
        })
      );
      await act(async () => {
        expect(await result.current.sendMessage("Question")).toBe(true);
      });
      expect(result.current.messages.at(-1)?.content).toBe("Partial answer");
      expect(Notice).toHaveBeenCalledWith(
        "The answer reached the model's output limit and may be incomplete. Ask to continue."
      );
    });

    it.each([new DOMException("Cancelled", "AbortError"), new Error("Damaged encrypted entry")])(
      "does not add a message or start a turn when selected-key validation fails: %s",
      async (failure) => {
        jest
          .mocked(useResolvedChatBackendModel)
          .mockReturnValue({ ...mockModel, credentialRef: "saved-reference" });
        mockWithSecret.mockRejectedValueOnce(failure);
        const { result } = renderHook(() =>
          useQuickAskSession({
            selectedText: "selection",
            selectedModelKey: "selected",
            includeNoteContext: false,
          })
        );
        await act(async () => {
          await expect(result.current.sendMessage("Keep this question")).rejects.toMatchObject({
            message: failure.message,
          });
        });
        expect(mockWithSecret).toHaveBeenCalledWith("saved-reference", expect.any(Function));
        expect(result.current.messages).toEqual([]);
        expect(mockRunTurn).not.toHaveBeenCalled();
      }
    );

    it("exposes unavailable selections to the panel", () => {
      jest.mocked(useResolvedChatBackendModel).mockReturnValue(null);
      const { result } = renderHook(() =>
        useQuickAskSession({
          selectedText: "selection",
          selectedModelKey: "removed",
          includeNoteContext: false,
        })
      );
      expect(useResolvedChatBackendModel).toHaveBeenCalledWith(mockApp, "removed");
      expect(result.current.hasModel).toBe(false);
      expect(result.current.messages).toEqual([]);
    });
  });
});
