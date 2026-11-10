import type { JournalRecord } from "@/agentMode/sdk/JournalStorage";
import { recoverConfirmedSkillPages } from "@/agentMode/sdk/skillDeliveryReceipts";

describe("skillDeliveryReceipts", () => {
  describe("recoverConfirmedSkillPages()", () => {
    function fact(seq: number, kind: string, payload: unknown): JournalRecord {
      return { version: 2, seq, kind, payload, origin: "observed", occurredAt: 1 };
    }
    const call = fact(1, "protocol_message", {
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "c1", name: "invoke_skill", arguments: { name: "notes" } },
        ],
      },
    });
    const result = fact(2, "tool_result", {
      message: {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "invoke_skill",
        isError: false,
        content: [{ type: "text", text: "Saved instructions" }],
        details: { name: "notes", truncated: false },
      },
    });
    const confirmed = fact(3, "skill_model_delivery", {
      formatVersion: 2,
      scope: "main",
      callSeq: 1,
      resultSeq: 2,
    });

    it("restores the exact confirmed page by its two original journal positions https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const recovered = recoverConfirmedSkillPages([call, result, confirmed]);
      expect(recovered.invalidReceipts).toEqual([]);
      expect(recovered.pages).toEqual([
        expect.objectContaining({
          scope: "main",
          name: "notes",
          text: "Saved instructions",
          toolCallId: "c1",
          offset: 0,
        }),
      ]);
      expect(JSON.stringify(confirmed)).not.toContain("Saved instructions");
    });

    it("does not treat an unconfirmed tool result as delivered https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      expect(recoverConfirmedSkillPages([call, result])).toEqual({
        pages: [],
        invalidReceipts: [],
      });
    });

    it("does not duplicate a page when the same original result is confirmed twice https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const repeated = fact(4, "skill_model_delivery", {
        formatVersion: 2,
        scope: "main",
        callSeq: 1,
        resultSeq: 2,
      });
      expect(recoverConfirmedSkillPages([call, result, confirmed, repeated]).pages).toHaveLength(1);
    });

    it("reports a missing original result instead of reconstructing or executing it https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      expect(recoverConfirmedSkillPages([call, confirmed])).toEqual({
        pages: [],
        invalidReceipts: [3],
      });
    });

    it("rejects wrong scope and confirmations preceding their original result https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const wrongScope = fact(3, "skill_model_delivery", {
        formatVersion: 2,
        scope: "other-task",
        callSeq: 1,
        resultSeq: 2,
      });
      const early = fact(1, "skill_model_delivery", {
        formatVersion: 2,
        scope: "main",
        callSeq: 1,
        resultSeq: 2,
      });
      expect(recoverConfirmedSkillPages([call, result, wrongScope]).invalidReceipts).toEqual([3]);
      expect(recoverConfirmedSkillPages([early, call, result]).invalidReceipts).toEqual([1]);
    });

    it("restores a child page only for the matching recorded child run https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const childCall = fact(1, "protocol_message", {
        ...(call.payload as object),
        taskId: "child-run",
      });
      const childResult = fact(2, "tool_result", {
        ...(result.payload as object),
        taskId: "child-run",
      });
      const childReceipt = fact(3, "skill_model_delivery", {
        formatVersion: 2,
        scope: "child-run",
        callSeq: 1,
        resultSeq: 2,
      });
      const recovered = recoverConfirmedSkillPages([childCall, childResult, childReceipt]);
      expect(recovered.invalidReceipts).toEqual([]);
      expect(recovered.pages).toEqual([
        expect.objectContaining({ scope: "child-run", name: "notes", text: "Saved instructions" }),
      ]);
    });

    it("does not pair an error or an unrelated tool call with a confirmed result https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const error = fact(2, "tool_result", {
        message: { ...(result.payload as { message: object }).message, isError: true },
      });
      expect(recoverConfirmedSkillPages([call, error, confirmed])).toEqual({
        pages: [],
        invalidReceipts: [3],
      });
    });

    it("does not reactivate an old result after an independent task starts https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const reset = fact(4, "skill_model_scope_reset", { formatVersion: 1, scope: "main" });
      const replayed = fact(5, "skill_model_delivery", {
        formatVersion: 2,
        scope: "main",
        callSeq: 1,
        resultSeq: 2,
      });
      expect(recoverConfirmedSkillPages([call, result, confirmed, reset, replayed])).toEqual({
        pages: [],
        invalidReceipts: [],
      });
    });

    it("does not revive a revoked skill when the old result is confirmed again https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const revoke = fact(4, "skill_model_skill_revoked", {
        formatVersion: 1,
        scope: "main",
        name: "notes",
      });
      const replayed = fact(5, "skill_model_delivery", {
        formatVersion: 2,
        scope: "main",
        callSeq: 1,
        resultSeq: 2,
      });
      expect(recoverConfirmedSkillPages([call, result, confirmed, revoke, replayed])).toEqual({
        pages: [],
        invalidReceipts: [],
      });
    });

    it("preserves a newer confirmed version when an earlier version is revoked https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const newCall = fact(4, "protocol_message", {
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "c2", name: "invoke_skill", arguments: { name: "notes" } },
          ],
        },
      });
      const newResult = fact(5, "tool_result", {
        message: {
          role: "toolResult",
          toolCallId: "c2",
          toolName: "invoke_skill",
          isError: false,
          content: [{ type: "text", text: "New instructions" }],
          details: { name: "notes", truncated: false },
        },
      });
      const newReceipt = fact(6, "skill_model_delivery", {
        formatVersion: 2,
        scope: "main",
        callSeq: 4,
        resultSeq: 5,
      });
      const revokeOld = fact(7, "skill_model_skill_revoked", {
        formatVersion: 1,
        scope: "main",
        name: "notes",
        throughSeq: 2,
      });
      expect(
        recoverConfirmedSkillPages([
          call,
          result,
          confirmed,
          newCall,
          newResult,
          newReceipt,
          revokeOld,
        ]).pages
      ).toEqual([expect.objectContaining({ text: "New instructions" })]);
    });

    it("reports a damaged skill revocation instead of trusting previous deliveries https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const revoke = fact(4, "skill_model_skill_revoked", { formatVersion: 1, scope: "main" });
      expect(
        recoverConfirmedSkillPages([call, result, confirmed, revoke]).invalidReceipts
      ).toContain(4);
    });

    it("reports a malformed independent-task barrier instead of trusting its history https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const broken = fact(4, "skill_model_scope_reset", { formatVersion: 1 });
      const recovered = recoverConfirmedSkillPages([call, result, confirmed, broken]);
      expect(recovered.invalidReceipts).toContain(4);
    });

    it("does not recover a removed child's receipt when its source records are gone https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const orphan = fact(3, "skill_model_delivery", {
        formatVersion: 2,
        scope: "child-run",
        callSeq: 1,
        resultSeq: 2,
      });
      expect(recoverConfirmedSkillPages([orphan])).toEqual({ pages: [], invalidReceipts: [3] });
    });

    it("reports a malformed source without attempting to interpret or execute it https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const malformed = fact(1, "protocol_message", {
        message: { role: "assistant", content: [null] },
      });
      expect(recoverConfirmedSkillPages([malformed, result, confirmed])).toEqual({
        pages: [],
        invalidReceipts: [3],
      });
    });
  });
});
