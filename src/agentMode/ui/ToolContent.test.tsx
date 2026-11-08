import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToolContent, ToolTextContent } from "@/agentMode/ui/ToolContent";
import { TooltipProvider } from "@/components/ui/tooltip";

const copy = jest.fn();
jest.mock("@/components/chat-components/CopyButton", () => ({
  CopyButton: ({ text }: { text: string }) => (
    <button type="button" onClick={() => copy(text)}>
      Copy
    </button>
  ),
}));
jest.mock("@/components/Markdown", () => ({
  Markdown: ({ text }: { text: string }) => <article aria-label="Markdown">{text}</article>,
}));

describe("ToolContent", () => {
  describe("ToolTextContent()", () => {
    it("labels string-wrapped JSON, displays its decoded array, and retains the exact original for viewing and copying https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const raw = JSON.stringify('[{"title":"Obsidian","id":900719925474099312345}]');
      const { container } = render(<ToolTextContent text={raw} />);
      expect(screen.getByText("JSON string")).toBeTruthy();
      expect(container.querySelector("pre")!.textContent).toContain('"title": "Obsidian"');
      expect(container.querySelector("pre")!.textContent).toContain("900719925474099312345");
      expect(container.querySelector("details pre")!.textContent).toBe(raw);
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      expect(copy).toHaveBeenLastCalledWith(raw);
    });
    it("shows long results progressively and copies the complete unchanged original https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const text = "long output ".repeat(4_000) + "FINAL-MARKER";
      const { container } = render(<ToolTextContent text={text} />);
      expect(container.querySelector("pre")!.textContent!.length).toBe(32_000);
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      expect(copy).toHaveBeenLastCalledWith(text);
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      expect(container.querySelector("pre")!.textContent).toBe(text);
      expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    });
    it("renders Markdown separately from plain text and retains newlines https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const { rerender, container } = render(<ToolTextContent text={"# Result\n\n- One\n- Two"} />);
      expect(screen.getByRole("article", { name: "Markdown" }).textContent).toBe(
        "# Result\n\n- One\n- Two"
      );
      rerender(<ToolTextContent text={"one\ntwo"} />);
      expect(container.querySelector("pre")!.textContent).toBe("one\ntwo");
    });
  });
  describe("ToolContent()", () => {
    it("keeps annotations and opaque metadata readable in the original block https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const { container } = render(
        <ToolContent
          content={{
            type: "text",
            text: "Visible text",
            annotations: { audience: ["user"], priority: 0.7 },
            _meta: { version: 99 },
          }}
        />
      );
      expect(screen.getByText("Original data")).toBeTruthy();
      expect(container.querySelector("details")!.textContent).toContain('"audience": [');
      expect(container.querySelector("details")!.textContent).toContain('"version": 99');
    });
    it("renders image, audio and embedded Markdown resources by their content types https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      render(
        <TooltipProvider>
          <ToolContent content={{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }} />
          <ToolContent content={{ type: "audio", data: "AAEC", mimeType: "audio/wav" }} />
          <ToolContent
            content={{
              type: "resource",
              resource: { uri: "mcp://report", mimeType: "text/markdown", text: "# Report" },
            }}
          />
        </TooltipProvider>
      );
      expect(screen.getByRole("img").getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=");
      expect(screen.getByLabelText("Tool audio").getAttribute("src")).toBe(
        "data:audio/wav;base64,AAEC"
      );
      expect(screen.getByRole("article", { name: "Markdown" }).textContent).toBe("# Report");
    });
    it("keeps resource links, downloadable binary resources and unknown blocks available without executing unsafe URIs https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const { container } = render(
        <>
          <ToolContent
            content={{
              type: "resource_link",
              name: "Report",
              uri: "https://example.com/report",
              description: "Full report",
            }}
          />
          <ToolContent
            content={{
              type: "resource",
              resource: { uri: "mcp://binary", mimeType: "application/pdf", blob: "AAEC" },
            }}
          />
          <ToolContent content={{ type: "resource_link", uri: "javascript:alert(1)" }} />
          <ToolContent content={{ type: "future-block", opaque: { id: "complete" } }} />
        </>
      );
      expect(screen.getByRole("link", { name: "Report" }).getAttribute("href")).toBe(
        "https://example.com/report"
      );
      expect(screen.getByRole("link", { name: "Download resource" }).getAttribute("href")).toBe(
        "data:application/pdf;base64,AAEC"
      );
      expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
      expect(container.textContent).toContain('"opaque": {');
      expect(container.textContent).toContain('"id": "complete"');
    });
    it("preserves structured JSON blocks and the original exact digits https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const { container } = render(
        <ToolContent content={{ type: "json", text: '{"id":900719925474099312345}' }} />
      );
      expect(container.textContent).toContain('"id": 900719925474099312345');
    });
  });
});
