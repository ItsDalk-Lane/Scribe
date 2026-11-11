import type { RequestContextPreview } from "@/agentMode/session/types";
import {
  fingerprintRequestContext,
  serializeRequestContext,
} from "@/agentMode/session/requestContextFingerprint";
import { isRecord } from "@/utils/obsidianInternals";

export interface RequestContextPreviewFact {
  seq: number;
  kind: string;
  payload: unknown;
}

export function readRequestContextPreview(
  records: readonly RequestContextPreviewFact[]
): RequestContextPreview | null {
  const fact = records.findLast(
    (record) =>
      record.kind === "request_context" &&
      isRecord(record.payload) &&
      record.payload.purpose === "chat" &&
      !record.payload.subagentId
  );
  if (!fact) return null;
  const payload = fact.payload;
  const invalid = "The recorded request is incomplete or damaged. Its saved input cannot be shown.";
  if (
    !isRecord(payload) ||
    payload.version !== 1 ||
    typeof payload.requestId !== "string" ||
    typeof payload.modelId !== "string" ||
    typeof payload.provider !== "string" ||
    !isRecord(payload.snapshot)
  )
    throw new Error(invalid);
  const snapshot = payload.snapshot;
  if (
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.messages) ||
    !Array.isArray(snapshot.tools) ||
    fingerprintRequestContext({
      version: snapshot.version,
      messages: snapshot.messages,
      tools: snapshot.tools,
    }) !== snapshot.fingerprint
  )
    throw new Error(invalid);
  const sourceMessages = new Map(
    records.flatMap((record) =>
      record.kind === "protocol_message" &&
      isRecord(record.payload) &&
      isRecord(record.payload.message)
        ? [[record.seq, record.payload.message] as const]
        : []
    )
  );
  const messages = snapshot.messages.map((entry: unknown) => {
    if (!isRecord(entry)) throw new Error(invalid);
    const message = typeof entry.seq === "number" ? sourceMessages.get(entry.seq) : entry.message;
    if (!isRecord(message) || fingerprintRequestContext(message) !== entry.fingerprint)
      throw new Error(invalid);
    return message;
  });
  return {
    requestId: payload.requestId,
    modelId: payload.modelId,
    provider: payload.provider,
    content: JSON.stringify(
      JSON.parse(serializeRequestContext({ messages, tools: snapshot.tools })),
      null,
      2
    ),
  };
}
