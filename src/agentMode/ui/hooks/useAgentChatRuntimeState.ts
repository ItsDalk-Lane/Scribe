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
import type { SubagentSessionSnapshot } from "@/agentMode/session/subagentTypes";
import { EMPTY_SUBAGENT_SESSIONS } from "@/agentMode/session/subagentSessions";
import { useCallback, useRef, useSyncExternalStore } from "react";

export interface AgentChatRuntimeState {
  messages: AgentChatMessage[];
  isStarting: boolean;
  isTurnInFlight: boolean;
  isReplyRunning: boolean;
  hasPendingPlanPermission: boolean;
  currentPlan: CurrentPlan | null;
  currentTodoList: AgentTodoListEntry[] | null;
  pendingToolPermissions: PermissionPrompt[];
  pendingAskUserQuestions: AskUserQuestionPrompt[];
  queuedPrompts: readonly QueuedPrompt[];
  tasks: readonly AgentTask[];
  subagents: readonly SubagentSessionSnapshot[];
}

interface BackendRuntimeSnapshot<T> {
  backend: AgentChatBackend;
  state: T;
}

function readBackendRuntimeState(backend: AgentChatBackend): AgentChatRuntimeState {
  return {
    messages: backend.getMessages(),
    isStarting: backend.isStarting(),
    isTurnInFlight: backend.isTurnInFlight(),
    isReplyRunning: backend.isReplyRunning(),
    hasPendingPlanPermission: backend.hasPendingPlanPermission(),
    currentPlan: backend.getCurrentPlan(),
    currentTodoList: backend.getCurrentTodoList(),
    pendingToolPermissions: backend.getPendingToolPermissions(),
    pendingAskUserQuestions: backend.getPendingAskUserQuestions(),
    queuedPrompts: backend.getQueuedPrompts(),
    tasks: backend.getTasks(),
    subagents: backend.getSubagentSessions?.() ?? EMPTY_SUBAGENT_SESSIONS,
  };
}

// 权限等列表可重新包装同一批对象，无关通知不能因此触发界面更新。https://github.com/ItsDalk-Lane/Scribe/issues/72
function sameValue(previous: unknown, next: unknown): boolean {
  return (
    Object.is(previous, next) ||
    (Array.isArray(previous) &&
      Array.isArray(next) &&
      previous.length === next.length &&
      previous.every((value, index) => Object.is(value, next[index])))
  );
}

function sameSelection<T>(previous: T, next: T): boolean {
  if (sameValue(previous, next)) return true;
  if (
    !previous ||
    !next ||
    typeof previous !== "object" ||
    typeof next !== "object" ||
    Array.isArray(previous) ||
    Array.isArray(next)
  )
    return false;
  const entries = Object.entries(previous);
  return (
    entries.length === Object.keys(next).length &&
    entries.every(
      ([key, value]) =>
        Object.prototype.hasOwnProperty.call(next, key) &&
        sameValue(value, (next as Record<string, unknown>)[key])
    )
  );
}

export function useAgentChatRuntimeState(backend: AgentChatBackend): AgentChatRuntimeState;
export function useAgentChatRuntimeState<T>(
  backend: AgentChatBackend,
  select: (backend: AgentChatBackend) => T
): T;
export function useAgentChatRuntimeState<T = AgentChatRuntimeState>(
  backend: AgentChatBackend,
  select: (backend: AgentChatBackend) => T = readBackendRuntimeState as (
    backend: AgentChatBackend
  ) => T
): T {
  const snapshotRef = useRef<BackendRuntimeSnapshot<T> | null>(null);
  const getSnapshot = useCallback(() => {
    const state = select(backend);
    const previous = snapshotRef.current;
    if (previous?.backend === backend && sameSelection(previous.state, state))
      return previous.state;
    snapshotRef.current = { backend, state };
    return state;
  }, [backend, select]);
  const subscribe = useCallback((listener: () => void) => backend.subscribe(listener), [backend]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
