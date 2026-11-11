import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { estimateTextAndImageContentTokens } from "@earendil-works/pi-ai/utils/estimate";
import {
  withToolExecution,
  projectToolResult,
  readToolResultPage,
  pageToolText,
} from "@/utils/toolResultProjection";

const identity = { scope: "main", toolCallId: "call-1" };
const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/70";
const result = (text: string): AgentToolResult => ({
  content: [{ type: "text", text }],
  details: { path: "notes/source.md" },
});

describe("toolResultProjection", () => {
  describe("withToolExecution()", () => {
    it(`keeps existing details and makes execution certainty visible to the model ${issue}`, () => {
      const original = result("Saved text");
      const actual = withToolExecution(original, {
        status: "outcome_unknown",
        retry: "verify_before_retry",
        complete: false,
      });
      expect(actual.details).toEqual({
        path: "notes/source.md",
        execution: { status: "outcome_unknown", retry: "verify_before_retry", complete: false },
      });
      expect(JSON.stringify(actual.content)).toContain("verify_before_retry");
      expect(actual.isError).toBe(true);
      expect(original).toEqual(result("Saved text"));
    });
    it(`preserves scalar details and output-schema data without exposing private details ${issue}`, () => {
      const actual = withToolExecution(
        {
          content: [{ type: "text", text: "Done" }],
          details: "private metadata",
          structuredContent: { answer: 42 },
        },
        { status: "completed", retry: "never" }
      );
      expect(actual.details).toMatchObject({ value: "private metadata" });
      expect(actual.structuredContent).toEqual({ answer: 42 });
      expect(JSON.stringify(actual.content)).not.toContain("private metadata");
    });
  });
  describe("projectToolResult()", () => {
    it(`does not render the original structured value again after a continuation page was selected ${issue}`, () => {
      const original: AgentToolResult = {
        content: [],
        details: undefined,
        structuredContent: { value: "UNIQUE_START_" + "x".repeat(3000) + "_UNIQUE_END" },
      };
      const first = readToolResultPage(original, identity, undefined, 1000);
      const cursor = (first.details as { outputProjection: { nextCursor: string } })
        .outputProjection.nextCursor;
      const second = readToolResultPage(original, identity, cursor, 20000);
      expect(JSON.stringify(second.content)).not.toContain("UNIQUE_START_");
      const projected = projectToolResult(
        second,
        { ...identity, toolCallId: "read-page" },
        { maxTokens: 8000, remainingTokens: 24000 }
      );
      expect(projected.content).toEqual(second.content);
      expect(JSON.stringify(projected.content)).not.toContain("UNIQUE_START_");
      expect(projected.structuredContent).toEqual(original.structuredContent);
    });

    it(`keeps a fitting result intact and synchronously accounts for its tokens ${issue}`, () => {
      const original = result("Short answer");
      const budget = { maxTokens: 100, remainingTokens: 100 };
      const actual = projectToolResult(original, identity, budget);
      expect(actual.content).toEqual(original.content);
      expect(budget.remainingTokens).toBe(100 - estimateTextAndImageContentTokens(actual.content));
    });
    it(`bounds the model copy and its recovery notice while preserving the full canonical result ${issue}`, () => {
      const original = result("Long answer ".repeat(1000));
      const budget = { maxTokens: 150, remainingTokens: 200 };
      const actual = projectToolResult(original, identity, budget);
      expect(estimateTextAndImageContentTokens(actual.content)).toBeLessThanOrEqual(150);
      expect(budget.remainingTokens).toBe(200 - estimateTextAndImageContentTokens(actual.content));
      expect(actual.details).toMatchObject({
        path: "notes/source.md",
        outputProjection: {
          truncated: true,
          scope: "main",
          toolCallId: "call-1",
        },
      });
      expect(JSON.stringify(actual.content)).toContain("read_tool_result");
      expect(original.content[0]).toEqual({ type: "text", text: "Long answer ".repeat(1000) });
    });
    it(`respects the remaining batch allowance without turning omitted successful results into failures ${issue}`, () => {
      const budget = { maxTokens: 500, remainingTokens: 140 };
      const actual = projectToolResult(result("x".repeat(10000)), identity, budget);
      expect(estimateTextAndImageContentTokens(actual.content)).toBeLessThanOrEqual(140);
      const omitted = projectToolResult(result("Another answer"), identity, {
        maxTokens: 100,
        remainingTokens: 1,
      });
      expect(omitted.content).toEqual([]);
      expect(omitted.isError).toBeUndefined();
      expect(omitted.details).toMatchObject({
        outputProjection: { truncated: true, noticeOmitted: true },
      });
    });
    it(`retains execution certainty when the entire original content must be omitted ${issue}`, () => {
      const original = withToolExecution(result("x".repeat(10000)), {
        status: "outcome_unknown",
        retry: "verify_before_retry",
      });
      const actual = projectToolResult(original, identity, {
        maxTokens: 160,
        remainingTokens: 160,
      });
      expect(JSON.stringify(actual.content)).toContain("outcome_unknown");
      expect(JSON.stringify(actual.content)).toContain("verify_before_retry");
      expect(JSON.stringify(actual.content)).toContain("content_complete=false");
    });
    it(`keeps image blocks atomic and leaves output-schema data unchanged ${issue}`, () => {
      const image = { type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" };
      const original: AgentToolResult = {
        content: [image],
        details: { _meta: "private" },
        structuredContent: { value: 42 },
      };
      const actual = projectToolResult(original, identity, {
        maxTokens: 3000,
        remainingTokens: 3000,
      });
      expect(actual.content).toContainEqual(image);
      expect(actual.structuredContent).toEqual({ value: 42 });
      expect(JSON.stringify(actual.content)).toContain("42");
      expect(JSON.stringify(actual.content)).not.toContain("private");
    });
    it(`does not duplicate MCP public structured content already present in a model block ${issue}`, () => {
      const text = '<mcp_structured_content>\n{"answer":42}\n</mcp_structured_content>';
      const original: AgentToolResult = {
        content: [{ type: "text", text }],
        details: undefined,
        structuredContent: { answer: 42 },
      };
      expect(
        projectToolResult(original, identity, { maxTokens: 500, remainingTokens: 500 }).content
      ).toEqual(original.content);
    });
  });
  describe("readToolResultPage()", () => {
    it(`continues the exact original result after a bounded projection without duplicating or losing text ${issue}`, () => {
      const original = result("😀".repeat(6000) + " final marker");
      const first = projectToolResult(original, identity, { maxTokens: 150, remainingTokens: 150 });
      const projection = (first.details as { outputProjection: { nextCursor: string } })
        .outputProjection;
      const next = readToolResultPage(original, identity, projection.nextCursor, 20000);
      expect(JSON.stringify(next.content)).toContain("final marker");
      const firstText = first.content
        .slice(0, -1)
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("");
      const nextText = next.content.map((part) => (part.type === "text" ? part.text : "")).join("");
      expect(firstText + nextText).toBe("😀".repeat(6000) + " final marker");
      expect(
        (next.details as { outputProjection: { truncated: boolean } }).outputProjection.truncated
      ).toBe(false);
      expect(() =>
        readToolResultPage(original, { ...identity, scope: "child-1" }, projection.nextCursor)
      ).toThrow("changed");
      expect(() => readToolResultPage(result("new body"), identity, projection.nextCursor)).toThrow(
        "changed"
      );
    });
    it(`preserves mixed text and images in their original order across pages ${issue}`, () => {
      const image = { type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" };
      const original: AgentToolResult = {
        content: [{ type: "text", text: "head" }, image, { type: "text", text: "tail" }],
        details: undefined,
      };
      const actual = readToolResultPage(original, identity);
      expect(actual.content).toEqual(original.content);
    });
  });
  describe("pageToolText()", () => {
    it(`reports source offsets separately from the continuation notice and never splits emoji ${issue}`, () => {
      const text = "A😀B";
      const first = pageToolText(text, "note:source.md", undefined, 2);
      expect(first).toMatchObject({ offset: 0, end: 1, totalCharacters: 4, truncated: true });
      expect(first.text).toContain("Continue with cursor:");
      const second = pageToolText(text, "note:source.md", first.nextCursor, 2);
      expect(second).toMatchObject({ offset: 1, end: 3, totalCharacters: 4, truncated: true });
      expect(second.text.startsWith("😀")).toBe(true);
      const last = pageToolText(text, "note:source.md", second.nextCursor, 2);
      expect(last).toMatchObject({ text: "B", offset: 3, end: 4, truncated: false });
      expect(last.fingerprint).toBe(first.fingerprint);
    });
    it(`refuses changed sources, invalid offsets and page sizes that cannot advance safely ${issue}`, () => {
      const first = pageToolText("A😀B", "note:a", undefined, 2);
      expect(() => pageToolText("Changed", "note:a", first.nextCursor)).toThrow("changed");
      expect(() => pageToolText("A😀B", "note:b", first.nextCursor)).toThrow("changed");
      expect(() => pageToolText("😀", "note:a", undefined, 1)).toThrow("page");
      expect(() => pageToolText("A", "note:a", undefined, 0)).toThrow("page");
    });
  });
});
