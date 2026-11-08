import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppContext } from "@/context";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import type { AgentMessagePart, TurnFileChange } from "@/agentMode/session/types";
import { excalidrawToolCall } from "@/excalidraw/agentMode/testing/excalidrawToolCall";
import { AgentTasksProvider } from "@/agentMode/ui/AgentTasksContext";
import { makeCommandTask, makeTask } from "@/agentMode/ui/testing/taskFixtures";
import { setInterfaceLocale } from "@/lib/i18n";

jest.mock("@/agentMode/ui/AgentMarkdownText", () => ({
  AgentMarkdownText: ({ text }: { text: string }) => <div data-testid="agent-md">{text}</div>,
}));

jest.mock("@/utils", () => ({
  cleanMessageForCopy: (s: string) => s.trim(),
  insertAtCursor: jest.fn(),
}));

jest.mock("obsidian", () => {
  class MarkdownView {}
  return {
    Keymap: jest.requireActual<typeof import("obsidian")>("obsidian").Keymap,
    MarkdownView,
    Component: class {
      load() {}
      unload() {}
      register() {}
    },
    App: class {},
    FileSystemAdapter: class {},
    WorkspaceLeaf: class {},
    Notice: class {},
    Platform: { isMobile: false },
  };
});

const { insertAtCursor } = jest.requireMock<{ insertAtCursor: jest.Mock }>("@/utils");

const text = (value: string): AgentMessagePart => ({ kind: "text", text: value });

function makeApp() {
  return { workspace: { getActiveFile: jest.fn(() => null) } } as never;
}

type TrailProps = Partial<React.ComponentProps<typeof AgentTrail>>;
type TrailApp = React.ComponentProps<typeof AgentTrail>["app"];

function trailElement(app: TrailApp, props: TrailProps) {
  return (
    <AppContext.Provider value={app}>
      <TooltipProvider>
        <AgentTrail
          parts={[text("The final answer.  ")]}
          isStreaming={false}
          turnStopReason="end_turn"
          app={app}
          {...props}
        />
      </TooltipProvider>
    </AppContext.Provider>
  );
}

function renderTrail(props: TrailProps = {}) {
  const app = props.app ?? makeApp();
  const result = render(trailElement(app, props));
  return {
    ...result,
    app,
    rerenderTrail: (next: TrailProps) => result.rerender(trailElement(app, next)),
  };
}

type ToolCallPart = Extract<AgentMessagePart, { kind: "tool_call" }>;

function toolCall(id: string, overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return { kind: "tool_call", id, title: id, status: "completed", ...overrides };
}

const READ_A = toolCall("r1", {
  vendorToolName: "Read",
  locations: [{ path: "notes/a.md" }],
  output: [{ type: "text", text: "Notes A content" }],
});
const READ_B = toolCall("r2", {
  vendorToolName: "Read",
  locations: [{ path: "notes/b.md" }],
  output: [{ type: "text", text: "Notes B content" }],
});
const LINT = toolCall("b1", {
  vendorToolName: "Bash",
  input: { command: "npm run lint" },
});

describe("AgentTrail", () => {
  let writeText: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
    writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("keeps each process card directly visible and its details folded before, during, and after a reply", () => {
    const read = { ...READ_A, output: [{ type: "text" as const, text: "First file contents" }] };
    const parts: AgentMessagePart[] = [
      text("Before tools"),
      read,
      LINT,
      text("Between tools"),
      READ_B,
      { kind: "thought", text: "Internal reasoning", durationMs: 2_000 },
      text("Final response"),
    ];
    const { container, rerenderTrail } = renderTrail({
      parts,
      isStreaming: true,
      turnStopReason: undefined,
    });
    const visibleOrder = () =>
      [
        ...container.querySelectorAll(
          '[data-testid="agent-md"], [data-agent-activity-card-header]'
        ),
      ].map((element) => element.textContent);
    const initialOrder = visibleOrder();
    expect(initialOrder).toEqual([
      "Before tools",
      "Readnotes/a.md",
      "Ran `npm run lint`",
      "Between tools",
      "Readnotes/b.md",
      "Thought for2s",
      "Final response",
    ]);
    expect(screen.queryByText("First file contents")).toBeNull();
    expect(screen.queryByText("Internal reasoning")).toBeNull();
    expect(screen.queryByText(/Ran 3 commands/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Read notes\/a.md/ }));
    expect(screen.getByText("First file contents")).toBeTruthy();
    rerenderTrail({ parts, isStreaming: false, turnStopReason: "end_turn", turnDurationMs: 2_000 });
    expect(visibleOrder()).toEqual(initialOrder);
    expect(screen.getByText("First file contents")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Read notes\/a.md/ }));
    expect(screen.queryByText("First file contents")).toBeNull();
  });

  it("defaults a tool to collapsed and preserves its manual expansion after the reply ends", () => {
    const parts = [{ ...READ_A, output: [{ type: "text" as const, text: "Tool details" }] }];
    const { rerenderTrail } = renderTrail({ parts, isStreaming: true, turnStopReason: undefined });
    expect(screen.queryByText("Tool details")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Read notes\/a.md/ }));
    expect(screen.getByText("Tool details")).toBeTruthy();
    rerenderTrail({ parts, isStreaming: false, turnStopReason: "end_turn" });
    expect(screen.getByText("Tool details")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Read notes\/a.md/ }));
    expect(screen.queryByText("Tool details")).toBeNull();
  });

  it("defaults reasoning to collapsed and respects manual choices through reply completion", () => {
    const parts: AgentMessagePart[] = [
      { kind: "thought", text: "Detailed thought", durationMs: 2_000 },
    ];
    const { rerenderTrail } = renderTrail({ parts, isStreaming: true, turnStopReason: undefined });
    expect(screen.queryByText("Detailed thought")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Thought for/ }));
    expect(screen.getByText("Detailed thought")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Thought for/ }));
    expect(screen.queryByText("Detailed thought")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Thought for/ }));
    rerenderTrail({ parts, isStreaming: false, turnStopReason: "end_turn" });
    expect(screen.getByText("Detailed thought")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Thought for/ }));
    expect(screen.queryByText("Detailed thought")).toBeNull();
  });

  it("keeps a plain response visible and retains the running timer animation", () => {
    const { container, rerenderTrail } = renderTrail({
      parts: [text("Plain response")],
      isStreaming: true,
      turnStopReason: undefined,
      turnStartedAtMs: Date.now() - 2_000,
    });
    expect(screen.getByText("Plain response")).toBeTruthy();
    expect(container.querySelector(".scribe-spinner-dot-0")).toBeTruthy();
    rerenderTrail({
      parts: [text("Plain response")],
      isStreaming: false,
      turnStopReason: "end_turn",
      turnDurationMs: 2_000,
    });
    expect(screen.getByText("Plain response")).toBeTruthy();
    expect(container.querySelector(".scribe-spinner-dot-0")).toBeNull();
  });

  it("keeps each running tool independently closed when later tools arrive", () => {
    const { rerenderTrail } = renderTrail({
      parts: [READ_A, LINT],
      isStreaming: true,
      turnStopReason: undefined,
    });
    const read = screen.getByRole("button", { name: /Read notes\/a.md/ });
    fireEvent.click(read);
    fireEvent.click(read);
    rerenderTrail({ parts: [READ_A, LINT, READ_B], isStreaming: true, turnStopReason: undefined });
    expect(
      screen.getByRole("button", { name: /Read notes\/a.md/ }).getAttribute("aria-expanded")
    ).toBe("false");
    expect(screen.getByRole("link", { name: "notes/b.md" })).toBeTruthy();
  });

  it("keeps a legacy subagent's manually opened prompt visible when the main reply finishes", () => {
    const parts: AgentMessagePart[] = [
      toolCall("nested-task", {
        vendorToolName: "Task",
        input: {
          subagent_type: "Explore",
          description: "Nested work",
          prompt: "Private task prompt",
        },
      }),
      { ...READ_A, parentToolCallId: "nested-task" },
      { ...LINT, parentToolCallId: "nested-task" },
    ];
    const { rerenderTrail } = renderTrail({ parts, isStreaming: true, turnStopReason: undefined });
    const header = screen.getByRole("button", { name: /Explore.*Nested work/ });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(header);
    expect(
      screen.getByRole("button", { name: /Read notes\/a.md/ }).getAttribute("aria-expanded")
    ).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
    expect(screen.getByText("Private task prompt")).toBeTruthy();
    rerenderTrail({ parts, isStreaming: false, turnStopReason: "end_turn" });
    expect(
      screen.getByRole("button", { name: /Explore.*Nested work/ }).getAttribute("aria-expanded")
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: /Read notes\/a.md/ }).getAttribute("aria-expanded")
    ).toBe("false");
    expect(screen.getByText("Private task prompt")).toBeTruthy();
  });

  it("shows a non-collapsible completed duration before the first process card and keeps the footer timestamp", () => {
    renderTrail({
      parts: [READ_A, READ_B, text("Answer")],
      turnDurationMs: 12_000,
      timestamp: "2026/10/31 21:00:00",
    });
    const duration = screen.getByText("Worked for");
    expect(screen.getByText("12s")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Worked for/ })).toBeNull();
    expect(
      duration.compareDocumentPosition(screen.getByRole("button", { name: /Read notes\/a.md/ })) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByText("2026/10/31 21:00:00")).toBeTruthy();
  });

  it("offers a fork next to insert for a completed reply and calls the supplied action", () => {
    const onFork = jest.fn();
    renderTrail({ onFork });
    fireEvent.click(screen.getByTitle("Fork conversation"));
    expect(onFork).toHaveBeenCalledTimes(1);
  });

  it("renders both buttons under a completed message and wires each to the cleaned final text", async () => {
    const { app } = renderTrail();

    expect(screen.getByTitle("Copy")).toBeTruthy();
    expect(screen.getByTitle("Insert / Replace at cursor")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Copy"));
      await writeText.mock.results[0].value;
    });
    expect(writeText).toHaveBeenCalledWith("The final answer.");

    fireEvent.click(screen.getByTitle("Insert / Replace at cursor"));
    expect(insertAtCursor).toHaveBeenCalledWith(app, "The final answer.");
  });

  const EDITED_NOTE: TurnFileChange = {
    path: "notes/diff-demo/alpha.md",
    status: "modified",
    before: "before",
    after: "after",
    additions: 3,
    deletions: 1,
  };

  it("shows the one file a finished turn changed as a single unheaded card", () => {
    renderTrail({ fileChanges: [EDITED_NOTE] });

    expect(screen.queryByText(/Files changed/)).toBeNull();
    expect(screen.getByRole("button", { name: /alpha\.md/ })).toBeTruthy();
  });

  it("lists the files under a Files changed header when a finished turn changed several", () => {
    renderTrail({
      fileChanges: [EDITED_NOTE, { ...EDITED_NOTE, path: "notes/diff-demo/beta.md" }],
    });

    expect(screen.getByText("Files changed (2)")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /\.md/ })).toHaveLength(2);
  });

  it("hands the clicked file to the caller so it can open the diff", () => {
    const onOpenFileChange = jest.fn();
    renderTrail({ fileChanges: [EDITED_NOTE], onOpenFileChange });

    fireEvent.click(screen.getByRole("button", { name: /alpha\.md/ }));

    expect(onOpenFileChange).toHaveBeenCalledWith(EDITED_NOTE);
  });

  it("withholds the changed-files card until the turn has stopped", () => {
    renderTrail({ isStreaming: true, turnStopReason: undefined, fileChanges: [EDITED_NOTE] });

    expect(screen.queryByText(/Files changed/)).toBeNull();
  });

  it("shows no changed-files card when the turn changed nothing", () => {
    renderTrail({ fileChanges: [] });
    expect(screen.queryByText(/Files changed/)).toBeNull();

    renderTrail({ fileChanges: undefined });
    expect(screen.queryByText(/Files changed/)).toBeNull();
  });

  it("renders neither button while the message is still streaming", () => {
    renderTrail({ isStreaming: true, turnStopReason: undefined });
    expect(screen.queryByTitle("Copy")).toBeNull();
    expect(screen.queryByTitle("Insert / Replace at cursor")).toBeNull();
  });

  it("shows the running duration instead of the timestamp while streaming", () => {
    renderTrail({
      isStreaming: true,
      turnStopReason: undefined,
      turnStartedAtMs: Date.now() - 24_000,
      timestamp: "2026/08/07 20:31:10",
    });

    expect(screen.getByText("Worked for")).toBeTruthy();
    expect(screen.queryByText("2026/08/07 20:31:10")).toBeNull();
  });

  it("renders neither button when the turn was cancelled", () => {
    renderTrail({ turnStopReason: "cancelled", timestamp: "2026/08/07 20:31:10" });
    expect(screen.queryByTitle("Copy")).toBeNull();
    expect(screen.queryByTitle("Insert / Replace at cursor")).toBeNull();
    expect(screen.getByText("2026/08/07 20:31:10")).toBeTruthy();
  });

  it("renders neither button when the turn produced no trailing prose", () => {
    renderTrail({ parts: [{ kind: "tool_call", id: "t1", title: "Read", status: "completed" }] });
    expect(screen.queryByTitle("Copy")).toBeNull();
    expect(screen.queryByTitle("Insert / Replace at cursor")).toBeNull();
  });

  it("shows the timestamp with response controls when a completed duration is unavailable", () => {
    renderTrail({ timestamp: "2026/08/07 20:31:10" });

    expect(screen.getByText("2026/08/07 20:31:10")).toBeTruthy();
    expect(screen.getByTitle("Copy")).toBeTruthy();
    expect(screen.queryByText("Worked for")).toBeNull();
  });

  it("keeps research inline while showing a non-collapsible completed duration", () => {
    renderTrail({
      parts: [
        { kind: "tool_call", id: "t1", title: "Search vault", status: "completed" },
        text("The final answer."),
      ],
      turnStopReason: "end_turn",
      turnDurationMs: 138_000,
      timestamp: "2026/08/07 20:31:10",
    });

    expect(screen.getByText("Worked for")).toBeTruthy();
    expect(screen.getByText("2m 18s")).toBeTruthy();
    expect(screen.getByText("2026/08/07 20:31:10")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Worked for/i })).toBeNull();
    expect(screen.getByText("Worked for").closest(".tw-justify-between")).toBeNull();
    const footer = screen.getByText("2026/08/07 20:31:10").closest(".tw-justify-between");
    expect(footer?.contains(screen.getByTitle("Copy"))).toBe(true);
    expect(footer?.contains(screen.getByTitle("Insert / Replace at cursor"))).toBe(true);
    expect(screen.getByText("The final answer.")).toBeTruthy();
    expect(screen.getByText("Search vault")).toBeTruthy();
  });

  const compaction = (
    overrides: Partial<Extract<AgentMessagePart, { kind: "compaction" }>> = {}
  ): AgentMessagePart => ({
    kind: "compaction",
    id: "c1",
    status: "completed",
    trigger: "manual",
    startedAtMs: 0,
    ...overrides,
  });

  it("renders a compaction row in line with the surrounding answer", () => {
    renderTrail({ parts: [text("Before."), compaction(), text("After.")] });

    expect(screen.getByText("Context compacted")).toBeTruthy();
    expect(screen.getAllByTestId("agent-md").map((el) => el.textContent)).toEqual([
      "Before.",
      "After.",
    ]);
  });

  it("keeps the Worked for line and copy actions on a reply that also holds an answer", () => {
    renderTrail({
      parts: [compaction({ trigger: "auto" }), text("The final answer.")],
      turnDurationMs: 138_000,
    });

    expect(screen.getByText("Worked for")).toBeTruthy();
    expect(screen.getByTitle("Copy")).toBeTruthy();
  });

  it.each([
    { scenario: "only a compaction", parts: [compaction()] },
    {
      scenario: "a compaction beside a hidden ToolSearch call and blank text",
      parts: [
        compaction(),
        {
          kind: "tool_call",
          id: "ts1",
          title: "ToolSearch",
          status: "completed",
          vendorToolName: "ToolSearch",
        },
        text("  "),
      ] satisfies AgentMessagePart[],
    },
  ])(
    "hides Worked for and the copy action on a completed reply that renders $scenario",
    ({ parts }) => {
      renderTrail({
        parts,
        turnDurationMs: 138_000,
        timestamp: "2026/08/07 20:31:10",
      });

      expect(screen.getByText("Context compacted")).toBeTruthy();
      expect(screen.queryByText("Worked for")).toBeNull();
      expect(screen.queryByTitle("Copy")).toBeNull();
      expect(screen.queryByText("2026/08/07 20:31:10")).toBeNull();
    }
  );

  it("restores Worked for and the copy action once an answer streams into the same parts list after a compaction", () => {
    const parts: AgentMessagePart[] = [compaction({ trigger: "auto" })];
    const { rerenderTrail } = renderTrail({ parts, turnDurationMs: 138_000 });
    expect(screen.queryByTitle("Copy")).toBeNull();

    parts.push(text("The final answer."));
    rerenderTrail({ parts, turnDurationMs: 138_000 });

    expect(screen.getByText("Worked for")).toBeTruthy();
    expect(screen.getByTitle("Copy")).toBeTruthy();
  });

  it("shows only the compaction's own elapsed time while a compaction-only reply is running", () => {
    renderTrail({
      parts: [compaction({ status: "in_progress", startedAtMs: Date.now() - 5_000 })],
      isStreaming: true,
      turnStopReason: undefined,
      turnStartedAtMs: Date.now() - 5_000,
    });

    expect(screen.getByRole("status").textContent).toBe("Compacting conversation…");
    expect(screen.queryByText("Worked for")).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it.each([
    { trigger: "manual" as const, label: "正在压缩对话…" },
    { trigger: "auto" as const, label: "上下文已满，正在压缩…" },
  ])("shows the running $trigger compaction in Chinese", ({ trigger, label }) => {
    setInterfaceLocale("zh-CN");
    try {
      renderTrail({
        parts: [compaction({ status: "in_progress", trigger, startedAtMs: Date.now() - 5_000 })],
        isStreaming: true,
        turnStopReason: undefined,
      });

      expect(screen.getByRole("status").textContent).toBe(label);
      expect(screen.getAllByText(label)).toHaveLength(2);
    } finally {
      setInterfaceLocale("en");
    }
  });

  it("shows a failed turn's error under a reply that holds parts but no answer text", () => {
    renderTrail({
      parts: [compaction()],
      errorText: "**Error:** stream error",
      turnDurationMs: 4_000,
    });

    expect(screen.getByText("Context compacted")).toBeTruthy();
    expect(screen.getByTestId("agent-md").textContent).toBe("**Error:** stream error");
  });

  it.each([
    [
      "quota_exhausted",
      "**Service quota exhausted.** This is an account limit, not a code problem. Add quota or reopen the chat, then send another message to continue.",
    ],
    [
      "authentication_error",
      "**Authentication failed.** Check the provider credentials in Models, then send another message to continue.",
    ],
    [
      "context_limit",
      "**Context limit reached.** Context could not be compacted safely. Your conversation is preserved; shorten the request or choose a model with a larger context window.",
    ],
    [
      "request_error",
      "**Model request failed.** Check the provider connection and settings, then send another message to retry.",
    ],
  ] as const)(
    "shows the %s termination separately from answer text (https://github.com/ItsDalk-Lane/Scribe/issues/31)",
    (turnStopReason, notice) => {
      renderTrail({ parts: [text("Work already completed.")], turnStopReason });
      expect(screen.getByText(notice)).toBeTruthy();
      expect(screen.getAllByText("Work already completed.")).toHaveLength(1);
    }
  );

  it("shows a partial reply once followed by its separate failure reason", () => {
    renderTrail({
      parts: [text("Partial answer."), compaction()],
      errorText: "**Error:** stream error",
    });

    expect(screen.getAllByTestId("agent-md").map((el) => el.textContent)).toEqual([
      "Partial answer.",
      "**Error:** stream error",
    ]);
  });

  it("says the turn stopped at the output limit under a reply that already has answer text, rendering the answer once", () => {
    renderTrail({
      parts: [
        text("I'll load the meeting note skill first."),
        toolCall("w1", { status: "failed" }),
      ],
      turnStopReason: "max_tokens",
    });

    expect(screen.getAllByTestId("agent-md").map((el) => el.textContent)).toEqual([
      "I'll load the meeting note skill first.",
      "**Stopped early:** the model hit its output limit, so its last step may not have run. Send another message to continue.",
    ]);
  });

  it("says why the turn stopped at the agent's step limit or a safety stop", () => {
    const { rerenderTrail } = renderTrail({ turnStopReason: "max_turn_requests" });
    expect(screen.getAllByTestId("agent-md")[1].textContent).toBe(
      "**Step limit reached.** The agent has ended this turn. Review its summary and send another message to continue."
    );

    rerenderTrail({ turnStopReason: "refusal" });
    expect(screen.getAllByTestId("agent-md")[1].textContent).toBe(
      "**Stopped early:** the model's safety system stopped it, so its last step may not have run. Send another message to continue."
    );
  });

  it("explains the shared task budget without promising that saved progress was lost https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
    renderTrail({ turnStopReason: "max_task_requests" });
    expect(screen.getAllByTestId("agent-md")[1].textContent).toContain(
      "Task request limit reached"
    );
    expect(screen.getAllByTestId("agent-md")[1].textContent).toContain(
      "Saved progress is preserved"
    );
  });

  it("shows a distinct notice for user cancellation and none for a normal reply (https://github.com/ItsDalk-Lane/Scribe/issues/31)", () => {
    const { rerenderTrail } = renderTrail({ turnStopReason: "end_turn" });
    expect(screen.getAllByTestId("agent-md")).toHaveLength(1);

    rerenderTrail({ turnStopReason: "cancelled" });
    expect(
      screen.getByText("**Cancelled by you.** Send another message when you want to continue.")
    ).toBeTruthy();
  });

  it("uses one aligned folding header for reasoning and every tool-card family", () => {
    const { container } = renderTrail({
      parts: [
        { kind: "thought", text: "Inspect the trail first." },
        text("Reasoning complete."),
        { ...READ_A, output: [{ type: "text", text: "file contents" }] },
        text("Single tool complete."),
        READ_B,
        LINT,
        text("Grouped tools complete."),
        toolCall("task1", {
          vendorToolName: "Task",
          input: { subagent_type: "Explore", description: "Check nested cards" },
        }),
        { ...READ_A, id: "nested-read", parentToolCallId: "task1" },
      ],
    });

    const headers = [...container.querySelectorAll("[data-agent-activity-card-header]")];
    expect(headers).toHaveLength(5);
    expect(headers.every((header) => header.classList.contains("tw-pl-1"))).toBe(true);
    expect(headers.every((header) => header.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(container.querySelectorAll(".lucide-chevron-right")).toHaveLength(5);
  });

  it("shows progress on a childless background subagent card", () => {
    renderTrail({
      parts: [
        {
          kind: "tool_call",
          id: "launch",
          title: "Agent",
          vendorToolName: "Agent",
          status: "in_progress",
          input: { subagent_type: "Explore", description: "Analyze notes" },
          progress: {
            description: "Running Count markdown files",
            toolUses: 3,
            durationMs: 9851,
          },
        },
      ],
      isStreaming: true,
      turnStopReason: undefined,
    });

    expect(screen.getByText("Running Count markdown files · 3 tools · 9s")).toBeTruthy();
  });
  const STREAMING_PARTS: AgentMessagePart[] = [
    READ_A,
    { kind: "thought", text: "still mulling it over" },
    text("Halfway there."),
    READ_B,
    { ...LINT, status: "in_progress" },
  ];

  it("shows the running command status directly while completed reasoning remains quiet", () => {
    renderTrail({ parts: STREAMING_PARTS, isStreaming: true, turnStopReason: undefined });

    expect(screen.getByText("Running `npm run lint`")).toBeTruthy();
    expect(screen.queryByText("Reasoning")).toBeNull();
  });

  it("shows active reasoning directly beside a completed tool while its content stays folded", () => {
    renderTrail({
      parts: [READ_A, { kind: "thought", text: "still mulling it over" }],
      isStreaming: true,
      turnStopReason: undefined,
    });
    expect(screen.getByText("Reasoning")).toBeTruthy();
    expect(screen.queryByText("still mulling it over")).toBeNull();
    expect(screen.queryByText("Thought for")).toBeNull();
  });

  it("does not restart a frozen thought when a hidden tool trails it", () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(30_000);
      renderTrail({
        parts: [
          READ_A,
          {
            kind: "thought",
            text: "Finished reasoning",
            startedAtMs: 12_000,
            durationMs: 18_000,
          },
          toolCall("hidden", { vendorToolName: "ToolSearch", status: "in_progress" }),
        ],
        isStreaming: true,
        turnStopReason: undefined,
      });

      expect(screen.getByText("Thought for")).toBeTruthy();
      expect(screen.getByText("18s")).toBeTruthy();
      expect(screen.queryByText("Reasoning")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("renders a frozen standalone trailing thought as complete", () => {
    renderTrail({
      parts: [
        {
          kind: "plan",
          entries: [{ content: "Inspect the result", priority: "medium", status: "pending" }],
        },
        {
          kind: "thought",
          text: "Finished reasoning",
          startedAtMs: 12_000,
          durationMs: 18_000,
        },
      ],
      isStreaming: true,
      turnStopReason: undefined,
    });

    expect(screen.getByText("Thought for")).toBeTruthy();
    expect(screen.getByText("18s")).toBeTruthy();
    expect(screen.queryByText("Reasoning")).toBeNull();
  });

  it("keeps progress prose between its original individual process cards", () => {
    const { container } = renderTrail({
      parts: STREAMING_PARTS,
      isStreaming: true,
      turnStopReason: undefined,
    });
    const prose = screen.getByText("Halfway there.");
    expect(prose.getAttribute("data-testid")).toBe("agent-md");
    expect(
      screen.getByRole("button", { name: /Read notes\/a.md/ }).compareDocumentPosition(prose) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      prose.compareDocumentPosition(screen.getByRole("button", { name: /Read notes\/b.md/ })) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(container.querySelectorAll("[data-agent-activity-card-header]")).toHaveLength(4);
  });

  it("preserves a tool's manual expansion when more process cards arrive", () => {
    const read = { ...READ_A, output: [{ type: "text" as const, text: "file contents" }] };
    const { rerenderTrail } = renderTrail({
      parts: [read, LINT],
      isStreaming: true,
      turnStopReason: undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: /Read notes\/a.md/ }));
    rerenderTrail({ parts: [read, LINT, READ_B], isStreaming: true, turnStopReason: undefined });
    expect(
      screen.getByRole("button", { name: /Read notes\/a.md/ }).getAttribute("aria-expanded")
    ).toBe("true");
    expect(screen.getByText("file contents")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Read notes\/b.md/ }).getAttribute("aria-expanded")
    ).toBe("false");
  });

  it("shows a sub-agent's individual child steps inside its own card", () => {
    renderTrail({
      parts: [
        toolCall("task1", {
          vendorToolName: "Task",
          input: { subagent_type: "Explore", description: "Look around" },
        }),
        { ...READ_A, parentToolCallId: "task1" },
        { ...LINT, parentToolCallId: "task1" },
      ],
    });

    fireEvent.click(screen.getByText('Explore · "Look around"'));

    expect(screen.getByText("2 tools")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Read notes\/a.md/ })).toBeTruthy();
    expect(screen.getByText("Ran `npm run lint`")).toBeTruthy();
  });

  it("counts each call folded into a sub-agent's Excalidraw card as a tool", () => {
    const board = { path: "Boards/Launch board.excalidraw.md", operations: [] };
    renderTrail({
      parts: [
        toolCall("task1", {
          vendorToolName: "Task",
          input: { subagent_type: "Explore", description: "Draw it" },
        }),
        excalidrawToolCall("excalidraw_write", board, { id: "w1", parentToolCallId: "task1" }),
        excalidrawToolCall("excalidraw_render", board, { id: "r1", parentToolCallId: "task1" }),
      ],
    });

    fireEvent.click(screen.getByText('Explore · "Draw it"'));

    expect(screen.getByText("2 tools")).toBeTruthy();
  });

  it("preserves an opened tool when a second tool arrives without inserting a group wrapper", () => {
    const read = { ...READ_A, output: [{ type: "text" as const, text: "file contents" }] };
    const { rerenderTrail } = renderTrail({
      parts: [read],
      isStreaming: true,
      turnStopReason: undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: /Read notes\/a.md/ }));
    rerenderTrail({ parts: [read, LINT], isStreaming: true, turnStopReason: undefined });
    expect(screen.queryByText(/Ran 2 commands/)).toBeNull();
    expect(screen.getByText("file contents")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Read notes\/a.md/ }));
    expect(screen.queryByText("file contents")).toBeNull();
  });

  it("keeps a nested tool's expansion independent from a root tool", () => {
    renderTrail({
      parts: [
        { ...READ_A, output: [{ type: "text", text: "Root output" }] },
        LINT,
        toolCall("task1", {
          vendorToolName: "Task",
          input: { subagent_type: "Explore", description: "Look around" },
        }),
        { ...READ_B, parentToolCallId: "task1", output: [{ type: "text", text: "Child output" }] },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /Read notes\/a.md/ }));
    fireEvent.click(screen.getByText('Explore · "Look around"'));
    expect(screen.getByText("Root output")).toBeTruthy();
    expect(screen.queryByText("Child output")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Read notes\/b.md/ }));
    expect(screen.getByText("Root output")).toBeTruthy();
    expect(screen.getByText("Child output")).toBeTruthy();
  });

  it("keeps synthetic recovery warnings visible while completed process details are folded", () => {
    renderTrail({
      parts: [
        {
          ...READ_A,
          synthetic: true,
          status: "failed",
          output: [
            {
              type: "text",
              text: "Files may have changed. Check the actual files before retrying.",
            },
          ],
        },
        text("The saved reply remains visible."),
        LINT,
      ],
    });
    expect(screen.getByRole("alert").textContent).toContain("Files may have changed");
    expect(screen.getByText("Recovered after interruption")).toBeTruthy();
    expect(screen.getByText("The saved reply remains visible.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Read notes\/a.md/ }).getAttribute("aria-expanded")
    ).toBe("false");
  });

  it("identifies an interrupted reply as system recovery without claiming the user cancelled it", () => {
    renderTrail({
      parts: [text("The partial reply remains intact.")],
      turnStopReason: "interrupted",
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "System recovery: this reply was interrupted"
    );
    expect(screen.queryByText(/Cancelled by you/)).toBeNull();
    expect(screen.getByText("The partial reply remains intact.")).toBeTruthy();
  });

  it("shows root and nested command statuses directly within their owning cards", () => {
    renderTrail({
      parts: [
        toolCall("task1", {
          vendorToolName: "Task",
          input: { subagent_type: "Explore", description: "Look around" },
        }),
        { ...READ_A, parentToolCallId: "task1" },
        {
          ...toolCall("child-command", {
            vendorToolName: "Bash",
            status: "in_progress",
            input: { command: "npm run child" },
          }),
          parentToolCallId: "task1",
        },
        text("Moved on."),
        READ_B,
        toolCall("root-command", {
          vendorToolName: "Bash",
          status: "in_progress",
          input: { command: "npm run root" },
        }),
      ],
      isStreaming: true,
      turnStopReason: undefined,
    });

    fireEvent.click(screen.getByText('Explore · "Look around"'));

    expect(screen.getByText("Running `npm run child`")).toBeTruthy();
    expect(screen.getByText("Running `npm run root`")).toBeTruthy();
  });

  it("renders an Excalidraw write directly among process cards and opens the drawing in a new tab", () => {
    const openLinkText = jest.fn();
    const app = {
      workspace: { getActiveFile: jest.fn(() => null), openLinkText },
      vault: { getAbstractFileByPath: jest.fn(() => ({})) },
      metadataCache: { getFirstLinkpathDest: jest.fn(() => null) },
    } as never;
    const write = excalidrawToolCall("excalidraw_write", {
      path: "Drawings/Release plan.excalidraw.md",
      elements: [],
    });
    renderTrail({ app, parts: [READ_A, LINT, write, READ_B, LINT, text("Drew it.")] });

    expect(screen.getByText("Drew in Excalidraw")).toBeTruthy();
    expect(screen.getByText("Drew it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Release plan" }));
    expect(openLinkText).toHaveBeenCalledWith("Drawings/Release plan.excalidraw.md", "", "tab");
  });

  it("shows an agent's uninterrupted work on one drawing as one card whose steps include a failed write's error", () => {
    const board = { path: "Boards/Launch board.excalidraw.md", operations: [] };
    renderTrail({
      parts: [
        excalidrawToolCall("excalidraw_write", board, { id: "w1" }),
        excalidrawToolCall("excalidraw_render", board, { id: "render-1" }),
        excalidrawToolCall("excalidraw_write", board, {
          id: "w2",
          status: "failed",
          output: [{ type: "text", text: "INVALID_INPUT: Unsupported field" }],
        }),
        excalidrawToolCall("excalidraw_write", board, { id: "w3" }),
        READ_A,
        text("Updated the board."),
      ],
    });

    expect(screen.getAllByText("Edited in Excalidraw")).toHaveLength(1);
    expect(screen.getByText("1 failed")).toBeTruthy();
    expect(screen.queryByText(/Unsupported field/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show Excalidraw steps" }));
    fireEvent.click(screen.getAllByText(/Excalidraw write/)[1]);

    expect(screen.getByText(/Unsupported field/)).toBeTruthy();
  });

  it("keeps separate drawing cards on each side of a normal tool so later drawing steps do not move earlier", () => {
    const board = { path: "Boards/Launch board.excalidraw.md", operations: [] };
    renderTrail({
      parts: [
        excalidrawToolCall("excalidraw_write", board, { id: "draw-before" }),
        READ_A,
        excalidrawToolCall("excalidraw_write", board, { id: "draw-after" }),
      ],
    });
    expect(screen.getAllByText("Edited in Excalidraw")).toHaveLength(2);
    const [before, after] = screen.getAllByText("Edited in Excalidraw");
    const read = screen.getByRole("button", { name: /Read notes\/a.md/ });
    expect(before.compareDocumentPosition(read) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(read.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  describe("with task state from the session", () => {
    const AGENT_LAUNCH = toolCall("call-1", {
      vendorToolName: "Agent",
      status: "in_progress",
      input: { description: "Count words in Welcome", subagent_type: "general-purpose" },
    });
    const BASH_LAUNCH = toolCall("call-2", {
      vendorToolName: "Bash",
      status: "in_progress",
      input: { command: "for i in $(seq 1 30); do echo $i; done" },
    });

    function renderWithTasks(parts: AgentMessagePart[], tasks = [makeTask(), makeCommandTask()]) {
      const openTask = jest.fn();
      const app = makeApp();
      render(
        <AppContext.Provider value={app}>
          <TooltipProvider>
            <AgentTasksProvider tasks={tasks} openTask={openTask}>
              <AgentTrail parts={parts} isStreaming={false} turnStopReason="end_turn" app={app} />
            </AgentTasksProvider>
          </TooltipProvider>
        </AppContext.Provider>
      );
      return { openTask };
    }

    it("shows a task's launching call as a compact card with the task's status that opens the task", () => {
      const { openTask } = renderWithTasks([AGENT_LAUNCH, text("Started.")]);

      expect(screen.getByText("general-purpose · Count words in Welcome")).toBeTruthy();
      expect(screen.getByText("Running")).toBeTruthy();
      expect(screen.queryByText(/Sub-agent/)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /Count words in Welcome/ }));

      expect(openTask).toHaveBeenCalledWith("call-1");
    });

    it("keeps a background command's card out of the surrounding command group", () => {
      renderWithTasks([READ_A, BASH_LAUNCH, LINT, text("Started.")]);

      expect(screen.getByText("Print 30 progress lines")).toBeTruthy();
      expect(screen.queryByText(/Ran 2 commands/)).toBeNull();
    });

    it("renders a launching call that has no task as before", () => {
      renderWithTasks([AGENT_LAUNCH, text("Started.")], []);

      expect(screen.getByText('general-purpose · "Count words in Welcome"')).toBeTruthy();
    });
  });
});
