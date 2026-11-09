import { ProviderRequestError } from "@/LLMProviders/providerRequestFailure";
import React from "react";
import { Notice } from "obsidian";
import type { MenuCommandModal } from "@/components/command-ui";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CustomCommandChatModalContent } from "./CustomCommandChatModal";
import { processCommandPrompt } from "@/commands/customCommandUtils";
import { updateSetting } from "@/settings/model";
import { openScribeSettings } from "@/settings/openSettings";

let mockFirstModel: string | undefined = "quick";
const mockSettings = { quickCommandModelKey: "quick", quickCommandIncludeNoteContext: false };
const mockApp = { workspace: { getActiveFile: () => null } };
const mockModels = {
  explicit: {
    name: "explicit",
    configuredModelId: "explicit",
    credentialRef: undefined as string | undefined,
  },
  quick: { name: "quick", configuredModelId: "quick" },
  picked: { name: "picked", configuredModelId: "picked" },
};
let mockTurnGate: Promise<void> | undefined;
let mockTurnOutcome: "normal" | "context" | "length" = "normal";
const mockTurns: { model: string; prompt: string }[] = [];
const mockStop = jest.fn();
const mockReset = jest.fn();
const mockLatest = () => "";
const mockWithSecret = jest.fn<Promise<void>, [string, (value: string) => Promise<void>]>();
jest.mock("@/services/secretStore", () => ({
  SecretStore: { getInstance: () => ({ withSecret: mockWithSecret }) },
}));
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hooks; names must match the exports */
jest.mock("@/context", () => ({ useApp: () => mockApp }));
jest.mock("@/settings/model", () => ({
  useSettingsValue: () => mockSettings,
  updateSetting: jest.fn(),
}));
jest.mock("@/settings/openSettings", () => ({ openScribeSettings: jest.fn() }));
jest.mock("@/commands/customCommandUtils", () => ({
  processCommandPrompt: jest.fn(async (_app, prompt, selection) => `${prompt}: ${selection}`),
}));
jest.mock("@/components/chat-components/useChatModelPicker", () => ({
  useChatModelPicker: (params: { value: string; onChange: (value: string) => void }) => ({
    ...params,
    models: [],
  }),
}));
jest.mock("@/hooks/useChatBackendModelOptions", () => ({
  useChatBackendModelOptions: () => ({
    options: mockFirstModel ? [{ label: mockFirstModel, value: mockFirstModel }] : [],
  }),
}));
jest.mock("@/hooks/useResolvedChatBackendModel", () => ({
  useResolvedChatBackendModel: (_app: unknown, key: keyof typeof mockModels) =>
    mockModels[key] ?? null,
}));
jest.mock("@/hooks/use-streaming-chat-session", () => ({
  useStreamingChatSession: ({
    model,
    onNoModel,
    onNonAbortError,
    onTruncated,
  }: {
    model: { name: string } | null;
    onNoModel: () => void;
    onNonAbortError: (error: unknown) => void;
    onTruncated: () => void;
  }) => {
    const callbacksRef = React.useRef({ onNonAbortError, onTruncated });
    callbacksRef.current = { onNonAbortError, onTruncated };
    const onNoModelRef = React.useRef(onNoModel);
    onNoModelRef.current = onNoModel;
    const runTurn = React.useCallback(
      async (getPrompt: (ctx: unknown) => Promise<string>) => {
        if (!model) {
          onNoModelRef.current();
          return null;
        }
        const prompt = await getPrompt({ signal: new AbortController().signal, isFirstTurn: true });
        mockTurns.push({ model: model.name, prompt });
        if (mockTurnGate) await mockTurnGate;
        if (mockTurnOutcome === "context") {
          callbacksRef.current.onNonAbortError(
            new ProviderRequestError("Shorten this question or choose a larger model.", {
              kind: "context",
            })
          );
          return null;
        }
        if (mockTurnOutcome === "length") callbacksRef.current.onTruncated();
        return `Answer from ${model.name}`;
      },
      [model]
    );
    return {
      isStreaming: false,
      streamingText: "",
      runTurn,
      stop: mockStop,
      reset: mockReset,
      getLatestStreamingText: mockLatest,
    };
  },
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/components/command-ui", () => ({
  MenuCommandModal: (props: React.ComponentProps<typeof MenuCommandModal>) => (
    <div>
      <div>
        {props.contentState.type === "result" ? props.contentState.text : props.contentState.type}
      </div>
      <input
        aria-label="Result"
        value={props.editableContent ?? ""}
        onChange={(event) => props.onEditableContentChange?.(event.target.value)}
      />
      <button type="button" onClick={() => props.onSelectModel("picked")}>
        Choose model
      </button>
      <input
        aria-label="Instruction"
        value={props.followUpValue}
        onChange={(event) => props.onFollowUpChange(event.target.value)}
      />
      <button type="button" onClick={props.onFollowUpSubmit}>
        Submit
      </button>
      <button type="button" onClick={() => props.onOpenModelSettings?.(window)}>
        {props.needsModel ? "Model missing" : "Configure default"}
      </button>
      {props.onRunAgain && (
        <button type="button" onClick={props.onRunAgain}>
          Run again
        </button>
      )}
    </div>
  ),
}));
jest.mock("@/utils", () => ({
  cleanMessageForCopy: (value: string) => value,
  insertIntoEditor: jest.fn(),
}));
jest.mock("@/editor/selectionHighlight", () => ({ SelectionHighlight: {} }));
jest.mock("@/editor/replaceGuard", () => ({ createHighlightReplaceGuard: jest.fn() }));
jest.mock("@/utils/react/createPluginRoot", () => ({ createPluginRoot: jest.fn() }));
jest.mock("@/logger", () => ({ logError: jest.fn() }));

function commandModal(modelKey: string, autoExecuteOnOpen = true) {
  return (
    <CustomCommandChatModalContent
      originalText="Selected sentence"
      command={{
        order: 0,
        lastUsedMs: 0,
        title: "Rewrite",
        content: "Rewrite clearly",
        modelKey,
        showInContextMenu: true,
      }}
      onClose={() => undefined}
      onInsert={() => undefined}
      onReplace={() => undefined}
      behaviorConfig={{ autoExecuteOnOpen }}
    />
  );
}

function renderCommand(modelKey: string, autoExecuteOnOpen = true) {
  return render(commandModal(modelKey, autoExecuteOnOpen));
}

describe("CustomCommandChatModal", () => {
  describe("CustomCommandChatModalContent", () => {
    beforeEach(() => {
      mockTurns.length = 0;
      mockTurnOutcome = "normal";
      mockTurnGate = undefined;
      mockModels.explicit.credentialRef = undefined;
      mockWithSecret.mockReset().mockResolvedValue(undefined);
      jest.clearAllMocks();
      mockFirstModel = "quick";
      mockSettings.quickCommandModelKey = "explicit";
    });
    it.each([new DOMException("Cancelled", "AbortError"), new Error("Damaged encrypted entry")])(
      "keeps the instruction when selected-key validation fails: %s",
      async (failure) => {
        mockModels.explicit.credentialRef = "saved-reference";
        mockWithSecret.mockRejectedValueOnce(failure);
        renderCommand("explicit", false);
        fireEvent.change(screen.getByLabelText("Instruction"), {
          target: { value: "Keep this instruction" },
        });
        fireEvent.click(screen.getByText("Submit"));
        await waitFor(() => expect(mockWithSecret).toHaveBeenCalledTimes(1));
        expect(screen.getByLabelText<HTMLInputElement>("Instruction").value).toBe(
          "Keep this instruction"
        );
        expect(mockTurns).toEqual([]);
        expect(processCommandPrompt).not.toHaveBeenCalled();
      }
    );

    it("keeps a locally rejected instruction until the user edits and successfully retries https://github.com/ItsDalk-Lane/Scribe/issues/64", async () => {
      mockTurnOutcome = "context";
      renderCommand("explicit", false);
      fireEvent.change(screen.getByLabelText("Instruction"), {
        target: { value: "Long instruction" },
      });
      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() =>
        expect(Notice).toHaveBeenCalledWith("Shorten this question or choose a larger model.")
      );
      expect(screen.getByLabelText<HTMLInputElement>("Instruction").value).toBe("Long instruction");
      mockTurnOutcome = "normal";
      fireEvent.change(screen.getByLabelText("Instruction"), {
        target: { value: "Short instruction" },
      });
      fireEvent.click(screen.getByText("Submit"));
      await screen.findByText("Answer from explicit");
      expect(screen.getByLabelText<HTMLInputElement>("Instruction").value).toBe("");
    });

    it("keeps newer instruction edits when an older accepted request finishes https://github.com/ItsDalk-Lane/Scribe/issues/64", async () => {
      let finish!: () => void;
      mockTurnGate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      renderCommand("explicit", false);
      fireEvent.change(screen.getByLabelText("Instruction"), {
        target: { value: "Original instruction" },
      });
      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() => expect(mockTurns).toHaveLength(1));
      fireEvent.change(screen.getByLabelText("Instruction"), {
        target: { value: "New instruction draft" },
      });
      finish();
      await screen.findByText("Answer from explicit");
      expect(screen.getByLabelText<HTMLInputElement>("Instruction").value).toBe(
        "New instruction draft"
      );
    });

    it("retains the previous visible answer and manual edits when a follow-up is rejected locally https://github.com/ItsDalk-Lane/Scribe/issues/64", async () => {
      renderCommand("explicit");
      await screen.findByText("Answer from explicit");
      fireEvent.change(screen.getByLabelText("Result"), { target: { value: "My edited answer" } });
      mockTurnOutcome = "context";
      fireEvent.change(screen.getByLabelText("Instruction"), {
        target: { value: "Too much follow-up content" },
      });
      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() =>
        expect(Notice).toHaveBeenCalledWith("Shorten this question or choose a larger model.")
      );
      expect(screen.getByText("Answer from explicit")).not.toBeNull();
      expect(screen.getByLabelText<HTMLInputElement>("Result").value).toBe("My edited answer");
      expect(screen.getByLabelText<HTMLInputElement>("Instruction").value).toBe(
        "Too much follow-up content"
      );
    });

    it("shows the output-limit notice while retaining the generated partial result https://github.com/ItsDalk-Lane/Scribe/issues/64", async () => {
      mockTurnOutcome = "length";
      renderCommand("explicit");
      await screen.findByText("Answer from explicit");
      expect(Notice).toHaveBeenCalledWith(
        "The answer reached the model's output limit and may be incomplete. Ask to continue."
      );
    });

    it("runs the saved command with its explicit model", async () => {
      renderCommand("explicit");
      await screen.findByText("Answer from explicit");
      expect(mockTurns).toEqual([
        { model: "explicit", prompt: "Rewrite clearly: Selected sentence" },
      ]);
    });
    it("uses the first configured model instead of the retired quick-tool default https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
      renderCommand("");
      await screen.findByText("Answer from quick");
      expect(mockTurns[0].model).toBe("quick");
    });
    it.each([
      [
        "removed",
        "This command's model is unavailable. Edit it in Settings → Scribe → My commands to choose another model, then rerun.",
      ],
      ["", "Configure a model in Settings → Scribe → Models, then rerun the command."],
    ])(
      "with unavailable selection %p, shows %p and does not resume after a popup choice",
      async (modelKey, notice) => {
        mockFirstModel = "";
        renderCommand(modelKey);
        await waitFor(() => expect(Notice).toHaveBeenCalledWith(notice));
        expect(screen.getByText("idle")).not.toBeNull();
        expect(processCommandPrompt).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText("Choose model"));
        await waitFor(() => expect(screen.getByText("idle")).not.toBeNull());
        expect(mockTurns).toEqual([]);
        expect(processCommandPrompt).not.toHaveBeenCalled();
        expect(updateSetting).not.toHaveBeenCalled();
      }
    );
    it("preserves a quick-command draft until a model is selected and keeps that choice local", async () => {
      mockFirstModel = "";
      renderCommand("", false);
      fireEvent.change(screen.getByLabelText("Instruction"), { target: { value: "Make concise" } });
      fireEvent.click(screen.getByText("Submit"));
      expect(screen.getByLabelText<HTMLInputElement>("Instruction").value).toBe("Make concise");
      expect(mockTurns).toEqual([]);
      fireEvent.click(screen.getByText("Choose model"));
      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() =>
        expect(mockTurns).toEqual([{ model: "picked", prompt: "Make concise: Selected sentence" }])
      );
      expect(updateSetting).not.toHaveBeenCalled();
    });
    it("flags a missing model and opens Models to configure one https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
      mockFirstModel = "";
      renderCommand("");
      fireEvent.click(await screen.findByText("Model missing"));
      expect(openScribeSettings).toHaveBeenCalledWith(mockApp, window, "quickActions");
    });
    it("follows a default set in settings until the user picks a model in the dialog", async () => {
      mockFirstModel = "";
      const view = renderCommand("", false);
      expect(screen.getByText("Model missing")).not.toBeNull();
      mockFirstModel = "quick";
      view.rerender(commandModal("", false));
      expect(screen.getByText("Configure default")).not.toBeNull();
      fireEvent.click(screen.getByText("Choose model"));
      mockFirstModel = "explicit";
      view.rerender(commandModal("", false));
      fireEvent.change(screen.getByLabelText("Instruction"), { target: { value: "Summarize" } });
      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() => expect(mockTurns[0]?.model).toBe("picked"));
    });
    it("runs a saved command on the selection again in a fresh session", async () => {
      renderCommand("explicit");
      await screen.findByText("Answer from explicit");
      fireEvent.click(screen.getByText("Run again"));
      await waitFor(() => expect(mockTurns).toHaveLength(2));
      expect(mockReset).toHaveBeenCalledTimes(1);
      expect(mockTurns[1]).toEqual({
        model: "explicit",
        prompt: "Rewrite clearly: Selected sentence",
      });
    });
    it("offers Run again for a quick command only after its first instruction, then reruns that instruction", async () => {
      renderCommand("", false);
      expect(screen.queryByText("Run again")).toBeNull();
      fireEvent.change(screen.getByLabelText("Instruction"), { target: { value: "Make concise" } });
      fireEvent.click(screen.getByText("Submit"));
      await screen.findByText("Answer from quick");
      fireEvent.click(screen.getByText("Run again"));
      await waitFor(() => expect(mockTurns).toHaveLength(2));
      expect(mockTurns[1]).toEqual({ model: "quick", prompt: "Make concise: Selected sentence" });
    });
  });
});
