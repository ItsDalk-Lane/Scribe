import type { AgentChatMessage } from "@/agentMode/session/types";
import { TaskOutputReaderContext } from "@/agentMode/ui/hooks/useTaskOutputTail";
import { COMMAND_OUTPUT_MAX_BYTES, TaskDetailView } from "@/agentMode/ui/TaskDetailView";
import { makeCommandTask, makeTask, textOutputReader } from "@/agentMode/ui/testing/taskFixtures";
import { AppContext } from "@/context";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { openTurnDiff } from "@/agentMode/ui/TurnDiffView";
import React from "react";

jest.mock("@/components/chat-components/ChatSingleMessage", () => ({
  __esModule: true,
  default: ({ message }: { message: { sender: string; message: string } }) => (
    <div data-testid={`message-${message.sender}`}>{message.message}</div>
  ),
}));

jest.mock("@/agentMode/ui/AgentTrailView", () => ({
  AgentTrail: ({
    parts,
    isStreaming,
    messageId,
    sourcePath,
  }: {
    parts: Array<{ kind: string; title?: string; text?: string }>;
    isStreaming: boolean;
    messageId?: string;
    sourcePath?: string;
  }) => (
    <div
      data-testid="trail"
      data-streaming={String(isStreaming)}
      data-message-id={messageId}
      data-source-path={sourcePath}
    >
      {parts.map((p) => p.title ?? p.text).join(" | ")}
    </div>
  ),
}));

jest.mock("@/agentMode/ui/TurnDiffView", () => ({
  openTurnDiff: jest.fn(() => Promise.resolve()),
}));

const OUTPUT = "/tmp/tasks/task-2.output";

const SUBAGENT_MESSAGES: AgentChatMessage[] = [
  {
    id: "m1",
    sender: "ai",
    timestamp: null,
    isVisible: true,
    message: "",
    parts: [
      { kind: "tool_call", id: "t1", title: "Bash: wc -w Welcome.md", status: "completed" },
      { kind: "text", text: "Welcome.md has 9 words." },
    ],
  },
];

function renderDetail(
  props: Partial<React.ComponentProps<typeof TaskDetailView>>,
  files: Record<string, string> = {}
) {
  const onBack = jest.fn();
  const app = {} as never;
  render(
    <AppContext.Provider value={app}>
      <TaskOutputReaderContext.Provider value={textOutputReader(files)}>
        <TaskDetailView task={makeTask()} messages={[]} app={app} onBack={onBack} {...props} />
      </TaskOutputReaderContext.Provider>
    </AppContext.Provider>
  );
  return { onBack };
}

const resizeCallbacks: ResizeObserverCallback[] = [];

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function contentResized() {
  act(() => resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)));
}

function fakeScrollGeometry(el: HTMLElement) {
  const geometry = { scrollHeight: 200, clientHeight: 100, scrollTop: 100 };
  Object.defineProperties(el, {
    scrollHeight: { get: () => geometry.scrollHeight },
    clientHeight: { get: () => geometry.clientHeight },
    scrollTop: {
      get: () => geometry.scrollTop,
      set: (value: number) => {
        geometry.scrollTop = Math.min(value, geometry.scrollHeight - geometry.clientHeight);
      },
    },
  });
  return geometry;
}

describe("TaskDetailView", () => {
  beforeEach(() => {
    resizeCallbacks.length = 0;
    window.ResizeObserver = MockResizeObserver;
  });

  afterEach(() => {
    delete (window as { ResizeObserver?: unknown }).ResizeObserver;
  });

  it("identifies its response by the source chat and task while resolving links from the vault root https://github.com/ItsDalk-Lane/Scribe/issues/72", () => {
    renderDetail({
      task: makeTask({ toolCallId: "current-task" }),
      messages: SUBAGENT_MESSAGES,
      chatId: "source-chat",
    });

    expect(screen.getByTestId("trail").getAttribute("data-message-id")).toBe(
      "source-chat/current-task"
    );
    expect(screen.getByTestId("trail").getAttribute("data-source-path")).toBe("");
  });

  it(`shows a subagent's title and model, that it runs only by its spinner, its task as the first user message, then its work, live while it runs`, () => {
    renderDetail({
      task: makeTask({ prompt: "Count the words in Welcome.md", model: "claude-haiku-9" }),
      messages: SUBAGENT_MESSAGES,
    });

    expect(screen.getByText("Count words in Welcome")).toBeTruthy();
    expect(screen.getByText("general-purpose · claude-haiku-9")).toBeTruthy();
    expect(screen.getByText("Running").classList.contains("tw-sr-only")).toBe(true);
    expect(screen.getByTestId("message-user").textContent).toBe("Count the words in Welcome.md");
    expect(screen.getByTestId("trail").textContent).toBe(
      "Bash: wc -w Welcome.md | Welcome.md has 9 words."
    );
    expect(screen.getByTestId("trail").getAttribute("data-streaming")).toBe("true");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it(`stays open when its subagent ends and shows the final status by its check`, () => {
    renderDetail({ task: makeTask({ status: "completed" }), messages: SUBAGENT_MESSAGES });

    expect(screen.getByText("Completed").classList.contains("tw-sr-only")).toBe(true);
    expect(screen.getByTestId("trail").getAttribute("data-streaming")).toBe("false");
  });

  it(`shows a finished subagent's notification summary as its report when it shared no messages`, () => {
    renderDetail({
      task: makeTask({ status: "completed", summary: "Welcome.md has 9 words." }),
    });

    expect(screen.getByTestId("trail").textContent).toBe("Welcome.md has 9 words.");
    expect(screen.queryByText("No activity")).toBeNull();
  });

  it("keeps a legacy summary-only task readable without offering to restore an original child context https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
    renderDetail({
      task: {
        taskId: "legacy-task-1",
        toolCallId: "legacy-call-1",
        kind: "subagent",
        status: "completed",
        description: "旧版资料整理",
        prompt: "整理三份笔记",
        summary: "已整理三份笔记，尚待用户核对来源。",
      },
      messages: [],
    });
    expect(screen.getByText("旧版资料整理")).toBeTruthy();
    expect(screen.getByTestId("message-user").textContent).toBe("整理三份笔记");
    expect(screen.getByTestId("trail").textContent).toBe("已整理三份笔记，尚待用户核对来源。");
    expect(screen.getByTestId("trail").getAttribute("data-streaming")).toBe("false");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it(`lists the files an ended subagent changed below its work and opens a file's diff from its row`, () => {
    const change = {
      path: "notes/b.md",
      status: "modified" as const,
      before: "b\n",
      after: "B\n",
      additions: 1,
      deletions: 1,
    };
    renderDetail({
      task: makeTask({ status: "completed" }),
      messages: [{ ...SUBAGENT_MESSAGES[0], fileChanges: [change] }],
    });

    fireEvent.click(screen.getByRole("button", { name: /b\.md/ }));

    expect(openTurnDiff).toHaveBeenCalledWith({}, change, "call-1");
  });

  it("shows no Files changed card for a subagent that changed no files", () => {
    renderDetail({ task: makeTask({ status: "completed" }), messages: SUBAGENT_MESSAGES });

    expect(screen.queryByRole("button", { name: /\.md/ })).toBeNull();
  });

  it("keeps same-named task changes from different chats in separate file windows", () => {
    const change = {
      path: "notes/b.md",
      status: "modified" as const,
      before: "b",
      after: "B",
      additions: 1,
      deletions: 1,
    };
    renderDetail({
      chatId: "source-chat",
      task: makeTask({ status: "completed" }),
      messages: [{ ...SUBAGENT_MESSAGES[0], fileChanges: [change] }],
    });
    fireEvent.click(screen.getByRole("button", { name: /b\.md/ }));
    expect(openTurnDiff).toHaveBeenCalledWith({}, change, "source-chat:call-1");
  });

  it("says a subagent is starting before it has done anything", () => {
    renderDetail({ task: makeTask() });

    expect(screen.getByText("Starting…")).toBeTruthy();
  });

  it(`shows a command and its output read from its output file`, async () => {
    renderDetail({ task: makeCommandTask() }, { [OUTPUT]: "line 1\nline 2\n" });

    expect(screen.getByText("Background command")).toBeTruthy();
    expect(screen.getByText(/\$ for i in/)).toBeTruthy();
    await screen.findByText(/line 2/);
    expect(screen.getByTestId("task-command-output").textContent).toBe("line 1\nline 2\n");
    expect(screen.queryByText(/Showing the last/)).toBeNull();
  });

  it(`notes when a long command output is cut to its newest part`, async () => {
    const long = "x".repeat(100) + "\n";
    renderDetail(
      { task: makeCommandTask({ status: "completed" }) },
      { [OUTPUT]: long.repeat(Math.ceil(COMMAND_OUTPUT_MAX_BYTES / long.length) + 10) }
    );

    expect(await screen.findByText("Showing the last 256 KB of output.")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("retains saved terminal output after its temporary output file disappears", () => {
    renderDetail({
      task: makeCommandTask({
        status: "stopped",
        interrupted: true,
        savedOutput: { text: "Saved progress\n", truncated: true },
      }),
    });

    expect(screen.getByTestId("task-command-output").textContent).toBe("Saved progress\n");
    expect(screen.getByText("Showing the last 256 KB of output.")).toBeTruthy();
    expect(screen.getByText("Interrupted").classList.contains("tw-sr-only")).toBe(false);
  });

  it("opens the source chat for an approval without closing the independent details", () => {
    const onOpenChat = jest.fn();
    const { onBack } = renderDetail({ chatAwaitsAnswer: true, onOpenChat });

    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));

    expect(onOpenChat).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it(`keeps following the bottom when the report grows after it renders, such as rendered Markdown`, () => {
    renderDetail({ task: makeTask({ status: "completed" }), messages: SUBAGENT_MESSAGES });
    const scroller = screen.getByTestId("trail").closest<HTMLElement>(".tw-overflow-y-auto")!;
    const geometry = fakeScrollGeometry(scroller);

    geometry.scrollHeight = 400;
    contentResized();

    expect(geometry.scrollTop).toBe(300);
  });

  it("leaves the reader's position alone when the content grows while they are scrolled up", () => {
    renderDetail({ task: makeTask({ status: "completed" }), messages: SUBAGENT_MESSAGES });
    const scroller = screen.getByTestId("trail").closest<HTMLElement>(".tw-overflow-y-auto")!;
    const geometry = fakeScrollGeometry(scroller);
    geometry.scrollTop = 20;
    fireEvent.scroll(scroller);

    geometry.scrollHeight = 400;
    contentResized();

    expect(geometry.scrollTop).toBe(20);
  });

  it(`points back to the chat while the chat waits for a permission answer, which it shows only there`, () => {
    const { onBack } = renderDetail({ chatAwaitsAnswer: true });

    expect(screen.getByText(/The chat is waiting for your answer/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));

    expect(onBack).toHaveBeenCalled();
  });

  it("shows no answer cue while the chat waits for nothing", () => {
    renderDetail({});

    expect(screen.queryByText(/The chat is waiting for your answer/)).toBeNull();
  });
});
