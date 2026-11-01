import { mergeSnapshotReplay } from "@/agentMode/session/sessionSnapshotMessages";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { AI_SENDER, USER_SENDER } from "@/constants";

const message = (sender: string, text: string, id = text): AgentChatMessage => ({
  id,
  sender,
  message: text,
  timestamp: null,
  isVisible: true,
});

describe("sessionSnapshotMessages", () => {
  describe("mergeSnapshotReplay()", () => {
    it("preserves completed local reply metadata when native replay contains the same conversation", () => {
      const saved = [
        message(USER_SENDER, "Question"),
        {
          ...message(AI_SENDER, "Answer"),
          turnDurationMs: 5000,
          turnStopReason: "end_turn" as const,
          content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
        },
      ];
      const replay = [
        message(USER_SENDER, "Question", "new-u"),
        message(AI_SENDER, "Answer", "new-a"),
      ];
      expect(mergeSnapshotReplay(saved, replay)).toEqual(saved);
    });

    it("recovers the completed native answer after a snapshot stopped halfway through the same turn", () => {
      const saved = [
        message(USER_SENDER, "Question"),
        {
          ...message(AI_SENDER, "Half"),
          parts: [
            {
              kind: "tool_call" as const,
              id: "tool",
              title: "Read",
              toolKind: "read" as const,
              status: "in_progress" as const,
            },
          ],
        },
      ];
      const replay = [
        message(USER_SENDER, "Question"),
        {
          ...message(AI_SENDER, "Half and the rest"),
          parts: [
            {
              kind: "tool_call" as const,
              id: "tool",
              title: "Read",
              toolKind: "read" as const,
              status: "completed" as const,
            },
          ],
        },
      ];

      const restored = mergeSnapshotReplay(saved, replay);

      expect(restored[1].message).toBe("Half and the rest");
      expect(restored[1].parts![0]).toMatchObject({ status: "completed" });
      expect(saved[1].parts![0]).toMatchObject({ status: "in_progress" });
    });

    it("keeps a branch prefix once and merges later native turns after it", () => {
      const saved = [
        message(USER_SENDER, "Inherited question"),
        message(AI_SENDER, "Inherited answer"),
      ];
      const replay = [message(USER_SENDER, "New question"), message(AI_SENDER, "New answer")];
      expect(mergeSnapshotReplay(saved, replay, 2).map((entry) => entry.message)).toEqual([
        "Inherited question",
        "Inherited answer",
        "New question",
        "New answer",
      ]);
    });

    it("keeps a locally saved turn that the native transcript has not replayed yet", () => {
      const saved = [
        message(USER_SENDER, "First"),
        message(AI_SENDER, "One"),
        message(USER_SENDER, "Second"),
        message(AI_SENDER, "Two"),
      ];
      expect(mergeSnapshotReplay(saved, saved.slice(0, 2))).toEqual(saved);
    });

    it("updates a branch continuation without duplicating the inherited messages or losing its local attachments", () => {
      const prefix = [message(USER_SENDER, "Inherited"), message(AI_SENDER, "Original answer")];
      const image = { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } };
      const saved = [
        ...prefix,
        { ...message(USER_SENDER, "Follow up", "stable-user"), content: [image] },
        message(AI_SENDER, "Partial", "stable-reply"),
      ];
      const replay = [
        message(USER_SENDER, "Follow up", "native-user"),
        message(AI_SENDER, "Partial and completed", "native-reply"),
      ];
      const restored = mergeSnapshotReplay(saved, replay, 2);
      expect(restored).toHaveLength(4);
      expect(restored[0]).toEqual(prefix[0]);
      expect(restored[2]).toMatchObject({ id: "stable-user", content: [image] });
      expect(restored[3]).toMatchObject({ id: "stable-reply", message: "Partial and completed" });
    });

    it("preserves local refused turns absent from native replay while updating a later matching turn", () => {
      const saved = [
        message(USER_SENDER, "First"),
        message(AI_SENDER, "One"),
        message(USER_SENDER, "Refused"),
        { ...message(AI_SENDER, "Local error"), isErrorMessage: true },
        message(USER_SENDER, "Next"),
        message(AI_SENDER, "Half"),
      ];
      const replay = [
        message(USER_SENDER, "First"),
        message(AI_SENDER, "One"),
        message(USER_SENDER, "Next"),
        message(AI_SENDER, "Half complete"),
      ];
      expect(mergeSnapshotReplay(saved, replay).map((entry) => entry.message)).toEqual([
        "First",
        "One",
        "Refused",
        "Local error",
        "Next",
        "Half complete",
      ]);
    });

    it("preserves completed local durations and stable ids while merging a later native tool result", () => {
      const saved = [
        message(USER_SENDER, "Question", "stable-user"),
        {
          ...message(AI_SENDER, "Answer", "stable-answer"),
          turnDurationMs: 5_000,
          turnStopReason: "end_turn" as const,
          parts: [
            {
              kind: "tool_call" as const,
              id: "tool",
              title: "Read",
              status: "in_progress" as const,
            },
          ],
        },
      ];
      const replay = [
        message(USER_SENDER, "Question", "native-user"),
        {
          ...message(AI_SENDER, "Answer", "native-answer"),
          turnDurationMs: 6_000,
          parts: [
            {
              kind: "tool_call" as const,
              id: "tool",
              title: "Read",
              status: "completed" as const,
              output: [{ type: "text" as const, text: "Read content" }],
            },
          ],
        },
      ];
      const restored = mergeSnapshotReplay(saved, replay);
      expect(restored[1]).toMatchObject({
        id: "stable-answer",
        turnDurationMs: 5_000,
        turnStopReason: "end_turn",
      });
      expect(restored[1].parts![0]).toMatchObject({
        status: "completed",
        output: [{ type: "text", text: "Read content" }],
      });
    });

    it("keeps repeated questions in their original order when native ids differ", () => {
      const saved = [
        message(USER_SENDER, "Again", "u1"),
        message(AI_SENDER, "First answer", "a1"),
        message(USER_SENDER, "Again", "u2"),
        message(AI_SENDER, "Second", "a2"),
      ];
      const replay = [
        message(USER_SENDER, "Again", "native-u1"),
        message(AI_SENDER, "First answer", "native-a1"),
        message(USER_SENDER, "Again", "native-u2"),
        message(AI_SENDER, "Second answer", "native-a2"),
      ];
      const restored = mergeSnapshotReplay(saved, replay);
      expect(restored.map((entry) => entry.id)).toEqual(["u1", "a1", "u2", "a2"]);
      expect(restored[3].message).toBe("Second answer");
    });

    it("keeps late native text after an already completed reply and retains its measured thinking duration", () => {
      const thought = { kind: "thought" as const, text: "Compare notes", durationMs: 2_000 };
      const saved = [
        message(USER_SENDER, "Question"),
        {
          ...message(AI_SENDER, "Done", "stable"),
          turnStopReason: "end_turn" as const,
          turnDurationMs: 5_000,
          parts: [thought, { kind: "text" as const, text: "Done" }],
        },
      ];
      const replay = [
        message(USER_SENDER, "Question", "native-user"),
        {
          ...message(AI_SENDER, "Done and the late result", "native"),
          parts: [
            { ...thought, durationMs: undefined },
            { kind: "text" as const, text: "Done and the late result" },
          ],
        },
      ];
      const restored = mergeSnapshotReplay(saved, replay);
      expect(restored[1]).toMatchObject({
        id: "stable",
        message: "Done and the late result",
        turnDurationMs: 5_000,
      });
      expect(restored[1].parts![0]).toEqual(thought);
    });

    it("settles a saved compaction card without mutating the snapshot or inventing duration", () => {
      const saved = [
        {
          ...message(AI_SENDER, ""),
          parts: [
            {
              kind: "compaction" as const,
              id: "compact",
              status: "in_progress" as const,
              trigger: "auto" as const,
              startedAtMs: 1,
            },
          ],
        },
      ];
      expect(mergeSnapshotReplay(saved, [])[0].parts![0]).toMatchObject({ status: "cancelled" });
      expect(saved[0].parts[0]).toMatchObject({ status: "in_progress" });
    });

    it("returns one stable empty result when neither source has messages", () => {
      expect(mergeSnapshotReplay([], [])).toEqual([]);
      expect(mergeSnapshotReplay([], [])).toBe(mergeSnapshotReplay([], []));
    });

    it("freezes unconfirmed running cards without guessing a missing elapsed time", () => {
      const saved = [
        {
          ...message(AI_SENDER, "Working"),
          parts: [
            {
              kind: "tool_call" as const,
              id: "tool",
              title: "Read",
              toolKind: "read" as const,
              status: "in_progress" as const,
            },
          ],
        },
      ];
      const restored = mergeSnapshotReplay(saved, []);
      expect(restored[0].parts![0]).toMatchObject({ status: "cancelled" });
      expect(restored[0].turnDurationMs).toBeUndefined();
    });
  });
});
