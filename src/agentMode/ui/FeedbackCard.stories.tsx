import { FeedbackCard, type FeedbackCardProps } from "@/agentMode/ui/FeedbackCard";
import type { FeedbackOffer } from "@/agentMode/session/feedback/feedbackOffer";
import type { Meta, StoryObj } from "@/lib/story";

const draft: FeedbackOffer = {
  trigger: "agent",
  draft: {
    title: "Scribe could not save a note",
    whatHappened: "The write_note tool returned a permission error while saving a note.",
    userSaid: "Why wasn't the note saved?",
    repro: "1. Ask Scribe to save a note. 2. Observe the write_note error.",
  },
  evidence: {
    backendId: "native",
    model: "claude-sonnet-4-6",
    sessionId: "1911da54-5b56-4820-a062-9a7f8f44e74f",
    raisedAt: "2026-10-08T22:13:52.669Z",
  },
  afterUserMessageId: "user-2",
  status: "open",
};

const meta = {
  title: "Agent Mode/Feedback Card",
  component: FeedbackCard,
  args: {
    offer: draft,
    onReview: () => {},
    onDismiss: () => {},
    onTurnOff: () => {},
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<FeedbackCardProps>;
export default meta;

export const Draft: StoryObj<FeedbackCardProps> = {};

export const AgentNoticedMistake: StoryObj<FeedbackCardProps> = {
  args: { offer: { ...draft, draft: { ...draft.draft, userSaid: "" } } },
};

export const FailedReply: StoryObj<FeedbackCardProps> = {
  args: {
    offer: {
      ...draft,
      trigger: "turn_error",
      draft: {
        title: "Agent Chat reply failed on native",
        whatHappened: "Internal error: Internal service failure",
        userSaid: "",
        repro: "",
      },
    },
  },
};

export const LongQuote: StoryObj<FeedbackCardProps> = {
  args: {
    offer: {
      ...draft,
      draft: {
        ...draft.draft,
        userSaid: `${draft.draft.userSaid} `.repeat(6).trim(),
      },
    },
  },
};

export const Uploaded: StoryObj<FeedbackCardProps> = {
  args: {
    offer: {
      ...draft,
      status: "reported",
      report: {
        reportId: "da3b3782d2a776df9f0bf6fd0ebd570b",
        issueUrl: "https://github.com/ItsDalk-Lane/Scribe/issues/new",
      },
    },
  },
};
