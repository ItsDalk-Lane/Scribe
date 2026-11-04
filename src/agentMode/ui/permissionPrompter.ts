import type { AgentSession } from "@/agentMode/session/AgentSession";
import { tryReadExitPlanModeCall } from "@/agentMode/session/messageParts";
import type {
  AskUserQuestionPrompter,
  PermissionPrompter,
} from "@/agentMode/session/AgentSessionManager";
import { type SessionId } from "@/agentMode/session/types";

export function createDefaultPermissionPrompter(
  resolveSession: (backendSessionId: SessionId) => AgentSession | null
): PermissionPrompter {
  return (req) => {
    const session = resolveSession(req.sessionId);
    if (!session) return Promise.resolve({ outcome: { outcome: "cancelled" } });
    if (
      req.toolCall.isPlanProposal ||
      tryReadExitPlanModeCall({
        kind: req.toolCall.kind,
        rawInput: req.toolCall.rawInput,
      })
    ) {
      return session.handlePlanProposalPermission(req);
    }
    return session.handleToolPermission(req);
  };
}

export function createDefaultAskUserQuestionPrompter(
  resolveSession: (backendSessionId: SessionId) => AgentSession | null
): AskUserQuestionPrompter {
  return (req) => {
    const session = resolveSession(req.sessionId);
    if (!session) return Promise.resolve({});
    return session.handleAskUserQuestion(req);
  };
}
