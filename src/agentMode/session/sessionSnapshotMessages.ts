import type { AgentChatMessage, AgentMessagePart } from "@/agentMode/session/types";
import { USER_SENDER } from "@/constants";

const EMPTY_MESSAGES = Object.freeze([]) as unknown as AgentChatMessage[];

function splitTurns(messages: readonly AgentChatMessage[]): AgentChatMessage[][] {
  const turns: AgentChatMessage[][] = [];
  for (const message of messages) {
    if (message.sender === USER_SENDER || turns.length === 0) turns.push([]);
    turns[turns.length - 1].push(message);
  }
  return turns;
}

function mergeParts(
  saved: AgentMessagePart[] | undefined,
  replay: AgentMessagePart[] | undefined,
  preferReplay: boolean
): AgentMessagePart[] | undefined {
  const base = preferReplay ? (replay ?? saved) : (saved ?? replay);
  return base?.map((part) => {
    if (part.kind === "tool_call") {
      const local = saved?.find((item) => item.kind === "tool_call" && item.id === part.id);
      const native = replay?.find((item) => item.kind === "tool_call" && item.id === part.id);
      if (local?.kind === "tool_call" && native?.kind === "tool_call") {
        return native.status === "pending" || native.status === "in_progress"
          ? local
          : { ...local, ...native };
      }
    }
    if (part.kind === "thought") {
      const local = saved?.find((item) => item.kind === "thought" && item.text === part.text);
      if (local?.kind === "thought" && local.durationMs !== undefined) return local;
    }
    return part;
  });
}

function mergeMessage(saved: AgentChatMessage, replay: AgentChatMessage): AgentChatMessage {
  const extendsSavedText =
    replay.message.length > saved.message.length && replay.message.startsWith(saved.message);
  const preferReplay =
    saved.sender !== USER_SENDER &&
    (extendsSavedText ||
      (saved.turnStopReason === undefined &&
        (replay.turnStopReason !== undefined || replay.message.length >= saved.message.length)));
  return {
    ...replay,
    ...saved,
    message: preferReplay ? replay.message : saved.message,
    timestamp: saved.timestamp ?? replay.timestamp,
    context: saved.context ?? replay.context,
    content: saved.content ?? replay.content,
    parts: mergeParts(saved.parts, replay.parts, preferReplay),
    turnStopReason: saved.turnStopReason ?? replay.turnStopReason,
    turnDurationMs: saved.turnDurationMs ?? replay.turnDurationMs,
    fileChanges: saved.fileChanges ?? replay.fileChanges,
  };
}

function freezeUnconfirmed(message: AgentChatMessage): AgentChatMessage {
  const parts = message.parts?.map(
    (part): AgentMessagePart =>
      (part.kind === "tool_call" && (part.status === "pending" || part.status === "in_progress")) ||
      (part.kind === "compaction" && part.status === "in_progress")
        ? { ...part, status: "cancelled" }
        : part
  );
  return parts ? { ...message, parts } : message;
}

export function mergeSnapshotReplay(
  saved: readonly AgentChatMessage[],
  replay: readonly AgentChatMessage[],
  inheritedMessageCount = 0
): AgentChatMessage[] {
  if (saved.length === 0 && replay.length === 0) return EMPTY_MESSAGES;
  const restored = saved.slice(0, inheritedMessageCount);
  const savedTurns = splitTurns(saved.slice(inheritedMessageCount));
  let nextSavedTurn = 0;
  for (const replayTurn of splitTurns(replay)) {
    const matching = savedTurns.findIndex(
      (turn, index) =>
        index >= nextSavedTurn &&
        turn[0].sender === replayTurn[0].sender &&
        (turn[0].sender !== USER_SENDER || turn[0].message === replayTurn[0].message)
    );
    if (matching < 0) {
      restored.push(...replayTurn);
      continue;
    }
    restored.push(...savedTurns.slice(nextSavedTurn, matching).flat());
    const local = savedTurns[matching];
    const length = Math.max(local.length, replayTurn.length);
    for (let index = 0; index < length; index++) {
      const savedMessage = local[index];
      const replayMessage = replayTurn[index];
      restored.push(
        savedMessage && replayMessage && savedMessage.sender === replayMessage.sender
          ? mergeMessage(savedMessage, replayMessage)
          : (savedMessage ?? replayMessage)
      );
    }
    nextSavedTurn = matching + 1;
  }
  restored.push(...savedTurns.slice(nextSavedTurn).flat());
  return restored.map(freezeUnconfirmed);
}
