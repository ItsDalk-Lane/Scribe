import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  AgentTodoListEntry,
  AskUserQuestionPrompt,
  CurrentPlan,
  PermissionPrompt,
  QueuedPrompt,
} from "@/agentMode/session/types";
import type { AgentTask } from "@/agentMode/session/AgentSession";
import { useAgentChatRuntimeState } from "@/agentMode/ui/hooks/useAgentChatRuntimeState";
import { act, render, renderHook } from "@testing-library/react";
import React, { useEffect } from "react";

interface FakeBackendState {
  messages: AgentChatMessage[];
  isStarting: boolean;
  isTurnInFlight: boolean;
  isReplyRunning: boolean;
  hasPendingPlanPermission: boolean;
  currentPlan: CurrentPlan | null;
  currentTodoList?: AgentTodoListEntry[] | null;
  pendingToolPermissions: PermissionPrompt[];
  pendingAskUserQuestions: AskUserQuestionPrompt[];
  queuedPrompts?: readonly QueuedPrompt[];
  tasks?: readonly AgentTask[];
}

function makeFakeBackend(initial: Partial<FakeBackendState> = {}) {
  const state: FakeBackendState = {
    messages: initial.messages ?? [],
    isStarting: initial.isStarting ?? false,
    isTurnInFlight: initial.isTurnInFlight ?? false,
    isReplyRunning: initial.isReplyRunning ?? false,
    hasPendingPlanPermission: initial.hasPendingPlanPermission ?? false,
    currentPlan: initial.currentPlan ?? null,
    currentTodoList: initial.currentTodoList ?? null,
    pendingToolPermissions: initial.pendingToolPermissions ?? [],
    pendingAskUserQuestions: initial.pendingAskUserQuestions ?? [],
    queuedPrompts: initial.queuedPrompts ?? [],
    tasks: initial.tasks ?? [],
  };
  const listeners = new Set<() => void>();

  const backend = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getMessages: () => state.messages,
    isStarting: () => state.isStarting,
    isTurnInFlight: () => state.isTurnInFlight,
    isReplyRunning: () => state.isReplyRunning,
    hasPendingPlanPermission: () => state.hasPendingPlanPermission,
    getCurrentPlan: () => state.currentPlan,
    getCurrentTodoList: () => state.currentTodoList ?? null,
    getPendingToolPermissions: () => state.pendingToolPermissions,
    getPendingAskUserQuestions: () => state.pendingAskUserQuestions,
    getQueuedPrompts: () => state.queuedPrompts ?? [],
    getTasks: () => state.tasks ?? [],
  } as unknown as AgentChatBackend;

  return {
    backend,
    state,
    listenerCount: () => listeners.size,
    emit: () => listeners.forEach((l) => l()),
  };
}

const RUNNING_TASK: AgentTask = {
  taskId: "task-1",
  toolCallId: "call-1",
  kind: "subagent",
  description: "Count words",
  status: "running",
};

const msg = (id: string): AgentChatMessage => ({ id }) as unknown as AgentChatMessage;

describe("useAgentChatRuntimeState", () => {
  describe("useAgentChatRuntimeState", () => {
    it("keeps the same snapshot and skips renders for unchanged notifications https://github.com/ItsDalk-Lane/Scribe/issues/72", () => {
      const fake = makeFakeBackend({ messages: [msg("a")] });
      let renders = 0;
      const { result } = renderHook(() => {
        renders++;
        return useAgentChatRuntimeState(fake.backend);
      });
      const before = result.current;
      const count = renders;
      act(() => fake.emit());
      expect(result.current).toBe(before);
      expect(renders).toBe(count);
    });

    it("updates selected status while ignoring growing messages and equivalent permission arrays https://github.com/ItsDalk-Lane/Scribe/issues/72", () => {
      const permission = { toolCall: { toolCallId: "permission" } } as PermissionPrompt;
      const fake = makeFakeBackend({ pendingToolPermissions: [permission] });
      let renders = 0;
      const { result } = renderHook(() => {
        renders++;
        return useAgentChatRuntimeState(fake.backend, (backend) => ({
          running: backend.isReplyRunning(),
          permissions: backend.getPendingToolPermissions(),
        }));
      });
      const initial = result.current;
      const count = renders;
      act(() => {
        fake.state.messages = [msg("new")];
        fake.state.pendingToolPermissions = [permission];
        fake.emit();
      });
      expect(result.current).toBe(initial);
      expect(renders).toBe(count);
      act(() => {
        fake.state.isReplyRunning = true;
        fake.emit();
      });
      expect(result.current.running).toBe(true);
      expect(result.current.permissions).toEqual([permission]);
    });

    it("reads a task's growing output independently of unchanged task metadata https://github.com/ItsDalk-Lane/Scribe/issues/72", () => {
      const fake = makeFakeBackend({ tasks: [RUNNING_TASK] });
      let messages = [msg("first")];
      fake.backend.getTaskMessages = () => messages;
      const { result } = renderHook(() =>
        useAgentChatRuntimeState(fake.backend, (backend) => ({
          tasks: backend.getTasks(),
          messages: backend.getTaskMessages("call-1"),
        }))
      );
      const tasks = result.current.tasks;
      act(() => {
        messages = [msg("first"), msg("second")];
        fake.emit();
      });
      expect(result.current.tasks).toBe(tasks);
      expect(result.current.messages).toBe(messages);
    });

    it("returns the backend's initial snapshot", () => {
      const fake = makeFakeBackend({ messages: [msg("a")], isStarting: true });
      const { result } = renderHook(() => useAgentChatRuntimeState(fake.backend));

      expect(result.current.messages).toEqual([msg("a")]);
      expect(result.current.isStarting).toBe(true);
      expect(result.current.isTurnInFlight).toBe(false);
      expect(result.current.hasPendingPlanPermission).toBe(false);
      expect(result.current.currentPlan).toBeNull();
      expect(result.current.pendingToolPermissions).toEqual([]);
    });

    it("shows an externally started plan implementation as running until the turn finishes", () => {
      const fake = makeFakeBackend();
      const { result } = renderHook(() => useAgentChatRuntimeState(fake.backend));

      act(() => {
        fake.state.isTurnInFlight = true;
        fake.emit();
      });
      expect(result.current.isTurnInFlight).toBe(true);

      act(() => {
        fake.state.isTurnInFlight = false;
        fake.emit();
      });
      expect(result.current.isTurnInFlight).toBe(false);
    });

    it("re-syncs every field when the backend notifies", () => {
      const fake = makeFakeBackend();
      const { result } = renderHook(() => useAgentChatRuntimeState(fake.backend));

      act(() => {
        fake.state.messages = [msg("x"), msg("y")];
        fake.state.isStarting = true;
        fake.state.hasPendingPlanPermission = true;
        fake.state.queuedPrompts = [{ id: "steer", text: "Only the first two" }];
        fake.state.tasks = [RUNNING_TASK];
        fake.state.isReplyRunning = true;
        fake.emit();
      });

      expect(result.current.tasks).toEqual([RUNNING_TASK]);
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.queuedPrompts).toEqual([{ id: "steer", text: "Only the first two" }]);
      expect(result.current.isStarting).toBe(true);
      expect(result.current.hasPendingPlanPermission).toBe(true);
      expect(result.current.isReplyRunning).toBe(true);
    });

    it("serves the new backend's state on the first render after the backend prop changes, never the previous backend's", () => {
      const first = makeFakeBackend({ isStarting: false });
      const second = makeFakeBackend({ isStarting: true });
      const snapshots: boolean[] = [];

      function Probe({ backend }: { backend: AgentChatBackend }) {
        const { isStarting } = useAgentChatRuntimeState(backend);
        useEffect(() => {
          snapshots.push(isStarting);
        }, [isStarting]);
        return null;
      }

      const { rerender } = render(<Probe backend={first.backend} />);
      snapshots.length = 0;
      rerender(<Probe backend={second.backend} />);

      expect(snapshots).toEqual([true]);
    });

    it("unsubscribes from the previous backend on switch and unmount", () => {
      const first = makeFakeBackend();
      const second = makeFakeBackend();
      const { rerender, unmount } = renderHook(({ backend }) => useAgentChatRuntimeState(backend), {
        initialProps: { backend: first.backend },
      });
      expect(first.listenerCount()).toBe(1);

      rerender({ backend: second.backend });
      expect(first.listenerCount()).toBe(0);
      expect(second.listenerCount()).toBe(1);

      unmount();
      expect(second.listenerCount()).toBe(0);
    });

    it("ignores notifications fired after unmount", () => {
      const fake = makeFakeBackend();
      const { result, unmount } = renderHook(() => useAgentChatRuntimeState(fake.backend));

      unmount();
      expect(() =>
        act(() => {
          fake.state.messages = [msg("late")];
          fake.emit();
        })
      ).not.toThrow();
      expect(result.current.messages).toEqual([]);
    });
  });
});
