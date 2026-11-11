import { t } from "@/lib/i18n";
import { isSubagentRunActive } from "@/agentMode/session/subagentSessions";
import type { SubagentRunStatus, SubagentSessionSnapshot } from "@/agentMode/session/subagentTypes";

export const SUBAGENT_RUN_LABELS: Record<SubagentRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  awaiting_approval: "Needs approval",
  awaiting_input: "Waiting for input",
  stopping: "Stopping",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
  stopped: "Stopped",
};

export function subagentRunStatusLabel(status: SubagentRunStatus): string {
  return t(SUBAGENT_RUN_LABELS[status]);
}

export interface SubagentSessionGroups {
  running: SubagentSessionSnapshot[];
  completed: SubagentSessionSnapshot[];
}

export function groupSubagentSessions(
  sessions: readonly SubagentSessionSnapshot[]
): SubagentSessionGroups {
  const groups: SubagentSessionGroups = { running: [], completed: [] };
  for (const session of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const target = session.runs.some((run) => isSubagentRunActive(run.status))
      ? groups.running
      : groups.completed;
    target.push(session);
  }
  return groups;
}
