import type { AgentMcpServer } from "@/agentMode/session/types";
import type { FeedbackOfferHandler } from "@/agentMode/session/scribeToolDefinitions";
export {
  SCRIBE_MCP_SERVER_NAME,
  SEND_FEEDBACK_TOOL_NAME,
  SEND_FEEDBACK_TOOL,
  CALLER_SESSION_ARGUMENT,
  type FeedbackDraft,
  type FeedbackOfferResult,
  type FeedbackOfferHandler,
} from "@/agentMode/session/scribeToolDefinitions";

export interface ScribeMcpServer {
  connect(sessionKey: string, onOffer: FeedbackOfferHandler): Promise<AgentMcpServer>;
  disconnect(sessionKey: string): void;
  dispose(): void;
}
