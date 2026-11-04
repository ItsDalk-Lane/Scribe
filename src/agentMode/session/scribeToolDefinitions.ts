export const COPILOT_MCP_SERVER_NAME = "obsidian-scribe";
export const SEND_FEEDBACK_TOOL_NAME = "send_feedback";
export const CALLER_SESSION_ARGUMENT = "caller_session_id";

export const SEND_FEEDBACK_TOOL = Object.freeze({
  name: SEND_FEEDBACK_TOOL_NAME,
  description: `Draft a bug report when Scribe itself fails, never for your own mistakes, answers or edits, even if the user is frustrated with them. Scribe fails when an obsidian-scribe tool, Scribe skill or attached context errors, a tool you need is missing, or the user reports Scribe crashing, erroring or losing chat text. Not for the user venting about their own work or other topics.

The draft appears as a card the user reviews, edits, sends or dismisses; nothing is sent without their approval. The call returns at once: continue your reply and don't mention the card unless asked. At most once per problem.

Write only facts from this session, in English except user_said. Quote the user verbatim, never paraphrased into a stronger claim. Omit secrets and unrelated note content.`,
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "One-line summary, under 80 characters." },
      what_happened: {
        type: "string",
        description: "Observed vs. expected behavior; exact error text if short.",
      },
      user_said: {
        type: "string",
        description: "The user's words that prompted this, verbatim. Empty if they didn't comment.",
      },
      repro: { type: "string", description: "Minimal steps to reproduce." },
    },
    required: ["title", "what_happened", "repro"],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
});

export interface FeedbackDraft {
  title: string;
  whatHappened: string;
  userSaid: string;
  repro: string;
}

export type FeedbackOfferResult = "shown" | "already_offered" | "turned_off" | "unattributed";

export type FeedbackOfferHandler = (
  draft: FeedbackDraft,
  callerSessionId: string | null
) => FeedbackOfferResult;
