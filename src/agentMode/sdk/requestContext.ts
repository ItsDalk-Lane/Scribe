import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Tool } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { fingerprintRequestContext } from "@/agentMode/session/requestContextFingerprint";

export interface RequestContextMessage {
  fingerprint: string;
  seq?: number;
  message?: AgentMessage;
}

export interface RequestContextTool {
  name: string;
  description: string;
  parameters: Tool["parameters"];
}

export interface RequestContextSnapshot {
  version: 1;
  fingerprint: string;
  messages: RequestContextMessage[];
  tools: RequestContextTool[];
}

const EMPTY_USAGE = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }),
});

export function buildRequestContextSnapshot(
  messages: readonly AgentMessage[],
  tools: readonly RequestContextTool[],
  messageSeqs: WeakMap<object, number>,
  sourceDigests?: ReadonlyMap<number, string>
): RequestContextSnapshot {
  const snapshot = {
    version: 1 as const,
    messages: messages.map((message): RequestContextMessage => {
      // 工具原件另有可靠记录，请求快照只保存模型会收到的正文，避免反复保存未裁剪原文或私有展示元数据。https://github.com/ItsDalk-Lane/Scribe/issues/71
      const input =
        message.role === "toolResult"
          ? {
              role: message.role,
              toolCallId: message.toolCallId,
              toolName: message.toolName,
              content: message.content,
              isError: message.isError,
              timestamp: message.timestamp,
            }
          : message;
      const fingerprint = fingerprintRequestContext(input);
      const seq = messageSeqs.get(message);
      return message.role !== "system" &&
        seq !== undefined &&
        sourceDigests?.get(seq) === fingerprint
        ? { fingerprint, seq }
        : { fingerprint, message: JSON.parse(JSON.stringify(input)) as AgentMessage };
    }),
    tools: JSON.parse(
      JSON.stringify(
        tools.map(({ name, description, parameters }) => ({ name, description, parameters }))
      )
    ) as RequestContextTool[],
  };
  return { ...snapshot, fingerprint: fingerprintRequestContext(snapshot) };
}

export function estimateCurrentContextTokens(
  messages: readonly AgentMessage[],
  version: string,
  usageVersions: WeakMap<object, string>
): number {
  return estimateContextTokens(
    messages.map((message) =>
      message.role === "assistant" && usageVersions.get(message) !== version
        ? { ...message, usage: EMPTY_USAGE }
        : message
    )
  ).tokens;
}
