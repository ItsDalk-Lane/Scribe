import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { JsonObject } from "@earendil-works/pi-ai";
import {
  estimateTextAndImageContentTokens,
  estimateTextTokens,
} from "@earendil-works/pi-ai/utils/estimate";
import { sha256 } from "@/utils/hash";
import { isRecord } from "@/utils/obsidianInternals";

export type ToolExecutionStatus =
  | "not_started"
  | "completed"
  | "failed"
  | "partial"
  | "outcome_unknown"
  | "running";
export type ToolRetryDisposition = "safe" | "verify_before_retry" | "never";
export interface ToolExecutionFacts {
  status: ToolExecutionStatus;
  retry: ToolRetryDisposition;
  complete?: boolean;
  truncated?: boolean;
}
export interface ToolResultIdentity {
  scope: string;
  toolCallId: string;
}
export interface ToolResultProjectionBudget {
  maxTokens: number;
  remainingTokens: number;
}
export interface ToolTextPage {
  text: string;
  truncated: boolean;
  nextCursor?: string;
  offset: number;
  end: number;
  fingerprint: string;
  totalCharacters: number;
}

function resultDetails(result: AgentToolResult): JsonObject {
  const details = result.details;
  return isRecord(details) ? details : details === undefined ? {} : { value: details };
}

// 只把执行确定性送入模型，原展示字段不能丢失或被当作模型指令。https://github.com/ItsDalk-Lane/Scribe/issues/70
export function withToolExecution(
  result: AgentToolResult,
  facts: ToolExecutionFacts
): AgentToolResult {
  return {
    ...result,
    content: [
      { type: "text", text: `<tool_execution>\n${JSON.stringify(facts)}\n</tool_execution>` },
      ...result.content,
    ],
    details: { ...resultDetails(result), execution: { ...facts } },
    isError:
      result.isError === true ||
      ["not_started", "failed", "outcome_unknown"].includes(facts.status),
  };
}

// 程序化结果可能含模型唯一需要的数据；私有展示元信息仍留在details。https://github.com/ItsDalk-Lane/Scribe/issues/70
function publicContent(result: AgentToolResult): AgentToolResult["content"] {
  // 已选择的页只代表那一段正文；schema原值保留用于校验，不能再次拼回完整数据。https://github.com/ItsDalk-Lane/Scribe/issues/70
  if (isRecord(result.details) && isRecord(result.details.outputProjection)) return result.content;
  if (result.structuredContent === undefined) return result.content;
  const value = JSON.stringify(result.structuredContent);
  const rendered = `<structured_content>\n${value}\n</structured_content>`;
  const mcpRendered = `<mcp_structured_content>\n${value}\n</mcp_structured_content>`;
  return result.content.some(
    (part) => part.type === "text" && [value, rendered, mcpRendered].includes(part.text)
  )
    ? result.content
    : [...result.content, { type: "text", text: rendered }];
}

function safeTextEnd(text: string, start: number, length: number): number {
  let end = Math.min(text.length, start + length);
  // 截页不能拆开代理对，否则模型看到的正文与原件不同。https://github.com/ItsDalk-Lane/Scribe/issues/70
  if (
    end < text.length &&
    /[\uD800-\uDBFF]/.test(text[end - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[end])
  )
    end--;
  return end;
}

// 续页只能拼接同一资源的同一正文版本，不能把新旧文件混成完整读取。https://github.com/ItsDalk-Lane/Scribe/issues/70
export function pageToolText(
  text: string,
  identity: string,
  cursor?: string,
  maxCharacters = 20000
): ToolTextPage {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1)
    throw new Error("Invalid text page size.");
  const fingerprint = sha256(JSON.stringify([identity, text]));
  const match = cursor?.match(/^(\d+):([a-f0-9]{64})$/);
  if (cursor && (!match || match[2] !== fingerprint))
    throw new Error("Tool content changed or the continuation cursor is invalid; start again.");
  const offset = match ? Number(match[1]) : 0;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (cursor && offset >= text.length) ||
    (offset > 0 && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]))
  )
    throw new Error("Invalid text page cursor.");
  const end = safeTextEnd(text, offset, maxCharacters);
  if (end === offset && offset < text.length)
    throw new Error("The text page size cannot fit the next character; increase the page size.");
  const truncated = end < text.length;
  const nextCursor = truncated ? `${end}:${fingerprint}` : undefined;
  return {
    text:
      text.slice(offset, end) +
      (nextCursor ? `\n\n[Output truncated]\nContinue with cursor: ${nextCursor}` : ""),
    truncated,
    ...(nextCursor ? { nextCursor } : {}),
    offset,
    end,
    fingerprint,
    totalCharacters: text.length,
  };
}

// 截断只改变模型副本；可靠原件和续读身份必须保留，否则任务会静默漏读。https://github.com/ItsDalk-Lane/Scribe/issues/70
function resultPage(
  result: AgentToolResult,
  identity: ToolResultIdentity,
  cursor: string | undefined,
  tokenLimit: number,
  allowEmpty: boolean
): AgentToolResult {
  const content = publicContent(result);
  const execution = resultDetails(result).execution;
  const fingerprint = sha256(JSON.stringify([identity, content, result.isError, execution]));
  const match = cursor?.match(/^(\d+):(\d+):([a-f0-9]{64})$/);
  if (cursor && (!match || match[3] !== fingerprint))
    throw new Error(
      "Tool result changed or the continuation cursor belongs to another result; start again."
    );
  let block = match ? Number(match[1]) : 0;
  let offset = match ? Number(match[2]) : 0;
  const first = content[block];
  if (
    !Number.isSafeInteger(block) ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (cursor && (!first || (first.type === "image" ? offset !== 0 : offset >= first.text.length))) ||
    (first?.type === "text" &&
      offset > 0 &&
      /[\uD800-\uDBFF]/.test(first.text[offset - 1]) &&
      /[\uDC00-\uDFFF]/.test(first.text[offset]))
  )
    throw new Error("Invalid tool result page cursor.");
  const remaining = content
    .slice(block)
    .map((part, index) =>
      index === 0 && part.type === "text" && offset > 0
        ? { ...part, text: part.text.slice(offset) }
        : part
    );
  if (estimateTextAndImageContentTokens(remaining) <= tokenLimit)
    return {
      ...result,
      content: remaining,
      details: {
        ...resultDetails(result),
        outputProjection: { truncated: false, ...identity, fingerprint },
      },
    };
  const facts = isRecord(execution)
    ? { status: execution.status, retry: execution.retry, complete: execution.complete }
    : undefined;
  const notice = (next: string): string =>
    `[Output truncated; content_complete=false${facts ? `; execution=${JSON.stringify(facts)}` : ""}]\nContinue with read_tool_result ${JSON.stringify({ tool_call_id: identity.toolCallId, cursor: next })}`;
  const longestOffset = content.reduce(
    (maximum, part) => (part.type === "text" ? Math.max(maximum, part.text.length) : maximum),
    0
  );
  const reserved = estimateTextTokens(notice(`${content.length}:${longestOffset}:${fingerprint}`));
  const available = tokenLimit - reserved;
  // 已完成操作不能因通知预算耗尽而变成执行失败；批次入口负责补总省略提示。https://github.com/ItsDalk-Lane/Scribe/issues/70
  if (available < 0) {
    if (!allowEmpty)
      throw new Error(
        "The tool result page budget cannot fit a recovery notice; increase maxCharacters."
      );
    return {
      ...result,
      content: [],
      details: {
        ...resultDetails(result),
        outputProjection: {
          truncated: true,
          ...identity,
          fingerprint,
          nextCursor: `${block}:${offset}:${fingerprint}`,
          noticeOmitted: true,
        },
      },
    };
  }
  const selected: AgentToolResult["content"] = [];
  while (block < content.length) {
    const part = content[block];
    if (part.type === "image") {
      if (estimateTextAndImageContentTokens([...selected, part]) > available) break;
      selected.push(part);
      block++;
      continue;
    }
    const text = part.text.slice(offset);
    if (estimateTextAndImageContentTokens([...selected, { ...part, text }]) <= available) {
      selected.push({ ...part, text });
      block++;
      offset = 0;
      continue;
    }
    let low = 0;
    let high = text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (
        estimateTextAndImageContentTokens([
          ...selected,
          { ...part, text: text.slice(0, middle) },
        ]) <= available
      )
        low = middle;
      else high = middle - 1;
    }
    const end = safeTextEnd(part.text, offset, low);
    if (end > offset) selected.push({ ...part, text: part.text.slice(offset, end) });
    offset = end;
    break;
  }
  // 续读必须推进；普通投影可以只给可靠入口，但不能让续读陷入原地循环。https://github.com/ItsDalk-Lane/Scribe/issues/70
  if (!allowEmpty && selected.length === 0)
    throw new Error(
      "The tool result page budget cannot fit the next content block; increase maxCharacters."
    );
  const nextCursor = `${block}:${offset}:${fingerprint}`;
  selected.push({ type: "text", text: notice(nextCursor) });
  return {
    ...result,
    content: selected,
    details: {
      ...resultDetails(result),
      outputProjection: { truncated: true, ...identity, fingerprint, nextCursor },
    },
  };
}

export function projectToolResult(
  result: AgentToolResult,
  identity: ToolResultIdentity,
  budget: ToolResultProjectionBudget
): AgentToolResult {
  if (
    !Number.isSafeInteger(budget.maxTokens) ||
    !Number.isSafeInteger(budget.remainingTokens) ||
    budget.maxTokens < 0 ||
    budget.remainingTokens < 0
  )
    throw new Error("Invalid tool result budget.");
  const maximum = Math.min(budget.maxTokens, budget.remainingTokens);
  const projected = resultPage(result, identity, undefined, maximum, true);
  budget.remainingTokens -= estimateTextAndImageContentTokens(projected.content);
  return projected;
}

export function readToolResultPage(
  result: AgentToolResult,
  identity: ToolResultIdentity,
  cursor?: string,
  maxCharacters = 20000
): AgentToolResult {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1)
    throw new Error("Invalid tool result page size.");
  return resultPage(result, identity, cursor, estimateTextTokens("x".repeat(maxCharacters)), false);
}
