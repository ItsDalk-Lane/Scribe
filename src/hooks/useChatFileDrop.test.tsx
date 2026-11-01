import { useChatFileDrop } from "@/hooks/useChatFileDrop";
import { createEvent, fireEvent, render, waitFor } from "@testing-library/react";
import { type App, TFile, Notice } from "obsidian";
import React, { useEffect, useRef } from "react";

interface FakeItem {
  kind: "string" | "file";
}

function makeDataTransfer(items: FakeItem[]) {
  return {
    types: [] as string[],
    dropEffect: "",
    items: items.map((item) => ({ kind: item.kind })),
  };
}

function dispatchDrag(type: "dragOver" | "drop", target: HTMLElement, items: FakeItem[]): void {
  const event = createEvent[type](target, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: makeDataTransfer(items) });
  fireEvent(target, event);
}

const DEFAULT_SET_CONTEXT_NOTES = jest.fn();

function Harness({
  app,
  isAgentMode = false,
  setContextNotes = DEFAULT_SET_CONTEXT_NOTES,
}: {
  app: App;
  isAgentMode?: boolean;
  setContextNotes?: jest.Mock;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerZoneRef = useRef<HTMLDivElement>(null);
  const { isDragActive } = useChatFileDrop({
    app,
    contextNotes: [],
    setContextNotes,
    isAgentMode,
    selectedImages: [],
    onAddImage: jest.fn(),
    containerRef,
  });

  useEffect(() => {
    const innerZone = innerZoneRef.current;
    if (!innerZone) return;
    const stopBubble = (event: Event) => event.stopPropagation();
    innerZone.addEventListener("drop", stopBubble);
    return () => innerZone.removeEventListener("drop", stopBubble);
  }, []);

  return (
    <div ref={containerRef}>
      <div data-testid="overlay">{isDragActive ? "active" : "idle"}</div>
      <div ref={innerZoneRef} data-copilot-drop-zone="" data-testid="inner-zone" />
    </div>
  );
}

describe("useChatFileDrop", () => {
  describe("useChatFileDrop()", () => {
    it.each([true, false])(
      "accepts a dropped PDF only when Agent Chat is %s",
      async (isAgentMode) => {
        jest.clearAllMocks();
        const pdf = Object.assign(new TFile(), {
          path: "Research.pdf",
          extension: "pdf",
          name: "Research.pdf",
        });
        const app = { vault: { getAbstractFileByPath: () => pdf } } as unknown as App;
        const setContextNotes = DEFAULT_SET_CONTEXT_NOTES;
        const { getByTestId } = render(
          <Harness app={app} isAgentMode={isAgentMode} setContextNotes={setContextNotes} />
        );
        const target = getByTestId("overlay");
        const event = createEvent.drop(target, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "dataTransfer", {
          value: {
            items: [
              {
                kind: "string",
                getAsString: (callback: (value: string) => void) =>
                  callback("obsidian://open?vault=Test&file=Research.pdf"),
              },
            ],
          },
        });
        fireEvent(target, event);
        if (isAgentMode) {
          await waitFor(() => expect(setContextNotes).toHaveBeenCalledTimes(1));
          expect(setContextNotes.mock.calls[0][0]([])).toEqual([pdf]);
        } else {
          await waitFor(() =>
            expect(Notice).toHaveBeenCalledWith(
              expect.stringContaining("Unsupported file type: pdf")
            )
          );
          expect(setContextNotes).not.toHaveBeenCalled();
        }
      }
    );

    it("clears the overlay when a drop lands in an inner zone that stops bubbling", () => {
      const { getByTestId } = render(<Harness app={{} as App} />);
      const overlay = getByTestId("overlay");

      dispatchDrag("dragOver", getByTestId("overlay"), [{ kind: "file" }]);
      expect(overlay.textContent).toBe("active");

      dispatchDrag("drop", getByTestId("inner-zone"), [{ kind: "file" }]);
      expect(overlay.textContent).toBe("idle");
    });
  });
});
