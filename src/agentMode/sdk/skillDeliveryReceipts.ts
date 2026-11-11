import type { JournalRecord } from "@/agentMode/sdk/JournalStorage";
import {
  projectDeliveredSkillPages,
  type DeliveredSkillPage,
} from "@/agentMode/sdk/skillDeliveryProjection";
import { isRecord } from "@/utils/obsidianInternals";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export function recoverConfirmedSkillPages(records: readonly JournalRecord[]): {
  pages: DeliveredSkillPage[];
  invalidReceipts: number[];
} {
  const bySeq = new Map<number, JournalRecord>();
  const duplicates = new Set<number>();
  const pages: DeliveredSkillPage[] = [];
  const invalidReceipts: number[] = [];
  const resets = new Map<string, number>();
  const revoked = new Map<string, number>();
  const seen = new Set<string>();
  const resultSequences = new Map<DeliveredSkillPage, number>();
  for (const record of records) {
    if (bySeq.has(record.seq)) duplicates.add(record.seq);
    bySeq.set(record.seq, record);
  }
  for (const receipt of [...records].sort((a, b) => a.seq - b.seq)) {
    if (receipt.kind === "skill_model_skill_revoked") {
      const value = receipt.payload;
      if (
        !isRecord(value) ||
        value.formatVersion !== 1 ||
        typeof value.scope !== "string" ||
        !value.scope ||
        typeof value.name !== "string" ||
        !value.name ||
        duplicates.has(receipt.seq) ||
        (value.throughSeq !== undefined &&
          (!Number.isSafeInteger(value.throughSeq) ||
            typeof value.throughSeq !== "number" ||
            value.throughSeq < 0 ||
            value.throughSeq >= receipt.seq))
      ) {
        invalidReceipts.push(receipt.seq);
        continue;
      }
      const throughSeq = typeof value.throughSeq === "number" ? value.throughSeq : receipt.seq;
      const key = JSON.stringify([value.scope, value.name]);
      revoked.set(key, Math.max(revoked.get(key) ?? 0, throughSeq));
      for (let index = pages.length - 1; index >= 0; index--)
        if (
          pages[index].scope === value.scope &&
          pages[index].name === value.name &&
          (resultSequences.get(pages[index]) ?? 0) <= throughSeq
        )
          pages.splice(index, 1);
      continue;
    }
    if (receipt.kind === "skill_model_scope_reset") {
      if (
        !isRecord(receipt.payload) ||
        receipt.payload.formatVersion !== 1 ||
        typeof receipt.payload.scope !== "string" ||
        !receipt.payload.scope ||
        duplicates.has(receipt.seq)
      ) {
        invalidReceipts.push(receipt.seq);
        continue;
      }
      resets.set(receipt.payload.scope, receipt.seq);
      for (let index = pages.length - 1; index >= 0; index--)
        if (pages[index].scope === receipt.payload.scope) pages.splice(index, 1);
      continue;
    }
    if (receipt.kind !== "skill_model_delivery") continue;
    const value = receipt.payload;
    if (
      !isRecord(value) ||
      value.formatVersion !== 2 ||
      typeof value.scope !== "string" ||
      !value.scope ||
      !Number.isSafeInteger(value.callSeq) ||
      !Number.isSafeInteger(value.resultSeq) ||
      typeof value.callSeq !== "number" ||
      typeof value.resultSeq !== "number" ||
      value.callSeq <= 0 ||
      value.callSeq >= value.resultSeq ||
      value.resultSeq >= receipt.seq ||
      duplicates.has(value.callSeq) ||
      duplicates.has(value.resultSeq) ||
      duplicates.has(receipt.seq)
    ) {
      invalidReceipts.push(receipt.seq);
      continue;
    }
    const call = bySeq.get(value.callSeq);
    const result = bySeq.get(value.resultSeq);
    if ((resets.get(value.scope) ?? 0) >= value.resultSeq) continue;
    const expectedTask = value.scope === "main" ? undefined : value.scope;
    if (
      !call ||
      !result ||
      call.kind !== "protocol_message" ||
      result.kind !== "tool_result" ||
      !isRecord(call.payload) ||
      !isRecord(result.payload) ||
      call.payload.taskId !== expectedTask ||
      result.payload.taskId !== expectedTask ||
      !isRecord(call.payload.message) ||
      !isRecord(result.payload.message) ||
      call.payload.message.role !== "assistant" ||
      !Array.isArray(call.payload.message.content) ||
      !call.payload.message.content.every(isRecord) ||
      result.payload.message.role !== "toolResult" ||
      typeof result.payload.message.toolCallId !== "string" ||
      !Array.isArray(result.payload.message.content) ||
      !result.payload.message.content.every(
        (part: unknown) => isRecord(part) && part.type === "text" && typeof part.text === "string"
      )
    ) {
      invalidReceipts.push(receipt.seq);
      continue;
    }
    const recovered = projectDeliveredSkillPages(
      [
        call.payload.message as unknown as AgentMessage,
        result.payload.message as unknown as AgentMessage,
      ],
      value.scope
    );
    if (recovered.length !== 1) invalidReceipts.push(receipt.seq);
    else {
      const page = { ...recovered[0], callSeq: value.callSeq, resultSeq: value.resultSeq };
      const identity = JSON.stringify([value.scope, value.resultSeq]);
      if (
        (revoked.get(JSON.stringify([value.scope, page.name])) ?? 0) >= value.resultSeq ||
        seen.has(identity)
      )
        continue;
      seen.add(identity);
      resultSequences.set(page, value.resultSeq);
      pages.push(page);
    }
  }
  return { pages, invalidReceipts };
}
