import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeNativeSessionStorage } from "@/agentMode/sdk/NativeSessionStorage";
import type { NativeSessionRecord } from "@/agentMode/sdk/NativeBackendProcess";
import { createAssistantMessage } from "@/LLMProviders/piChatModel";
import type { Api, Model } from "@earendil-works/pi-ai";

const SESSION_ID = "native-8c4529e7-6551-4f39-81b3-dbf5f8e716dd";
const SECOND_ID = "native-41d51594-f0e0-46b7-b770-a283c9f6405f";

function record(id = SESSION_ID): NativeSessionRecord {
  return {
    version: 1,
    backendId: "native",
    sessionId: id,
    cwd: "/vault/project",
    projectId: "project-a",
    modelId: "model-a",
    effort: "off",
    mode: "default",
    messages: [{ role: "user", content: "Inspect the note", timestamp: 10 }],
    events: [],
    updatedAt: 10,
  };
}

function assistant() {
  const model: Model<Api> = {
    id: "model-a",
    name: "Model A",
    api: "openai-completions",
    provider: "fixture",
    baseUrl: "http://localhost",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 10000,
    maxTokens: 1000,
  };
  return createAssistantMessage(model);
}

describe("NativeSessionStorage", () => {
  describe("NodeNativeSessionStorage", () => {
    let directory: string;
    let storage: NodeNativeSessionStorage;
    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), "scribe-native-history-"));
      storage = new NodeNativeSessionStorage(directory);
    });
    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    describe("save()", () => {
      it.each([null, "off"] as const)(
        "persists the distinct reasoning intent %s across a new store",
        async (effort) => {
          const saved = { ...record(), effort };
          await storage.save(saved);
          expect((await new NodeNativeSessionStorage(directory).load(SESSION_ID))?.effort).toBe(
            effort
          );
        }
      );
      it("saves a complete native record atomically and can read it after constructing a new store", async () => {
        const saved = record();
        await storage.save(saved);
        expect(await new NodeNativeSessionStorage(directory).load(SESSION_ID)).toEqual(saved);
        expect(await readdir(directory)).toEqual([`${SESSION_ID}.json`]);
      });

      it("serializes concurrent writes using snapshots captured when each save was requested", async () => {
        const saved = record();
        const first = storage.save(saved);
        saved.updatedAt = 20;
        saved.messages.push({ role: "user", content: "Follow-up", timestamp: 20 });
        const second = storage.save(saved);
        saved.messages.push({ role: "user", content: "Not saved", timestamp: 30 });
        await Promise.all([first, second]);
        const restored = await storage.load(SESSION_ID);
        expect(restored?.updatedAt).toBe(20);
        expect(restored?.messages).toHaveLength(2);
      });

      it("refuses to overwrite a malformed record that previously failed to load", async () => {
        await writeFile(join(directory, `${SESSION_ID}.json`), "original broken bytes");
        await expect(storage.load(SESSION_ID)).rejects.toThrow();
        await expect(storage.save(record())).rejects.toThrow(/preserv/i);
        expect(await readFile(join(directory, `${SESSION_ID}.json`), "utf8")).toBe(
          "original broken bytes"
        );
      });
    });

    describe("load()", () => {
      it("returns null for a missing native session", async () => {
        expect(await storage.load(SESSION_ID)).toBeNull();
      });

      it("rejects path traversal and a non-native identifier before reading storage", async () => {
        await expect(storage.load("../outside")).rejects.toThrow(/identifier/i);
        await expect(storage.load("claude-session")).rejects.toThrow(/identifier/i);
        expect(await readdir(directory)).toEqual([]);
      });

      it("rejects unsupported versions, different ownership, and malformed scope metadata", async () => {
        for (const patch of [
          { version: 2 },
          { backendId: "claude" },
          { sessionId: SECOND_ID },
          { cwd: "relative/path" },
          { projectId: 3 },
          { messages: [{ role: "assistant", content: "malformed", timestamp: 1 }] },
        ]) {
          await writeFile(
            join(directory, `${SESSION_ID}.json`),
            JSON.stringify({ ...record(), ...patch })
          );
          await expect(new NodeNativeSessionStorage(directory).load(SESSION_ID)).rejects.toThrow(
            /invalid|unsupported/i
          );
        }
      });

      it("records interrupted tools and background tasks as failed or stopped without re-executing them", async () => {
        const saved = record();
        const message = assistant();
        message.stopReason = "toolUse";
        message.content = [
          {
            type: "toolCall",
            id: "write-1",
            name: "write_note",
            arguments: { path: "untouched.md", content: "unexpected" },
          },
        ];
        saved.messages.push(message);
        saved.events = [
          { sessionId: SESSION_ID, update: { sessionUpdate: "turn_started", turnId: "turn-1" } },
          {
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "write-1",
              title: "Write note",
              status: "in_progress",
            },
          },
          {
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: "task_started",
              taskId: "command-1",
              toolCallId: "run-1",
              kind: "command",
              description: "Background task",
            },
          },
        ];
        saved.events.push({
          sessionId: SESSION_ID,
          update: {
            sessionUpdate: "compaction",
            id: "compact-1",
            trigger: "manual",
            status: "in_progress",
          },
        });
        await storage.save(saved);
        const restored = await storage.load(SESSION_ID);
        expect(restored?.events).toContainEqual(
          expect.objectContaining({
            update: expect.objectContaining({
              sessionUpdate: "compaction",
              id: "compact-1",
              status: "cancelled",
            }),
          })
        );
        expect(restored?.messages).toContainEqual(
          expect.objectContaining({
            role: "toolResult",
            toolCallId: "write-1",
            toolName: "write_note",
            isError: true,
          })
        );
        expect(restored?.events).toContainEqual(
          expect.objectContaining({
            update: expect.objectContaining({
              sessionUpdate: "task_ended",
              taskId: "command-1",
              status: "stopped",
            }),
          })
        );
        expect(restored?.events).toContainEqual(
          expect.objectContaining({
            update: expect.objectContaining({
              sessionUpdate: "tool_call_update",
              toolCallId: "write-1",
              status: "failed",
            }),
          })
        );
        expect(restored?.events).toContainEqual(
          expect.objectContaining({
            update: expect.objectContaining({
              sessionUpdate: "turn_ended",
              turnId: "turn-1",
              stopReason: "cancelled",
            }),
          })
        );
        expect(await readdir(directory)).toEqual([`${SESSION_ID}.json`]);
        await storage.save(restored!);
        expect(await storage.load(SESSION_ID)).toEqual(restored);
      });

      it("restores a saved model error as an Error with its diagnostic message", async () => {
        const saved = record();
        saved.events = [
          {
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: "turn_ended",
              turnId: "failed",
              stopReason: "end_turn",
              error: new Error("Model rejected tools during continuation"),
            },
          },
        ];
        await storage.save(saved);
        const restored = await storage.load(SESSION_ID);
        const update = restored!.events[0].update;
        expect(update.sessionUpdate).toBe("turn_ended");
        if (update.sessionUpdate !== "turn_ended") throw new Error("Missing turn result");
        expect(update.error).toBeInstanceOf(Error);
        expect(update.error?.message).toBe("Model rejected tools during continuation");
      });

      it("does not duplicate an already completed tool result when reopening history", async () => {
        const saved = record();
        const message = assistant();
        message.stopReason = "toolUse";
        message.content = [
          { type: "toolCall", id: "read-1", name: "read_note", arguments: { path: "note.md" } },
        ];
        saved.messages.push(message, {
          role: "toolResult",
          toolCallId: "read-1",
          toolName: "read_note",
          content: [{ type: "text", text: "Actual note" }],
          isError: false,
          timestamp: 11,
        });
        await storage.save(saved);
        expect(await storage.load(SESSION_ID)).toEqual(saved);
      });
    });

    describe("remove()", () => {
      it("removes only the selected native record after pending saves finish", async () => {
        const first = storage.save(record());
        const second = storage.save(record(SECOND_ID));
        const removed = storage.remove(SESSION_ID);
        await Promise.all([first, second, removed]);
        expect(await storage.load(SESSION_ID)).toBeNull();
        expect(await storage.load(SECOND_ID)).toEqual(record(SECOND_ID));
        await storage.remove(SESSION_ID);
        expect(await readdir(directory)).toEqual([`${SECOND_ID}.json`]);
      });

      it("rejects an invalid identifier without deleting any other file", async () => {
        await writeFile(join(directory, "unrelated.json"), "Keep this file");
        await expect(storage.remove("../unrelated")).rejects.toThrow(/identifier/i);
        expect(await readFile(join(directory, "unrelated.json"), "utf8")).toBe("Keep this file");
      });

      it("permits explicit removal of an unreadable native record without touching unrelated data", async () => {
        await writeFile(join(directory, `${SESSION_ID}.json`), "broken");
        await expect(storage.load(SESSION_ID)).rejects.toThrow();
        await storage.remove(SESSION_ID);
        await storage.save(record());
        expect(await storage.load(SESSION_ID)).toEqual(record());
      });
    });

    describe("list()", () => {
      it("lists only valid native records in most recently updated order", async () => {
        await storage.save(record());
        const recent = record(SECOND_ID);
        recent.updatedAt = 20;
        await storage.save(recent);
        await writeFile(join(directory, "unrelated.json"), "untouched");
        expect((await storage.list()).map((entry) => entry.sessionId)).toEqual([
          SECOND_ID,
          SESSION_ID,
        ]);
        expect(await readFile(join(directory, "unrelated.json"), "utf8")).toBe("untouched");
      });
    });
  });
});
