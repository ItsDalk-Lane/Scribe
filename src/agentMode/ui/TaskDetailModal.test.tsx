import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSession, AgentTask } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { activeAgentDetailModal, closeAgentDetailModals } from "@/agentMode/ui/AgentDetailModal";
import { openTaskModal, TaskDetailModal } from "@/agentMode/ui/TaskDetailModal";
import { openTurnDiff } from "@/agentMode/ui/TurnDiffView";
import { makeTask } from "@/agentMode/ui/testing/taskFixtures";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { type App, Notice } from "obsidian";
import React from "react";

jest.mock("obsidian", () => {
  const actual = jest.requireActual<typeof import("obsidian")>("obsidian");
  const { nativeModalFixture } = jest.requireActual<
    typeof import("@/agentMode/ui/testing/nativeModalFixture")
  >("@/agentMode/ui/testing/nativeModalFixture");
  return { ...actual, Modal: nativeModalFixture(actual.Modal) };
});
jest.mock("@/logger");

jest.mock("@/agentMode/ui/TaskDetailView", () => ({
  TaskDetailView: ({
    task,
    messages,
    onBack,
    onOpenChat,
  }: {
    task: AgentTask;
    messages: AgentChatMessage[];
    onBack: () => void;
    onOpenChat: () => void;
  }) => {
    const { useAgentTasks } = jest.requireActual<typeof import("@/agentMode/ui/AgentTasksContext")>(
      "@/agentMode/ui/AgentTasksContext"
    );
    const tasks = useAgentTasks();
    return (
      <div>
        <span>{task.description}</span>
        <span>{messages.map((message) => message.message).join("\n")}</span>
        <button type="button" onClick={onBack}>
          Close details
        </button>
        <button type="button" onClick={onOpenChat}>
          Open chat
        </button>
        <button type="button" onClick={() => tasks?.openTask("call-2")}>
          Open nested task
        </button>
      </div>
    );
  },
}));

jest.mock("@/agentMode/ui/renderedDiff/RenderedDiff", () => ({
  RenderedDiff: () => <div>Saved file differences</div>,
}));

const EMPTY: never[] = [];
function fixture() {
  const session = { internalId: "internal-1", chatInputId: "chat-1" } as AgentSession;
  const state = {
    tasks: [
      makeTask(),
      makeTask({ toolCallId: "call-2", taskId: "task-2", description: "Nested task" }),
    ],
    message: "Task output",
  };
  const listeners = new Set<() => void>();
  const taskMessages = new Map<string, AgentChatMessage[]>();
  const backend = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getTasks: () => state.tasks,
    getTaskMessages: (id: string) => {
      const text = id === "call-1" ? state.message : "Nested output";
      const cached = taskMessages.get(id);
      if (cached?.[0].message === text) return cached;
      const messages = [
        {
          id: "message-1",
          sender: "ai",
          message: text,
          timestamp: null,
          isVisible: true,
        },
      ];
      taskMessages.set(id, messages);
      return messages;
    },
    getMessages: () => EMPTY,
    isStarting: () => false,
    isTurnInFlight: () => false,
    isReplyRunning: () => false,
    hasPendingPlanPermission: () => false,
    getCurrentPlan: () => null,
    getCurrentTodoList: () => null,
    getPendingToolPermissions: () => EMPTY,
    getPendingAskUserQuestions: () => EMPTY,
    getFeedbackOffer: () => null,
    getQueuedPrompts: () => EMPTY,
    cancel: jest.fn(),
    stopTask: jest.fn(),
  } as unknown as AgentChatBackend;
  const manager = {
    getSession: (id: string) => (id === session.internalId ? session : null),
    getChatUIState: (id: string) => (id === session.internalId ? backend : null),
    setActiveSession: jest.fn(),
  } as unknown as AgentSessionManager;
  const chatLeaf = {};
  const app = {
    keymap: { pushScope: jest.fn(), popScope: jest.fn() },
    workspace: {
      getLeaf: jest.fn(),
      getLeavesOfType: jest.fn(() => [chatLeaf]),
      revealLeaf: jest.fn(),
    },
  } as unknown as App;
  return {
    state,
    session,
    backend,
    manager,
    app,
    chatLeaf,
    listeners,
    emit: () => listeners.forEach((listener) => listener()),
  };
}

const apps: App[] = [];
async function opened(f = fixture(), id = "call-1") {
  apps.push(f.app);
  let modal!: TaskDetailModal;
  await act(async () => {
    modal = await openTaskModal(f.app, f.manager, f.session.internalId, id);
  });
  return { ...f, modal };
}

describe("TaskDetailModal", () => {
  beforeEach(() => {
    jest.spyOn(window, "focus").mockImplementation(() => {
      window.activeWindow = window;
      window.activeDocument = window.document;
    });
  });
  afterEach(() => {
    act(() => {
      for (const app of apps.splice(0)) closeAgentDetailModals(app);
    });
    jest.restoreAllMocks();
  });

  describe("TaskDetailModal", () => {
    describe("renderContent()", () => {
      it("shows an unavailable record truthfully when the retained task is missing", async () => {
        const f = fixture();
        f.state.tasks = [];
        const { modal } = await opened(f);
        expect(within(modal.contentEl).getByText("Task details are unavailable.")).toBeTruthy();
      });
      it("shows task details in a native modal without changing the original chat or opening an operating-system window", async () => {
        const f = await opened();
        expect(within(f.modal.contentEl).getByText("Task output")).toBeTruthy();
        expect(f.modal.titleEl.textContent).toBe("Task details");
        expect(f.modal.containerEl.isConnected).toBe(true);
        expect(f.app.workspace.getLeaf).not.toHaveBeenCalled();
        expect(f.manager.setActiveSession).not.toHaveBeenCalled();
        expect(f.app.workspace.revealLeaf).not.toHaveBeenCalled();
      });

      it("keeps its original source and updates running output while task metadata stays unchanged https://github.com/ItsDalk-Lane/Scribe/issues/72", async () => {
        const f = await opened();
        const tasks = f.state.tasks;
        f.state.message = "New task output";
        act(() => f.emit());
        expect(f.state.tasks).toBe(tasks);
        expect(within(f.modal.contentEl).getByText("New task output")).toBeTruthy();
        expect(f.manager.setActiveSession).not.toHaveBeenCalled();
      });

      it("opens a nested task above its parent and closes only the top modal on one Escape", async () => {
        const f = await opened();
        await act(async () => {
          fireEvent.click(
            within(f.modal.contentEl).getByRole("button", { name: "Open nested task" })
          );
        });
        const nested = activeAgentDetailModal(f.app)!;
        expect(nested).not.toBe(f.modal);
        expect(within(nested.contentEl).getByText("Nested output")).toBeTruthy();
        expect(within(f.modal.contentEl).getByText("Task output")).toBeTruthy();
        expect(f.listeners.size).toBe(2);
        fireEvent.keyDown(nested.modalEl, { key: "Escape" });
        expect(nested.containerEl.isConnected).toBe(false);
        expect(f.modal.containerEl.isConnected).toBe(true);
        expect(f.listeners.size).toBe(1);
      });

      it("reports a nested-task opening failure while preserving its parent report", async () => {
        const f = await opened();
        jest.spyOn(f.manager, "getSession").mockReturnValue(null);
        fireEvent.click(
          within(f.modal.contentEl).getByRole("button", { name: "Open nested task" })
        );
        await waitFor(() => expect(Notice).toHaveBeenCalledWith("Unable to open task details."));
        expect(f.modal.containerEl.isConnected).toBe(true);
        expect(within(f.modal.contentEl).getByText("Task output")).toBeTruthy();
      });

      it("keeps the task report and subscription alive beneath a nested file-difference modal", async () => {
        const f = await opened();
        await act(async () => {
          await openTurnDiff(
            f.app,
            {
              path: "notes/board.canvas",
              before: "{}",
              after: '{"nodes": []}',
              status: "modified",
              additions: 1,
              deletions: 1,
            },
            "chat-1:call-1"
          );
        });
        const diff = activeAgentDetailModal(f.app)!;
        expect(diff).not.toBe(f.modal);
        expect(within(diff.contentEl).getByText("Saved file differences")).toBeTruthy();
        expect(f.modal.containerEl.isConnected).toBe(true);
        expect(f.listeners.size).toBe(1);
        act(() => diff.close());
        expect(activeAgentDetailModal(f.app)).toBe(f.modal);
        expect(f.listeners.size).toBe(1);
        expect(f.app.workspace.getLeaf).not.toHaveBeenCalled();
      });

      it("returns to the original chat for an answer after closing detail overlays", async () => {
        const f = await opened();
        fireEvent.click(within(f.modal.contentEl).getByRole("button", { name: "Open chat" }));
        expect(f.manager.setActiveSession).toHaveBeenCalledWith("internal-1");
        expect(f.app.workspace.revealLeaf).toHaveBeenCalledWith(f.chatLeaf);
        expect(f.modal.containerEl.isConnected).toBe(false);
        expect(f.backend.stopTask).not.toHaveBeenCalled();
      });
    });

    describe("onClose()", () => {
      it("cleans subscriptions while leaving the task running and permits reopening it", async () => {
        const f = await opened();
        expect(f.listeners.size).toBe(1);
        fireEvent.click(within(f.modal.contentEl).getByRole("button", { name: "Close details" }));
        expect(f.listeners.size).toBe(0);
        expect(f.backend.cancel).not.toHaveBeenCalled();
        expect(f.backend.stopTask).not.toHaveBeenCalled();
        expect(f.state.tasks[0].status).toBe("running");
        let reopened!: TaskDetailModal;
        await act(async () => {
          reopened = await openTaskModal(f.app, f.manager, "internal-1", "call-1");
        });
        expect(reopened).not.toBe(f.modal);
        expect(f.listeners.size).toBe(1);
      });
    });
  });

  describe("openTaskModal()", () => {
    it("reuses the same modal on concurrent clicks and brings it above another task without resetting its content", async () => {
      const f = fixture();
      apps.push(f.app);
      let first!: TaskDetailModal;
      let duplicate!: TaskDetailModal;
      await act(async () => {
        [first, duplicate] = await Promise.all([
          openTaskModal(f.app, f.manager, "internal-1", "call-1"),
          openTaskModal(f.app, f.manager, "internal-1", "call-1"),
        ]);
      });
      expect(duplicate).toBe(first);
      expect(f.listeners.size).toBe(1);
      await act(async () => {
        await openTaskModal(f.app, f.manager, "internal-1", "call-2");
      });
      await act(async () => {
        await openTaskModal(f.app, f.manager, "internal-1", "call-1");
      });
      expect(activeAgentDetailModal(f.app)).toBe(first);
      expect(within(first.contentEl).getByText("Task output")).toBeTruthy();
      expect(f.listeners.size).toBe(2);
    });

    it("does not retain a failed modal and permits retrying the same task", async () => {
      const f = fixture();
      apps.push(f.app);
      jest.spyOn(TaskDetailModal.prototype, "onOpen").mockImplementationOnce(() => {
        throw new Error("Failed to open");
      });
      await expect(openTaskModal(f.app, f.manager, "internal-1", "call-1")).rejects.toThrow(
        "Failed to open"
      );
      expect(activeAgentDetailModal(f.app)).toBeNull();
      await act(async () => {
        await openTaskModal(f.app, f.manager, "internal-1", "call-1");
      });
      expect(activeAgentDetailModal(f.app)).toBeTruthy();
    });

    it("rejects a removed source without opening a modal or a new window", async () => {
      const f = fixture();
      await expect(openTaskModal(f.app, f.manager, "missing", "call-1")).rejects.toThrow(
        "Task source chat is unavailable"
      );
      expect(f.app.workspace.getLeaf).not.toHaveBeenCalled();
      expect(activeAgentDetailModal(f.app)).toBeNull();
    });
  });
});
