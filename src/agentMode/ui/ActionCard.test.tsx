import { ActionCard } from "@/agentMode/ui/ActionCard";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { openVaultPath } from "@/utils/openVaultPath";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/context", () => ({ useApp: jest.fn().mockReturnValue({}) }));
jest.mock("@/utils/openVaultPath", () => ({
  ...jest.requireActual("@/utils/openVaultPath"),
  openVaultPath: jest.fn(),
}));

function readTool(overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    kind: "tool_call",
    id: "read-1",
    title: "Read notes/today.md",
    vendorToolName: "Read",
    input: { file_path: "notes/today.md" },
    status: "completed",
    ...overrides,
  };
}

describe("ActionCard", () => {
  describe("ActionCard", () => {
    it("keeps dedicated diff text outside Markdown interpretation https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const { container } = render(
        <ActionCard
          part={readTool({
            output: [{ type: "diff", path: "note.md", oldText: "old line", newText: "new line" }],
          })}
          open
          onToggle={jest.fn()}
        />
      );
      expect(
        Array.from(container.querySelectorAll("pre")).some(
          (element) => element.textContent === "- old line\n+ new line"
        )
      ).toBe(true);
    });
    it("shows separate complete input and output sections without changing the raw JSON integer https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      render(
        <ActionCard
          part={readTool({
            input: '{"id":900719925474099312345}',
            output: [{ type: "text", text: "line one\nline two" }],
          })}
          open
          onToggle={jest.fn()}
        />
      );
      expect(screen.getByRole("region", { name: "Input" }).textContent).toContain(
        "900719925474099312345"
      );
      expect(screen.getByRole("region", { name: "Output" }).textContent).toContain(
        "line one\nline two"
      );
    });
    it("animates only an executing title and keeps waiting and ended states static https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const { rerender, container } = render(
        <ActionCard part={readTool({ status: "in_progress" })} open={false} onToggle={jest.fn()} />
      );
      expect(container.querySelector(".scribe-shimmer-text")).not.toBeNull();
      for (const status of ["pending", "completed", "failed", "cancelled"] as const) {
        rerender(<ActionCard part={readTool({ status })} open={false} onToggle={jest.fn()} />);
        expect(container.querySelector(".scribe-shimmer-text")).toBeNull();
      }
    });
    it.each([undefined, "research-child"])(
      "uses the actual running file-search title in the main or child trace: %s https://github.com/ItsDalk-Lane/Scribe/issues/52",
      (parentToolCallId) => {
        const { container } = render(
          <ActionCard
            part={readTool({
              vendorToolName: "search_content",
              status: "in_progress",
              parentToolCallId,
              input: { query: "meeting" },
            })}
            open={false}
            onToggle={jest.fn()}
          />
        );
        expect(container.querySelector(".scribe-shimmer-text")?.textContent).toBe(
          'Searching files · "meeting"'
        );
      }
    );
    it("links only the file path of a completed read, keeping the verb as plain text", () => {
      render(<ActionCard part={readTool()} open={false} onToggle={jest.fn()} />);

      const link = screen.getByRole("link");
      expect(link.textContent).toBe("notes/today.md");
      expect(screen.getByText("Read").closest("a")).toBeNull();

      fireEvent.click(link);
      expect(openVaultPath).toHaveBeenCalledWith({}, "notes/today.md", { pane: false });
    });

    it("renders a denied edit as Didn't edit with no file link", () => {
      render(
        <ActionCard
          part={readTool({
            vendorToolName: "Edit",
            title: "Edit plan.md",
            input: { file_path: "plan.md" },
            status: "failed",
          })}
          open={false}
          onToggle={jest.fn()}
        />
      );

      expect(screen.getByText("Didn't edit plan.md")).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("renders a stopped command in the past tense with a stop mark, and a stopped edit as Didn't edit", () => {
      const { container } = render(
        <ActionCard
          part={readTool({
            id: "bash",
            vendorToolName: "Bash",
            title: "Run sleep",
            input: { command: "sleep 9" },
            status: "cancelled",
          })}
          open={false}
          onToggle={jest.fn()}
        />
      );
      render(
        <ActionCard
          part={readTool({
            vendorToolName: "Edit",
            title: "Edit plan.md",
            input: { file_path: "plan.md" },
            status: "cancelled",
          })}
          open={false}
          onToggle={jest.fn()}
        />
      );

      expect(container.textContent).toMatch(/^Ran /);
      expect(container.querySelector(".lucide-circle-stop")).toBeTruthy();
      expect(container.querySelector(".tw-animate-spin")).toBeNull();
      expect(screen.getByText("Didn't edit plan.md")).toBeTruthy();
    });

    it("renders an in-progress read as plain text without a link", () => {
      render(
        <ActionCard part={readTool({ status: "in_progress" })} open={false} onToggle={jest.fn()} />
      );

      expect(screen.getByText("Reading files notes/today.md")).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    });
  });
});
