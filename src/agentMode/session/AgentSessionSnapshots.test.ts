import {
  AgentSessionSnapshots,
  type AgentSessionSnapshot,
} from "@/agentMode/session/AgentSessionSnapshots";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { mockTFile } from "@/__tests__/mockObsidian";

function fixture(): AgentSessionSnapshot {
  return {
    version: 1,
    chatId: "chat-1",
    backendId: "claude",
    sessionId: "native-1",
    projectId: "global",
    savedAtMs: 100,
    label: "Review notes",
    messages: [
      {
        id: "u1",
        sender: USER_SENDER,
        message: "Review",
        timestamp: null,
        isVisible: true,
        context: { notes: [mockTFile({ path: "Welcome.md" })] },
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,cGlj" } }],
      },
      {
        id: "a1",
        sender: AI_SENDER,
        message: "Done",
        timestamp: null,
        isVisible: true,
        turnDurationMs: 5200,
        turnStopReason: "end_turn",
        fileChanges: [
          {
            path: "Welcome.md",
            status: "modified",
            before: "a",
            after: "b",
            additions: 1,
            deletions: 1,
          },
        ],
      },
    ],
    tasks: [
      {
        task: {
          toolCallId: "tool-1",
          kind: "command",
          description: "Run checks",
          status: "completed",
          savedOutput: { text: "passed", truncated: true },
        },
        messages: [],
      },
    ],
    branch: { sourceChatId: "source", sourceMessageId: "reply", historyPending: true },
    selection: { baseModelId: "model-1", effort: "high" },
  };
}

function storage() {
  const files = new Map<string, string>();
  return {
    files,
    exists: async (path: string) => files.has(path),
    read: async (path: string) => files.get(path)!,
    write: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    remove: jest.fn(async (path: string) => {
      files.delete(path);
    }),
  };
}

describe("AgentSessionSnapshots", () => {
  describe("AgentSessionSnapshots", () => {
    describe("save()", () => {
      it("saves full messages, images, elapsed time, file changes, task output and branch state across a new store", async () => {
        const disk = storage();
        const note = mockTFile({ path: "Welcome.md" });
        const first = new AgentSessionSnapshots(disk, "/snapshots", () => note);
        await first.save(fixture());
        const reopened = new AgentSessionSnapshots(disk, "/snapshots", () => note);

        const restored = await reopened.load("claude", "native-1");

        expect(restored).toEqual(fixture());
        expect(restored!.messages[0].context!.notes[0]).toBe(note);
        expect([...disk.files.values()][0]).not.toContain('"stat":');
      });

      it("serializes writes so a slow older write cannot replace the latest task state", async () => {
        const disk = storage();
        let finish!: () => void;
        const firstWrite = new Promise<void>((resolve) => {
          finish = resolve;
        });
        disk.write.mockImplementationOnce(async (path, content) => {
          await firstWrite;
          disk.files.set(path, content);
        });
        const snapshots = new AgentSessionSnapshots(disk, "/snapshots", () => null);
        const first = snapshots.save(fixture());
        const next = { ...fixture(), label: "Latest" };
        const second = snapshots.save(next);
        finish();
        await Promise.all([first, second]);

        expect((await snapshots.load("claude", "native-1"))!.label).toBe("Latest");
      });

      it("reports a failed write and allows the next save to succeed", async () => {
        const disk = storage();
        disk.write.mockRejectedValueOnce(new Error("Disk full"));
        const snapshots = new AgentSessionSnapshots(disk, "/snapshots", () => null);

        await expect(snapshots.save(fixture())).rejects.toThrow("Disk full");
        await snapshots.save(fixture());
        expect(await snapshots.load("claude", "native-1")).not.toBeNull();
      });
    });

    describe("load()", () => {
      it("reconnects a previously missing note when the attachment is restored", async () => {
        const disk = storage();
        const missing = new AgentSessionSnapshots(disk, "/snapshots", () => null);
        await missing.save(fixture());
        await missing.save((await missing.load("claude", "native-1"))!);
        const note = mockTFile({ path: "Welcome.md" });
        const restored = new AgentSessionSnapshots(disk, "/snapshots", () => note);
        const loaded = await restored.load("claude", "native-1");
        expect(loaded!.messages[0].context!.notes).toEqual([note]);
        expect(loaded!.messages[0].missingAttachments).toBeUndefined();
      });
      it("returns no supplement for an old chat with no saved snapshot", async () => {
        const snapshots = new AgentSessionSnapshots(storage(), "/snapshots", () => null);
        expect(await snapshots.load("claude", "unknown")).toBeNull();
      });

      it("marks missing note attachments explicitly while keeping the remaining conversation", async () => {
        const disk = storage();
        const snapshots = new AgentSessionSnapshots(disk, "/snapshots", () => null);
        await snapshots.save(fixture());

        const restored = await snapshots.load("claude", "native-1");

        expect(restored!.messages[0].missingAttachments).toEqual(["Welcome.md"]);
        expect(restored!.messages[0].context!.notes).toEqual([]);
        expect(restored!.messages[1].turnDurationMs).toBe(5200);
      });

      it("rejects damaged or unsupported snapshots without overwriting them", async () => {
        const disk = storage();
        const snapshots = new AgentSessionSnapshots(disk, "/snapshots", () => null);
        await snapshots.save(fixture());
        const path = [...disk.files.keys()][0];
        disk.files.set(path, '{"version":99}');

        await expect(snapshots.load("claude", "native-1")).rejects.toThrow();
        expect(disk.files.get(path)).toBe('{"version":99}');
      });

      it("keeps backend and session identities separate", async () => {
        const snapshots = new AgentSessionSnapshots(storage(), "/snapshots", () => null);
        await snapshots.save(fixture());
        expect(await snapshots.load("codex", "native-1")).toBeNull();
        expect(await snapshots.load("claude", "native-2")).toBeNull();
      });
    });

    describe("remove()", () => {
      it("removes only the selected chat supplement after pending saves finish", async () => {
        const disk = storage();
        const snapshots = new AgentSessionSnapshots(disk, "/snapshots", () => null);
        await snapshots.save(fixture());
        await snapshots.save({ ...fixture(), sessionId: "native-2" });

        await snapshots.remove("claude", "native-1");

        expect(await snapshots.load("claude", "native-1")).toBeNull();
        expect(await snapshots.load("claude", "native-2")).not.toBeNull();
      });
    });
  });
});
