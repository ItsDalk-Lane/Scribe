import { TFile } from "obsidian";
import {
  hydrateDisplayMessage,
  isAgentDisplayFact,
  projectDisplayFacts,
  serializeDisplayMessage,
} from "@/agentMode/session/AgentDisplayFacts";
import type {
  AgentChatMessage,
  SequencedAgentDisplayFact,
  StoredAgentDisplayMessage,
} from "@/agentMode/session/types";

const user: AgentChatMessage = {
  id: "prompt-1",
  sender: "user",
  message: "My original request",
  timestamp: null,
  isVisible: true,
};
const storedUser: StoredAgentDisplayMessage = { ...user, context: undefined };

describe("AgentDisplayFacts", () => {
  describe("isAgentDisplayFact()", () => {
    it("accepts known complete display facts and rejects invalid or unknown records", () => {
      expect(isAgentDisplayFact({ kind: "user_message", message: storedUser })).toBe(true);
      expect(isAgentDisplayFact({ kind: "message_metadata", messageId: "one", metadata: {} })).toBe(
        true
      );
      expect(isAgentDisplayFact(null)).toBe(false);
      expect(isAgentDisplayFact({ kind: "future_record" })).toBe(false);
      expect(isAgentDisplayFact({ kind: "user_message", message: { id: "one" } })).toBe(false);
      expect(
        isAgentDisplayFact({ kind: "message_metadata", messageId: "one", metadata: null })
      ).toBe(false);
      expect(isAgentDisplayFact({ kind: "branch", branch: {}, messages: [null] })).toBe(false);
      expect(isAgentDisplayFact({ kind: "task", task: null, messages: [] })).toBe(false);
      expect(isAgentDisplayFact({ kind: "session_metadata", chatId: "one", label: 1 })).toBe(false);
    });
  });
  describe("serializeDisplayMessage()", () => {
    it("stores attached note paths without serializing Obsidian objects", () => {
      const note = Object.assign(new TFile(), { path: "Notes/Brief.md" });
      const message = { ...user, context: { notes: [note] } } as AgentChatMessage;
      expect(serializeDisplayMessage(message).context?.notes).toEqual(["Notes/Brief.md"]);
      expect(message.context?.notes[0]).toBe(note);
    });
  });

  describe("hydrateDisplayMessage()", () => {
    it("resolves existing notes and names missing attachments without deleting references", () => {
      const note = Object.assign(new TFile(), { path: "Notes/Brief.md" });
      const message = {
        ...user,
        context: { notes: [note.path, "Notes/Missing.md"] },
      } as StoredAgentDisplayMessage;
      const result = hydrateDisplayMessage(message, (path) => (path === note.path ? note : null));
      expect(result.context?.notes).toEqual([note]);
      expect(result.missingAttachments).toEqual(["Notes/Missing.md"]);
    });

    it("preserves messages without note attachments", () => {
      expect(hydrateDisplayMessage(storedUser, () => null)).toBe(storedUser);
    });

    it("ignores malformed and unknown content blocks without losing readable message text", () => {
      const message = {
        ...storedUser,
        sender: "ai",
        parts: [
          { kind: "text", text: "Saved text" },
          null,
          { kind: "future-block", data: "kept in the journal" },
          { kind: "tool_call", id: "broken", status: "failed" },
        ],
      } as unknown as StoredAgentDisplayMessage;
      expect(hydrateDisplayMessage(message, () => null).parts).toEqual([
        { kind: "text", text: "Saved text" },
      ]);
    });
  });

  describe("projectDisplayFacts()", () => {
    it("uses exact message identities to restore original requests, including repeated text", () => {
      const second = { ...user, id: "prompt-2", seq: 9 };
      const facts: SequencedAgentDisplayFact[] = [
        { seq: 1, payload: { kind: "user_message", message: storedUser } },
        { seq: 9, payload: { kind: "user_message", message: { ...storedUser, id: second.id } } },
      ];
      const result = projectDisplayFacts(
        [{ ...user, message: "Long request envelope with hidden context" }, second],
        facts,
        () => null
      );
      expect(result.messages.map((message) => [message.id, message.message, message.seq])).toEqual([
        ["prompt-1", "My original request", 1],
        ["prompt-2", "My original request", 9],
      ]);
    });

    it("restores an accepted request even if no model response was recorded", () => {
      const result = projectDisplayFacts(
        [],
        [{ seq: 0, payload: { kind: "user_message", message: storedUser } }],
        () => null
      );
      expect(result.messages).toEqual([{ ...user, seq: 0 }]);
    });

    it("applies explicit deletion and clear facts without modifying input history", () => {
      const messages = [user, { ...user, id: "prompt-2" }];
      expect(
        projectDisplayFacts(
          messages,
          [{ seq: 4, payload: { kind: "message_deleted", messageId: user.id } }],
          () => null
        ).messages
      ).toEqual([messages[1]]);
      expect(
        projectDisplayFacts(
          messages,
          [{ seq: 5, payload: { kind: "messages_cleared" } }],
          () => null
        ).messages
      ).toEqual([]);
      expect(messages).toHaveLength(2);
    });

    it("restores branch inheritance once and keeps later runtime messages", () => {
      const later = { ...user, id: "later" };
      const branch = { sourceChatId: "source", sourceMessageId: "reply", historyPending: true };
      const result = projectDisplayFacts(
        [user, later],
        [{ seq: 0, payload: { kind: "branch", branch, messages: [storedUser] } }],
        () => null
      );
      expect(result.messages).toEqual([user, later]);
      expect(result.branch).toEqual(branch);
    });

    it("restores session labels, completed task details and changed-file metadata", () => {
      const task = {
        toolCallId: "task-1",
        kind: "command" as const,
        description: "Check notes",
        status: "completed" as const,
      };
      const fileChanges = [
        {
          path: "Notes/Brief.md",
          status: "created" as const,
          before: null,
          after: "Brief",
          additions: 1,
          deletions: 0,
        },
      ];
      const result = projectDisplayFacts(
        [user],
        [
          {
            seq: 1,
            payload: { kind: "message_metadata", messageId: user.id, metadata: { fileChanges } },
          },
          { seq: 2, payload: { kind: "task", task, messages: [storedUser] } },
          { seq: 3, payload: { kind: "session_metadata", chatId: "chat-1", label: "Brief" } },
        ],
        () => null
      );
      expect(result.messages[0].fileChanges).toEqual(fileChanges);
      expect(result.tasks).toEqual([{ task, messages: [user] }]);
      expect(result.chatId).toBe("chat-1");
      expect(result.label).toBe("Brief");
    });

    it("keeps later runtime messages when an earlier clear fact hides previous history", () => {
      const later = { ...user, id: "later", sender: "ai", message: "Later reply", seq: 12 };
      const result = projectDisplayFacts(
        [{ ...user, seq: 1 }, later],
        [{ seq: 9, payload: { kind: "messages_cleared" } }],
        () => null
      );
      expect(result.messages).toEqual([later]);
    });

    it("assigns inherited messages their local journal sequence and projects the latest pin fact", () => {
      const result = projectDisplayFacts(
        [],
        [
          {
            seq: 2,
            origin: "derived",
            payload: { kind: "inherited_message", message: { ...storedUser, seq: 300 } },
          },
          { seq: 3, payload: { kind: "pin", pinnedAt: 5000 } },
          { seq: 4, payload: { kind: "pin", pinnedAt: null } },
        ],
        () => null
      );
      expect(result.messages[0]).toMatchObject({ id: user.id, seq: 2 });
      expect(result.pinnedAt).toBeNull();
    });

    it("skips malformed and unknown display records while preserving readable history", () => {
      const invalid = [
        null,
        { kind: "future_feature" },
        { kind: "user_message", message: { id: "broken" } },
        { kind: "branch", branch: {}, messages: [] },
      ];
      const facts = invalid.map((payload, seq) => ({
        seq,
        payload,
      })) as SequencedAgentDisplayFact[];
      const result = projectDisplayFacts([user], facts, () => null);
      expect(result.messages).toEqual([user]);
      expect(result.warnings).toHaveLength(4);
    });
  });
});
