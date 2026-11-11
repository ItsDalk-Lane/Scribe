import { MarkdownRenderController } from "@/components/markdown/MarkdownRenderController";
import { scheduleMarkdownEnhancement } from "@/components/markdown/enhancementQueue";
import { renderMarkdown } from "@/utils/renderMarkdown";
import { waitFor } from "@testing-library/react";
import { App, Component } from "obsidian";

jest.mock("@/utils/renderMarkdown", () => ({ renderMarkdown: jest.fn() }));
jest.mock("@/components/markdown/enhancementQueue", () => ({
  scheduleMarkdownEnhancement: jest.fn((_target: HTMLElement, run: () => Promise<void>) => run()),
}));

function snapshot(text: string, overrides = {}) {
  return {
    text,
    sourcePath: "",
    renderIdentity: "chat:message:part",
    isStreaming: true,
    contentPolicy: "model" as const,
    ...overrides,
  };
}
function makeController() {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const app = {
    metadataCache: {
      computeMetadataAsync: async (buffer: ArrayBuffer) => {
        const text = new TextDecoder().decode(buffer);
        let offset = 0;
        return {
          sections: text
            .split("\n\n")
            .filter(Boolean)
            .map((part) => {
              const start = text.indexOf(part, offset);
              offset = start + part.length;
              return { type: "paragraph", position: { start: { offset: start }, end: { offset } } };
            }),
        };
      },
    },
  } as unknown as App;
  const completed = jest.fn();
  const controller = new MarkdownRenderController(app, target, completed);
  return { target, controller, completed };
}

describe("MarkdownRenderController", () => {
  describe("MarkdownRenderController", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      document.body.replaceChildren();
      jest.mocked(renderMarkdown).mockImplementation(async (_app, text, target) => {
        target.textContent = text;
      });
    });

    describe("update()", () => {
      it("reuses completed prefix containers and only renders changed text https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
        const { controller, target, completed } = makeController();
        controller.update(snapshot("First\n\nSecond\n\nThird"));
        await waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
        const first = target.querySelector("div div div");
        expect(renderMarkdown).toHaveBeenCalledTimes(3);
        controller.update(snapshot("First\n\nSecond\n\nThird grows"));
        await waitFor(() => expect(completed).toHaveBeenCalledTimes(2));
        expect(renderMarkdown).toHaveBeenCalledTimes(4);
        expect(target.querySelector("div div div")).toBe(first);
        expect(target.textContent).toBe("First\n\nSecond\n\nThird grows");
        controller.dispose();
      });

      it("does not recreate unchanged rich content on completion https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
        const { controller, target, completed } = makeController();
        controller.update(snapshot("The answer"));
        await waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
        const rendered = target.querySelector("div div div");
        controller.update(snapshot("The answer", { isStreaming: false }));
        await waitFor(() => expect(completed).toHaveBeenCalledTimes(2));
        expect(renderMarkdown).toHaveBeenCalledTimes(1);
        expect(target.querySelector("div div div")).toBe(rendered);
        controller.dispose();
      });

      it("shows complete oversized code without starting automatic enhancement https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
        const { controller, target, completed } = makeController();
        const text = `\`\`\`text\n${"x".repeat(50_001)}\n\`\`\``;
        controller.update(snapshot(text, { isStreaming: false }));
        await waitFor(() => expect(completed).toHaveBeenCalled());
        expect(target.textContent).toBe(text);
        expect(renderMarkdown).not.toHaveBeenCalled();
        expect(scheduleMarkdownEnhancement).not.toHaveBeenCalled();
        controller.dispose();
      });

      it("keeps open code readable and enhances it after its closing fence arrives https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
        const { controller, target, completed } = makeController();
        const text = "```javascript\nconst value = 1;";
        controller.update(snapshot(text));
        await waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
        expect(target.textContent).toBe(text);
        expect(renderMarkdown).not.toHaveBeenCalled();
        controller.update(snapshot(`${text}\n\`\`\``));
        await waitFor(() => expect(completed).toHaveBeenCalledTimes(2));
        expect(scheduleMarkdownEnhancement).toHaveBeenCalledTimes(1);
        expect(renderMarkdown).toHaveBeenCalledTimes(1);
        controller.dispose();
      });

      it("keeps source text when enhancement fails and passes the explicit source to the host https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
        jest.mocked(renderMarkdown).mockRejectedValue(new Error("host unavailable"));
        const { controller, target, completed } = makeController();
        controller.update(snapshot("Readable answer", { sourcePath: "notes/Source.md" }));
        await waitFor(() => expect(completed).toHaveBeenCalled());
        expect(target.textContent).toBe("Readable answer");
        expect(jest.mocked(renderMarkdown).mock.calls[0][3]).toBe("notes/Source.md");
        controller.dispose();
      });

      it("preprocesses model display without changing the original text https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
        const { controller, completed } = makeController();
        const original = "```dataview\nLIST\n```";
        controller.update(snapshot(original, { isStreaming: false }));
        await waitFor(() => expect(completed).toHaveBeenCalled());
        expect(jest.mocked(renderMarkdown).mock.calls[0][1]).toBe("```text\nLIST\n```");
        expect(original).toBe("```dataview\nLIST\n```");
        controller.dispose();
      });
      it("keeps original text readable while prepared legacy markup fails https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
        jest.mocked(renderMarkdown).mockRejectedValue(new Error("host unavailable"));
        const { controller, target, completed } = makeController();
        controller.update(
          snapshot("Original answer", {
            preparedText: "<details><summary>Process</summary>Original answer</details>",
          })
        );
        await waitFor(() => expect(completed).toHaveBeenCalled());
        expect(jest.mocked(renderMarkdown).mock.calls[0][1]).toContain("<details>");
        expect(target.textContent).toBe("Original answer");
        controller.dispose();
      });
    });

    describe("dispose()", () => {
      it("detaches pending host writes and releases resources without a completion callback https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
        let finish: (() => void) | undefined;
        const released = jest.spyOn(Component.prototype, "unload");
        jest.mocked(renderMarkdown).mockImplementationOnce(
          (_app, text, target) =>
            new Promise<void>((resolve) => {
              finish = () => {
                target.textContent = text;
                resolve();
              };
            })
        );
        const { controller, target, completed } = makeController();
        controller.update(snapshot("Obsolete answer"));
        await waitFor(() => expect(renderMarkdown).toHaveBeenCalled());
        controller.dispose();
        finish?.();
        expect(target.textContent).toBe("");
        expect(completed).not.toHaveBeenCalled();
        expect(released).toHaveBeenCalled();
        controller.update(snapshot("Ignored after close"));
        expect(target.textContent).toBe("");
        released.mockRestore();
      });
    });
  });
});
