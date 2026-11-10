import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { projectDeliveredSkillPages } from "@/agentMode/sdk/skillDeliveryProjection";

describe("skillDeliveryProjection", () => {
  describe("projectDeliveredSkillPages()", () => {
    const fingerprint = "a".repeat(64);
    const cursor = `4:${fingerprint}`;
    function call(id: string, args: Record<string, unknown>): AgentMessage {
      return {
        role: "assistant",
        content: [{ type: "toolCall", id, name: "invoke_skill", arguments: args }],
      } as AgentMessage;
    }
    function result(id: string, text: string, details: unknown, isError = false): AgentMessage {
      return {
        role: "toolResult",
        toolCallId: id,
        toolName: "invoke_skill",
        content: [{ type: "text", text }],
        details,
        isError,
        timestamp: 1,
      } as AgentMessage;
    }

    it("projects an actually delivered skill body page and its continuation within the supplied scope https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const text = `body\n\n[Output truncated]\nContinue with cursor: ${cursor}`;
      expect(
        projectDeliveredSkillPages(
          [
            call("one", { name: "notes" }),
            result("one", text, { name: "notes", truncated: true, nextCursor: cursor }),
          ],
          "parent"
        )
      ).toEqual([
        {
          scope: "parent",
          toolCallId: "one",
          callIndex: 0,
          resultIndex: 1,
          name: "notes",
          version: fingerprint,
          offset: 0,
          text,
          nextCursor: cursor,
        },
      ]);
    });

    it("keeps a later page in the child scope and preserves its version and offset https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      expect(
        projectDeliveredSkillPages(
          [
            call("two", { name: "notes", cursor }),
            result("two", "end", { name: "notes", truncated: false }),
          ],
          "child/run-1"
        )
      ).toEqual([
        {
          scope: "child/run-1",
          toolCallId: "two",
          callIndex: 0,
          resultIndex: 1,
          name: "notes",
          version: fingerprint,
          offset: 4,
          text: "end",
        },
      ]);
    });

    it("keeps a later page partial when its first page was not in the delivered request https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const pages = projectDeliveredSkillPages(
        [
          call("two", { name: "notes", cursor }),
          result("two", "end", { name: "notes", truncated: false }),
        ],
        "parent"
      );
      expect(pages.map((page) => page.offset)).toEqual([4]);
      expect(pages.some((page) => page.offset === 0)).toBe(false);
    });

    it("retains a complete single-page body with a stable version https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const pages = projectDeliveredSkillPages(
        [
          call("one", { name: "notes" }),
          result("one", "body", { name: "notes", truncated: false }),
        ],
        "parent"
      );
      expect(pages).toHaveLength(1);
      expect(pages[0]).toMatchObject({
        scope: "parent",
        name: "notes",
        offset: 0,
        text: "body",
        version: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    });

    it("distinguishes reused tool call ids by their exact message positions https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const pages = projectDeliveredSkillPages(
        [
          call("reused", { name: "notes" }),
          result("reused", "first", { name: "notes", truncated: false }),
          call("reused", { name: "notes" }),
          result("reused", "second", { name: "notes", truncated: false }),
        ],
        "main"
      );
      expect(
        pages.map(({ callIndex, resultIndex, text }) => ({ callIndex, resultIndex, text }))
      ).toEqual([
        { callIndex: 0, resultIndex: 1, text: "first" },
        { callIndex: 2, resultIndex: 3, text: "second" },
      ]);
    });

    it("ignores failures, unmatched calls, listings and supporting files https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const messages = [
        call("fail", { name: "notes" }),
        result("fail", "error", { name: "notes", truncated: false }, true),
        result("orphan", "body", { name: "notes", truncated: false }),
        call("list", {}),
        result("list", "list", { truncated: false }),
        call("file", { name: "notes", file: "guide.md" }),
        result("file", "file", { name: "notes", file: "guide.md", truncated: false }),
      ];
      expect(projectDeliveredSkillPages(messages, "parent")).toEqual([]);
    });

    it("ignores inconsistent page identity or version instead of merging different contents https://github.com/ItsDalk-Lane/Scribe/issues/68", () => {
      const messages = [
        call("bad-name", { name: "notes" }),
        result("bad-name", "body", { name: "other", truncated: false }),
        call("bad-version", { name: "notes", cursor }),
        result("bad-version", "body", {
          name: "notes",
          truncated: true,
          nextCursor: `8:${"b".repeat(64)}`,
        }),
      ];
      expect(projectDeliveredSkillPages(messages, "parent")).toEqual([]);
    });
  });
});
