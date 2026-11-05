import ChatInput, {
  type ChatInputHandle,
  type ChatInputProps,
} from "@/components/chat-components/ChatInput";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { type App, TFile } from "obsidian";
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  type LexicalEditor,
} from "lexical";
import type { ModelSelector } from "@/components/ui/ModelSelector";
let mockEditor: LexicalEditor;
let mockActiveNote: TFile | null;
let mockModelSelectorProps: React.ComponentProps<typeof ModelSelector> | undefined;

jest.mock("@/components/ui/ModelSelector", () => ({
  ModelSelector: (props: React.ComponentProps<typeof ModelSelector>) => {
    mockModelSelectorProps = props;
    return null;
  },
}));
jest.mock("@/components/chat-components/ContextControl", () => ({
  ContextControl: ({ activeNote }: { activeNote: TFile | null }) => {
    mockActiveNote = activeNote;
    return null;
  },
}));
jest.mock("@/components/chat-components/AddContextButton", () => ({
  AddContextButton: () => null,
}));
jest.mock("@/components/chat-components/LexicalEditor", () => ({
  __esModule: true,
  default: function MockLexicalEditor({
    onSubmit,
    onEditorReady,
    value,
  }: {
    onSubmit: () => void;
    onEditorReady: (editor: LexicalEditor) => void;
    value: string;
  }) {
    React.useEffect(() => {
      mockEditor = createEditor({
        namespace: "restore-test",
        onError: (error) => {
          throw error;
        },
      });
      mockEditor.update(
        () => {
          $getRoot().append($createParagraphNode().append($createTextNode(value)));
        },
        { discrete: true }
      );
      onEditorReady(mockEditor);
    }, [onEditorReady, value]);
    return (
      <input aria-label="Message" onKeyDown={(event) => event.key === "Enter" && onSubmit()} />
    );
  },
}));

const image = new File(["image bytes"], "screenshot.png", { type: "image/png" });

function composer(
  inputMessage: string,
  selectedImages: File[],
  overrides: Partial<ChatInputProps> = {}
) {
  const props = {
    inputMessage,
    selectedImages,
    handleSendMessage: jest.fn(),
    isGenerating: false,
    app: { workspace: { getActiveFile: () => null, on: jest.fn(), offref: jest.fn() } },
    contextNotes: [],
    setContextNotes: jest.fn(),
    setInputMessage: jest.fn(),
    onStopGenerating: jest.fn(),
    setIncludeActiveNote: jest.fn(),
    setIncludeActiveWebTab: jest.fn(),
    onAddImage: jest.fn(),
    setSelectedImages: jest.fn(),
    includeActiveNote: false,
    includeActiveWebTab: false,
    activeWebTab: null,
    ...overrides,
  } as unknown as ChatInputProps;
  return { node: <ChatInput {...props} />, send: props.handleSendMessage, props };
}

describe("ChatInput", () => {
  const { createObjectURL, revokeObjectURL } = URL;
  beforeAll(() => {
    URL.createObjectURL = jest.fn(() => "blob:screenshot");
    URL.revokeObjectURL = jest.fn();
  });
  afterAll(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });
  describe("ChatInput", () => {
    it("keeps the active PDF available to Agent Chat", () => {
      const pdf = Object.assign(new TFile(), {
        path: "Research.pdf",
        extension: "pdf",
        basename: "Research",
      });
      const app = {
        workspace: { getActiveFile: () => pdf, on: jest.fn(), offref: jest.fn() },
      } as unknown as App;
      render(composer("", [], { app }).node);
      expect(mockActiveNote).toBe(pdf);
    });

    it("shows an empty, disabled model picker when the caller supplies no models, never the legacy built-in list", () => {
      render(composer("", []).node);

      expect(mockModelSelectorProps?.models).toEqual([]);
      expect(mockModelSelectorProps?.value).toBe("");
      expect(mockModelSelectorProps?.disabled).toBe(true);
    });
  });
  describe("prependContent", () => {
    it.each(["draft in progress", ""])(
      "restores web context and resolved text ahead of draft %p without losing existing pills",
      (current) => {
        const { props, send } = composer(current, []);
        const ref: React.RefObject<ChatInputHandle> = { current: null };
        render(<ChatInput {...props} ref={ref} />);
        const webTab = { url: "https://example.com/report", title: "Report" };
        act(() => ref.current!.prependContent("Review these changes", [webTab]));
        const restored = mockEditor.getEditorState().read(() => ({
          text: $getRoot().getTextContent(),
          nodes: $getRoot()
            .getChildren()
            .flatMap((node) =>
              "getChildren" in node ? (node as import("lexical").ElementNode).getChildren() : []
            ),
        }));
        expect(restored.text).toBe("Review these changes" + (current ? "\n\n" + current : ""));
        expect(props.setInputMessage).toHaveBeenCalledWith(restored.text);
        fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "Enter" });
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ webTabs: [webTab] }));
      }
    );
  });
  describe("onSendMessage", () => {
    it("blocks button and Enter sending while keeping model selection available when sending is unavailable (https://github.com/ItsDalk-Lane/Scribe/issues/21)", () => {
      const { node, send } = composer("Keep this draft", [image], {
        sendDisabled: true,
        modelPickerOverride: { value: "model", models: [], onChange: jest.fn() },
      });
      render(node);
      const button = screen.getByRole<HTMLButtonElement>("button", { name: "Send" });
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "Enter" });
      expect(send).not.toHaveBeenCalled();
      expect(mockModelSelectorProps?.disabled).toBe(false);
    });

    it("keeps Stop available while sending is unavailable (https://github.com/ItsDalk-Lane/Scribe/issues/21)", () => {
      const { node, props } = composer("", [], { isGenerating: true, sendDisabled: true });
      render(node);
      const stop = screen.getByRole<HTMLButtonElement>("button", { name: "Stop generating" });
      expect(stop.disabled).toBe(false);
      fireEvent.click(stop);
      expect(props.onStopGenerating).toHaveBeenCalledTimes(1);
    });

    it("sends webpage attachments restored by the chat draft owner", () => {
      const webTab = { url: "https://example.com/retained", title: "Retained page" };
      const { node, send } = composer("continue", [], {
        contextWebTabs: [webTab],
        setContextWebTabs: jest.fn(),
      });
      render(node);
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "Enter" });
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ webTabs: [webTab] }));
    });

    it.each(["", "   ", "Describe this"])("enables Send with an image and draft %p", (text) => {
      const { node, send } = composer(text, [image]);
      render(node);
      const button = screen.getByRole<HTMLButtonElement>("button", { name: "Send" });
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("disables Send after the last image is removed from an empty draft", () => {
      const view = render(composer("", [image]).node);
      view.rerender(composer("   ", []).node);
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Send" }).disabled).toBe(true);
    });

    it("routes Enter with an image-only draft to the send handler", () => {
      const { node, send } = composer("", [image]);
      render(node);
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "Enter" });
      expect(send).toHaveBeenCalledTimes(1);
    });

    it.each([
      { scenario: "text", text: "Do this instead", images: [] as File[] },
      { scenario: "an image", text: "", images: [image] },
    ])(
      "shows only Send while the agent's reply runs and the draft has $scenario, sending it as Enter would",
      ({ text, images }) => {
        const { node, send } = composer(text, images, { isGenerating: true });
        render(node);

        expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Send" }));

        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(expect.not.objectContaining({ interrupt: true }));
      }
    );

    it("shows only Stop while the agent's reply runs and the draft is empty", () => {
      const { node, props } = composer("   ", [], { isGenerating: true });
      render(node);
      expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
      expect(props.onStopGenerating).toHaveBeenCalledTimes(1);
    });

    it("sends Enter while the agent works without interrupt", () => {
      const { node, send } = composer("Only the first two", [], { isGenerating: true });
      render(node);

      fireEvent.keyDown(screen.getByRole("textbox", { name: "Message" }), { key: "Enter" });

      expect(send).toHaveBeenCalledWith(expect.not.objectContaining({ interrupt: true }));
    });
  });
});
