import { AgentTasksProvider } from "@/agentMode/ui/AgentTasksContext";
import { makeTask } from "@/agentMode/ui/testing/taskFixtures";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  TurnFileChange,
  AskUserQuestionPrompt,
  CurrentPlan,
  PermissionPrompt,
} from "@/agentMode/session/types";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { AI_SENDER } from "@/constants";
import { openTurnDiff } from "@/agentMode/ui/TurnDiffView";
import { logError } from "@/logger";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { Notice } from "obsidian";

type AgentChatMessagesProps = React.ComponentProps<typeof AgentChatMessages>;

const mockSingleMessageRender = jest.fn();
const mockTrailRender = jest.fn();
const mockScrollState = { paused: false, onResume: jest.fn() };

jest.mock("@/hooks/useChatScrolling", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useChatScrolling: () => ({
    scrollContainerCallbackRef: jest.fn(),
    contentCallbackRef: jest.fn(),
    onScroll: jest.fn(),
    isScrollPaused: mockScrollState.paused,
    scrollToEnd: mockScrollState.onResume,
    getMessageKey: (message: { id: string }) => message.id,
  }),
}));

jest.mock("@/components/chat-components/ChatSingleMessage", () => ({
  __esModule: true,
  default: ({
    message,
    footerStart,
    sourcePath,
    onFork,
    forkDisabled,
  }: {
    message: { message: string };
    footerStart?: React.ReactNode;
    sourcePath?: string;
    onFork?: () => void;
    forkDisabled?: boolean;
  }) => {
    mockSingleMessageRender(message);
    return (
      <div data-source-path={sourcePath}>
        {message.message}
        {onFork ? (
          <button type="button" disabled={forkDisabled} onClick={onFork}>
            Fork response
          </button>
        ) : null}
        <div data-testid="single-message-footer">{footerStart}</div>
      </div>
    );
  },
}));

jest.mock("@/agentMode/ui/AgentTrailView", () => ({
  AgentTrail: ({
    timestamp,
    parts,
    errorText,
    fileChanges,
    onOpenFileChange,
  }: {
    timestamp?: string;
    parts: unknown[];
    errorText?: string;
    fileChanges?: TurnFileChange[];
    onOpenFileChange?: (change: TurnFileChange) => void;
  }) => {
    mockTrailRender(parts);
    return (
      <div data-testid="agent-trail-timestamp">
        {timestamp}
        {errorText ? <span data-testid="agent-trail-error">{errorText}</span> : null}
        {fileChanges?.map((change) => (
          <button key={change.path} type="button" onClick={() => onOpenFileChange?.(change)}>
            {change.path}
          </button>
        ))}
      </div>
    );
  },
}));

jest.mock("@/agentMode/ui/TurnDiffView", () => ({
  openTurnDiff: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/logger", () => ({ ...jest.requireActual("@/logger"), logError: jest.fn() }));

jest.mock("@/agentMode/ui/ToolPermissionCard", () => ({
  ToolPermissionCard: ({
    request,
    toolName,
    requester,
  }: {
    request: PermissionPrompt;
    toolName?: string;
    requester?: string;
  }) => (
    <div>
      Permission {request.toolCall.toolCallId}
      {toolName ? ` via ${toolName}` : ""}
      {requester ? ` from ${requester}` : ""}
    </div>
  ),
}));

jest.mock("@/agentMode/ui/AskUserQuestionCard", () => ({
  AskUserQuestionCard: ({ request }: { request: AskUserQuestionPrompt }) => (
    <div>Question {request.requestId}</div>
  ),
}));

const mockSetSettings = jest.fn();
jest.mock("@/settings/model", () => ({
  ...jest.requireActual<Record<string, unknown>>("@/settings/model"),
  setSettings: (...args: unknown[]) => mockSetSettings(...args),
}));

jest.mock("@/agentMode/ui/PlanProposalCard", () => ({
  PlanProposalCard: ({ plan }: { plan: CurrentPlan }) => <div>Plan {plan.id}</div>,
}));

const FILE_CHANGE: TurnFileChange = {
  path: "notes/diff-demo/alpha.md",
  status: "modified",
  before: "The quick brown fox.\n",
  after: "The quick red fox.\n",
  additions: 1,
  deletions: 1,
};

function assistantMessage(
  id: string,
  timestampMs: number,
  overrides: Partial<AgentChatMessage> = {}
): AgentChatMessage {
  return {
    id,
    sender: AI_SENDER,
    message: "Finished response",
    timestamp: { epoch: timestampMs, display: "", fileName: "" },
    isVisible: true,
    ...overrides,
  };
}

const chatBackend = {
  resolveToolPermission: jest.fn(),
  resolveAskUserQuestion: jest.fn(),
} as unknown as AgentChatBackend;

function permission(id: string): PermissionPrompt {
  return {
    sessionId: "session-1",
    toolCall: { toolCallId: id, status: "pending", title: id },
    options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
  };
}

function question(id: string): AskUserQuestionPrompt {
  return {
    sessionId: "session-1",
    requestId: id,
    questions: [{ question: id, options: [{ label: "Yes" }] }],
  };
}

function plan(id: string): CurrentPlan {
  return {
    id,
    revision: 1,
    body: "Review the plan",
    title: "Plan",
    permissionGated: true,
    decision: "pending",
  };
}

function renderMessages(
  messages: AgentChatMessage[],
  isLoading: boolean,
  overrides: Partial<AgentChatMessagesProps> = {}
) {
  const props: AgentChatMessagesProps = {
    messages,
    plugin: { app: {} as never, manifest: { version: "4.1.0" } as never },
    currentPlan: null,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    chatBackend,
    isLoading,
    ...overrides,
  };
  return { ...render(<AgentChatMessages {...props} />), props };
}

describe("AgentChatMessages", () => {
  describe("AgentChatMessages", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(200_000);
      mockSingleMessageRender.mockClear();
      mockTrailRender.mockClear();
      mockScrollState.paused = false;
      mockScrollState.onResume.mockClear();
    });

    afterEach(() => jest.useRealTimers());

    it("shows a return control over the paused transcript and resumes following on click", () => {
      mockScrollState.paused = true;
      renderMessages([assistantMessage("response", 1_000)], false);

      fireEvent.click(screen.getByRole("button", { name: "Scroll to end" }));
      expect(mockScrollState.onResume).toHaveBeenCalledTimes(1);
    });

    it("forwards the active session conversation path to user messages", () => {
      const { container } = renderMessages(
        [assistantMessage("user-1", 1, { sender: "user", message: "[[Findings]]" })],
        false,
        { sourcePath: "chat/Conversation.md" }
      );
      expect(
        container.querySelector('[data-source-path="chat/Conversation.md"]')?.textContent
      ).toContain("[[Findings]]");
    });

    it("forks the selected completed reply once and blocks repeated clicks until it finishes", async () => {
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const onForkMessage = jest.fn(() => pending);
      renderMessages(
        [assistantMessage("reply-1", 1_000), assistantMessage("reply-2", 2_000)],
        false,
        { onForkMessage }
      );
      const buttons = screen.getAllByRole("button", { name: "Fork response" });
      fireEvent.click(buttons[0]);
      fireEvent.click(buttons[1]);
      expect(onForkMessage).toHaveBeenCalledTimes(1);
      expect(onForkMessage).toHaveBeenCalledWith("reply-1");
      expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
      await act(async () => {
        finish();
        await pending;
      });
      expect((buttons[1] as HTMLButtonElement).disabled).toBe(false);
    });

    it("keeps the current conversation visible and reports a failed fork", async () => {
      const failure = new Error("disk full");
      const rejected = Promise.reject(failure);
      const onForkMessage = jest.fn(() => rejected);
      renderMessages([assistantMessage("reply", 1_000, { message: "Original reply" })], false, {
        onForkMessage,
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Fork response" }));
        await rejected.catch(() => {});
      });
      expect(screen.getByText("Original reply")).toBeTruthy();
      expect(logError).toHaveBeenCalledWith(
        "[AgentChatMessages] failed to fork conversation",
        failure
      );
      expect(Notice).toHaveBeenCalledWith("Failed to fork conversation. Please try again.");
    });

    it("withholds branching from the reply still being written", () => {
      renderMessages([assistantMessage("reply", 198_000)], true, { onForkMessage: jest.fn() });
      expect(screen.queryByRole("button", { name: "Fork response" })).toBeNull();
    });

    it("retains the latest completed turn duration with a static icon", () => {
      const { container } = renderMessages(
        [assistantMessage("answer-1", 62_000, { turnDurationMs: 138_000 })],
        false
      );

      expect(screen.getByText("2m 18s")).toBeTruthy();
      expect(screen.getByTestId("single-message-footer").textContent).toBe("");
      expect(container.querySelector(".scribe-spinner")).toBeTruthy();
      expect(container.querySelector(".scribe-spinner-dot-0")).toBeNull();
    });

    it("retains the prior duration when the next turn starts", () => {
      const completed = assistantMessage("answer-1", 1_000, { turnDurationMs: 51_000 });
      const { container, rerender, props } = renderMessages([completed], false);
      expect(screen.getByText("51s")).toBeTruthy();

      rerender(
        <AgentChatMessages
          {...props}
          messages={[completed, assistantMessage("answer-2", 198_000, { message: "", parts: [] })]}
          isLoading
        />
      );

      expect(screen.getByText("51s")).toBeTruthy();
      expect(screen.getByText("2s")).toBeTruthy();
      expect(container.querySelector(".scribe-spinner")).toBeTruthy();

      act(() => jest.advanceTimersByTime(1_000));
      expect(screen.getByText("3s")).toBeTruthy();
    });

    it("retains each recorded duration as three consecutive replies finish", () => {
      const first = assistantMessage("first", 1_000, { turnDurationMs: 8_000 });
      const second = assistantMessage("second", 2_000, { turnDurationMs: 18_000 });
      const third = assistantMessage("third", 3_000, { turnDurationMs: 12_000 });
      const { rerender, props } = renderMessages([first], false);
      rerender(<AgentChatMessages {...props} messages={[first, second]} />);
      rerender(<AgentChatMessages {...props} messages={[first, second, third]} />);
      expect(screen.getByText("8s")).toBeTruthy();
      expect(screen.getByText("18s")).toBeTruthy();
      expect(screen.getByText("12s")).toBeTruthy();
    });

    it("shows a finished reply's duration without a live timer while the agent keeps working on its subagents", () => {
      renderMessages(
        [
          assistantMessage("launch-reply", 1_000, {
            message: "LAUNCHED",
            turnStopReason: "end_turn",
            turnDurationMs: 12_000,
          }),
        ],
        true
      );

      expect(screen.getByText("12s")).toBeTruthy();
      expect(screen.queryByText("Agent is working")).toBeNull();
    });

    it("passes the message timestamp to a structured trail without a duration", () => {
      const timestamp = "2026/08/07 20:31:10";
      renderMessages(
        [
          assistantMessage("answer-1", 62_000, {
            timestamp: { epoch: 62_000, display: timestamp, fileName: "20260807_203110" },
            parts: [{ kind: "thought", text: "Inspect the response." }],
          }),
        ],
        false
      );

      expect(screen.getByTestId("agent-trail-timestamp").textContent).toBe(timestamp);
    });

    it("separates an existing failed reply's body from its error without altering the message", () => {
      const message = assistantMessage("failed-partial", 62_000, {
        message: "Original body\n\n**Error:** disconnected",
        isErrorMessage: true,
        parts: [{ kind: "text", text: "Original body" }],
      });
      const original = JSON.stringify(message);
      renderMessages([message], false);
      expect(screen.getByTestId("agent-trail-error").textContent).toBe("**Error:** disconnected");
      expect(JSON.stringify(message)).toBe(original);
    });
    it("keeps a separately stored error intact even when it begins with the reply body", () => {
      renderMessages(
        [
          assistantMessage("failed-separate", 62_000, {
            message: "Body\n\n**Error:** Body\n\nDetail",
            isErrorMessage: true,
            errorText: "Body\n\nDetail",
            parts: [{ kind: "text", text: "Body" }],
          }),
        ],
        false
      );
      expect(screen.getByTestId("agent-trail-error").textContent).toBe("Body\n\nDetail");
    });

    it("hands a failed structured turn's error to its trail, which shows no error text for a message without parts", () => {
      renderMessages(
        [
          assistantMessage("failed-1", 62_000, {
            message: "**Error:** stream error",
            isErrorMessage: true,
            parts: [
              {
                kind: "compaction",
                id: "c1",
                status: "completed",
                trigger: "manual",
                startedAtMs: 0,
              },
            ],
          }),
          assistantMessage("ok-1", 63_000, {
            parts: [{ kind: "thought", text: "Fine." }],
          }),
        ],
        false
      );

      expect(screen.getAllByTestId("agent-trail-error").map((el) => el.textContent)).toEqual([
        "**Error:** stream error",
      ]);
    });

    it("keeps completed plain and structured turns mounted without rendering them again while the live turn streams", () => {
      const user = assistantMessage("user-1", 1_000, {
        sender: "user",
        message: "Summarize this note",
      });
      const completed = assistantMessage("answer-1", 2_000, {
        parts: [{ kind: "text", text: "The note has three points." }],
      });
      const live = assistantMessage("answer-2", 3_000, {
        message: "First point",
        parts: [{ kind: "text", text: "First point" }],
      });
      const { rerender, props } = renderMessages([user, completed, live], true);
      const originalUser = mockSingleMessageRender.mock.calls[0][0];
      const originalCompletedParts = mockTrailRender.mock.calls[0][0];

      rerender(
        <AgentChatMessages
          {...props}
          messages={[
            user,
            completed,
            {
              ...live,
              message: "First point and second point",
              parts: [{ kind: "text", text: "First point and second point" }],
            },
          ]}
        />
      );

      expect(mockSingleMessageRender).toHaveBeenCalledTimes(1);
      expect(mockSingleMessageRender.mock.calls[0][0]).toBe(originalUser);
      expect(mockTrailRender).toHaveBeenCalledTimes(3);
      expect(mockTrailRender.mock.calls[0][0]).toBe(originalCompletedParts);
      expect(screen.getAllByTestId("agent-trail-timestamp")).toHaveLength(2);
    });

    it("opens the clicked file's diff against the turn that changed it", () => {
      const app = {} as never;
      renderMessages(
        [
          assistantMessage("answer-1", 62_000, {
            parts: [{ kind: "thought", text: "Revise the note." }],
            turnStopReason: "end_turn",
            fileChanges: [FILE_CHANGE],
          }),
        ],
        false,
        { plugin: { app, manifest: { version: "4.1.0" } as never } }
      );

      fireEvent.click(screen.getByRole("button", { name: "notes/diff-demo/alpha.md" }));

      expect(openTurnDiff).toHaveBeenCalledWith(app, FILE_CHANGE, "answer-1");
    });

    it("logs a diff tab that fails to open instead of leaving the rejection unhandled", async () => {
      const failure = new Error("leaf detached");
      jest.mocked(openTurnDiff).mockRejectedValueOnce(failure);
      renderMessages(
        [
          assistantMessage("answer-1", 62_000, {
            parts: [{ kind: "thought", text: "Revise the note." }],
            turnStopReason: "end_turn",
            fileChanges: [FILE_CHANGE],
          }),
        ],
        false
      );

      fireEvent.click(screen.getByRole("button", { name: FILE_CHANGE.path }));

      await waitFor(() =>
        expect(logError).toHaveBeenCalledWith(
          "[AgentChatMessages] failed to open the turn diff",
          failure
        )
      );
    });

    it("shows questions before permissions and reveals a permission after questions clear", () => {
      const { rerender, props } = renderMessages([assistantMessage("answer-1", 62_000)], false, {
        pendingToolPermissions: [permission("permission-first"), permission("permission-second")],
        pendingAskUserQuestions: [question("question-first")],
      });

      const rail = screen.getByRole("region", { name: "Pending agent actions" });
      const firstAction = rail.querySelector("[data-action-id]");
      expect(Array.from(rail.querySelectorAll("[data-action-id]"), (el) => el.textContent)).toEqual(
        ["Question question-first"]
      );
      expect(screen.getByTestId("chat-messages").textContent).not.toContain("question-first");

      rerender(
        <AgentChatMessages
          {...props}
          pendingToolPermissions={[permission("permission-first"), permission("permission-second")]}
          pendingAskUserQuestions={[]}
        />
      );

      expect(Array.from(rail.querySelectorAll("[data-action-id]"), (el) => el.textContent)).toEqual(
        ["Permission permission-first"]
      );
      expect(rail.querySelector("[data-action-id]")).not.toBe(firstAction);
    });

    it("passes the pending permission the tool name its chat tool call shows", () => {
      const toolTurn = assistantMessage("answer-1", 62_000, {
        parts: [
          { kind: "tool_call", id: "search-1", title: "websearch", status: "pending" },
        ] as AgentChatMessage["parts"],
      });

      renderMessages([toolTurn], true, {
        pendingToolPermissions: [permission("search-1")],
      });

      expect(screen.getByRole("region", { name: "Pending agent actions" }).textContent).toBe(
        "Permission search-1 via websearch"
      );
    });

    it("labels a permission request with the task that asked", () => {
      const request = { ...permission("sub-bash"), requester: { taskId: "task-1" } };

      render(
        <AgentTasksProvider tasks={[makeTask()]} openTask={jest.fn()}>
          <AgentChatMessages
            messages={[]}
            plugin={{ app: {} as never, manifest: { version: "4.1.0" } as never }}
            currentPlan={null}
            pendingToolPermissions={[request]}
            pendingAskUserQuestions={[]}
            chatBackend={chatBackend}
            isLoading={false}
          />
        </AgentTasksProvider>
      );

      expect(screen.getByRole("region", { name: "Pending agent actions" }).textContent).toBe(
        'Permission sub-bash from general-purpose "Count words in Welcome"'
      );
    });

    it("bounds and scrolls a tall action rail so controls remain reachable", () => {
      renderMessages([], false, {
        pendingAskUserQuestions: [question("empty-chat-question")],
      });

      const rail = screen.getByTestId("agent-action-rail");
      expect(rail.textContent).toContain("empty-chat-question");
      expect(rail.className).toContain("tw-w-full");
      expect(rail.className).toContain("tw-max-h-full");
      expect(rail.className).toContain("tw-overflow-y-auto");
      expect(rail.className).not.toContain("tw-shrink-0");
      expect(rail.className).not.toContain("tw-border");
    });

    it("keeps a plan-only state in the transcript without creating an action rail", () => {
      renderMessages([], false, { currentPlan: plan("plan-1") });

      expect(screen.getByTestId("chat-messages").textContent).toContain("Plan plan-1");
      expect(screen.queryByTestId("agent-action-rail")).toBeNull();
    });
  });
});
