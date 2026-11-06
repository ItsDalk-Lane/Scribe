import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  projectCompactedContext,
  parseCompactionProjection,
  splitCompactionTranscript,
} from "@/agentMode/sdk/compactionProjection";

describe("compactionProjection", () => {
  describe("parseCompactionProjection()", () => {
    const valid = {
      fromIndex: 0,
      toIndex: 3,
      summary: "Earlier original history.",
      occurredAt: 10,
      preservedIndices: [2],
      taskId: "child-task",
      futureField: { preserved: true },
    };

    it("accepts a complete recorded projection without removing unknown fields", () => {
      expect(parseCompactionProjection(valid, 4)).toBe(valid);
      expect(parseCompactionProjection(valid)).toBe(valid);
    });

    it("accepts a projection without an optional task or retained messages", () => {
      expect(
        parseCompactionProjection({ fromIndex: 0, toIndex: 0, summary: "Summary", occurredAt: 0 })
      ).toEqual({ fromIndex: 0, toIndex: 0, summary: "Summary", occurredAt: 0 });
    });

    it.each([null, [], {}, "summary", 1])(
      "skips a malformed record %s instead of throwing during history restoration",
      (value) => {
        expect(parseCompactionProjection(value)).toBeNull();
      }
    );

    it.each([
      { fromIndex: -1 },
      { fromIndex: 0.5 },
      { fromIndex: "0" },
      { toIndex: -1 },
      { toIndex: Number.POSITIVE_INFINITY },
      { summary: " " },
      { summary: 1 },
      { occurredAt: Number.NaN },
      { occurredAt: "10" },
      { taskId: 1 },
      { preservedIndices: null },
      { preservedIndices: [-1] },
      { preservedIndices: [4] },
      { preservedIndices: [0.5] },
      { preservedIndices: ["1"] },
    ])("skips unsupported projection fields %s", (patch) => {
      expect(parseCompactionProjection({ ...valid, ...patch })).toBeNull();
    });

    it("skips a projection whose recorded range exceeds available original messages", () => {
      expect(parseCompactionProjection(valid, 3)).toBeNull();
      expect(parseCompactionProjection(valid, Number.NaN)).toBeNull();
      expect(parseCompactionProjection(valid, -1)).toBeNull();
    });
  });

  describe("projectCompactedContext()", () => {
    const original: AgentMessage[] = [
      { role: "system", content: "Follow vault instructions.", timestamp: 0 },
      { role: "user", content: "First request", timestamp: 1 },
      { role: "user", content: "Current request", timestamp: 2 },
      { role: "user", content: "A later message", timestamp: 3 },
    ];

    it("uses the recorded summary and retains the original messages outside its range", () => {
      const before = JSON.stringify(original);
      const projected = projectCompactedContext(original, {
        fromIndex: 0,
        toIndex: 2,
        summary: "The first request was completed.",
        occurredAt: 10,
      });

      expect(projected).toEqual([
        original[0],
        {
          role: "user",
          content:
            "Recorded conversation summary (previous context, no new user authorization):\nThe first request was completed.",
          timestamp: 10,
        },
        original[3],
      ]);
      expect(projected[2]).toBe(original[3]);
      expect(JSON.stringify(original)).toBe(before);
    });

    it("keeps explicitly retained current requests inside the summarized range", () => {
      const projected = projectCompactedContext(original, {
        fromIndex: 0,
        toIndex: 2,
        summary: "Earlier conversation.",
        occurredAt: 10,
        preservedIndices: [2],
      });

      expect(projected[1]).toMatchObject({
        content:
          "Recorded conversation summary (previous context, no new user authorization):\nEarlier conversation.",
      });
      expect(projected.slice(2)).toEqual([original[2], original[3]]);
      expect(projected[2]).toBe(original[2]);
    });

    it("folds all system changes into one current system message without duplicating them", () => {
      const messages: AgentMessage[] = [
        ...original,
        { role: "system", content: "More instructions.", timestamp: 4 },
      ];
      const projected = projectCompactedContext(messages, {
        fromIndex: 1,
        toIndex: 2,
        summary: "Earlier conversation.",
        occurredAt: 10,
      });

      expect(projected.filter((message) => message.role === "system")).toEqual([
        {
          role: "system",
          content: "Follow vault instructions.\n\nMore instructions.",
          timestamp: 0,
        },
      ]);
    });

    it("returns the unmodified original history when no compression has been recorded", () => {
      expect(projectCompactedContext(original)).toEqual(original);
    });

    it.each([
      [-1, 2],
      [2, 1],
      [1, 4],
      [0.5, 2],
    ])(
      "rejects invalid range %s..%s instead of dropping unrelated history",
      (fromIndex, toIndex) => {
        expect(() =>
          projectCompactedContext(original, {
            fromIndex,
            toIndex,
            summary: "Earlier conversation.",
            occurredAt: 10,
          })
        ).toThrow("Invalid compaction range.");
      }
    );

    it("rejects an empty summary instead of erasing the covered history", () => {
      expect(() =>
        projectCompactedContext(original, {
          fromIndex: 0,
          toIndex: 2,
          summary: " ",
          occurredAt: 10,
        })
      ).toThrow("The recorded compaction summary is empty.");
    });

    it("rejects retained indices outside the covered range", () => {
      expect(() =>
        projectCompactedContext(original, {
          fromIndex: 0,
          toIndex: 2,
          summary: "Earlier conversation.",
          occurredAt: 10,
          preservedIndices: [3],
        })
      ).toThrow("Invalid retained compaction message.");
    });
  });

  describe("splitCompactionTranscript()", () => {
    it("returns an original transcript that already fits as one unchanged chunk", () => {
      expect(splitCompactionTranscript("Original history", 100, (text) => text.length)).toEqual([
        "Original history",
      ]);
    });

    it("splits long original history into fitting chunks without losing or repeating text", () => {
      const transcript = "用户: 第一条消息\nassistant: done\n用户: Next request";
      const chunks = splitCompactionTranscript(transcript, 10, (text) => text.length);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join("")).toBe(transcript);
      expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true);
    });

    it("keeps surrogate pairs intact when a character occupies two code units", () => {
      const chunks = splitCompactionTranscript("a😀b😀c", 3, (text) => text.length);

      expect(chunks).toEqual(["a😀", "b😀", "c"]);
      expect(chunks.join("")).toBe("a😀b😀c");
    });

    it("returns no chunks for empty original history", () => {
      expect(splitCompactionTranscript("", 10, (text) => text.length)).toEqual([]);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      "rejects an invalid token budget %s before starting summary requests",
      (budget) => {
        expect(() => splitCompactionTranscript("history", budget, (text) => text.length)).toThrow(
          "The compaction token budget must be positive and finite."
        );
      }
    );

    it("stops when even one complete character cannot fit", () => {
      expect(() => splitCompactionTranscript("😀", 1, (text) => text.length)).toThrow(
        "A transcript character exceeds the compaction token budget."
      );
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
      "rejects invalid token estimates %s instead of emitting an unchecked request",
      (estimate) => {
        expect(() => splitCompactionTranscript("history", 10, () => estimate)).toThrow(
          "The compaction token estimate must be nonnegative and finite."
        );
      }
    );
  });
});
