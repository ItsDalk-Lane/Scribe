import { ReasoningBlock } from "@/agentMode/ui/ReasoningBlock";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("ReasoningBlock", () => {
  describe("ReasoningBlock", () => {
    it("stops its thinking title as soon as the thought duration is confirmed while the response continues https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const { container, rerender } = render(
        <ReasoningBlock part={{ kind: "thought", text: "Ready", startedAtMs: 1000 }} isStreaming />
      );
      expect(screen.getByText("Thinking")).toBeTruthy();
      rerender(
        <ReasoningBlock
          part={{ kind: "thought", text: "Ready", startedAtMs: 1000, durationMs: 2000 }}
          isStreaming
        />
      );
      expect(screen.getByText("Thought for")).toBeTruthy();
      expect(screen.getByText("2.0s")).toBeTruthy();
      expect(container.querySelector(".scribe-shimmer-text")).toBeNull();
    });

    it("previews the latest live thought line and streams the complete original text when expanded https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const first = "第一段  保留空格。\n\n正在检查";
      const { rerender } = render(
        <ReasoningBlock part={{ kind: "thought", text: first }} isStreaming />
      );
      expect(screen.getByText("Thinking")).toBeTruthy();
      expect(screen.getByText("正在检查")).toBeTruthy();
      expect(screen.queryByText(first)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Thinking/ }));
      expect(screen.getByText(first, { exact: true, normalizer: (value) => value })).toBeTruthy();
      const next = first + "模型返回的新增内容。";
      rerender(<ReasoningBlock part={{ kind: "thought", text: next }} isStreaming />);
      expect(screen.getByText(next, { exact: true, normalizer: (value) => value })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Thinking/ }).getAttribute("aria-expanded")).toBe(
        "true"
      );
    });

    it("renders the event-backed duration after remount", () => {
      render(
        <ReasoningBlock
          part={{
            kind: "thought",
            text: "Compare the grouped steps.",
            startedAtMs: 1_000,
            durationMs: 18_426,
          }}
          isStreaming={false}
        />
      );

      expect(screen.getByText("Thought for")).toBeTruthy();
      expect(screen.getByText("18.4s")).toBeTruthy();
    });

    it("reports unavailable timing for legacy completed thoughts https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      render(
        <ReasoningBlock
          part={{ kind: "thought", text: "A restored thought without timing." }}
          isStreaming={false}
        />
      );

      expect(screen.getByText("Duration unavailable")).toBeTruthy();
    });
  });
});
