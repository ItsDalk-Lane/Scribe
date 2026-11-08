import type { SubagentRunStatus, SubagentSessionSnapshot } from "@/agentMode/session/subagentTypes";

export const EMPTY_SUBAGENT_SESSIONS: readonly SubagentSessionSnapshot[] = Object.freeze([]);

export function isSubagentRunActive(status: SubagentRunStatus): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "awaiting_approval" ||
    status === "awaiting_input" ||
    status === "stopping"
  );
}

export function hasManagedSubagentWork(sessions: readonly SubagentSessionSnapshot[]): boolean {
  return sessions.some(
    (session) =>
      session.runs.some((run) => isSubagentRunActive(run.status)) ||
      (session.retention === "retained" &&
        // 满箱结果尚未生成收件消息，也必须保留其交付工作，不能按纯历史回收。https://github.com/ItsDalk-Lane/Scribe/issues/50
        (session.runs.some((run) => !!run.resultId && !run.resultDelivered) ||
          session.messages.some(
            (message) =>
              message.direction === "to_parent" &&
              message.state === "accepted" &&
              (message.kind === "question" ||
                message.kind === "blocked" ||
                message.kind === "result")
          )))
  );
}
