import { AI_SENDER, USER_SENDER } from "@/constants";
import { AgentChatPersistenceManager } from "./AgentChatPersistenceManager";
import { GLOBAL_SCOPE } from "./scope";
import type { AgentChatMessage } from "./types";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { getSettings } from "@/settings/model";
import { getEffectiveConversationsFolder } from "@/settings/scribeFolder";

/* eslint-disable obsidianmd/no-tfile-tfolder-cast -- test fixtures; not real TFiles */

jest.mock("obsidian", () => ({
  normalizePath: (path: string) => path,
  Notice: jest.fn(),
  TFile: jest.fn(),
}));
jest.mock("@/logger");
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({
    defaultSaveFolder: "test-folder",
    defaultConversationTag: "scribe-conversation",
    defaultConversationNoteName: "{$date}_{$time}__{$topic}",
  }),
}));
jest.mock("@/settings/scribeFolder", () => ({
  getEffectiveConversationsFolder: jest.fn(() => "test-folder"),
  deriveConversationAttachmentsFolder: jest.fn((folder: string) => `${folder}/attachments`),
}));
jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn(async () => {}),
  formatDateTime: jest.fn(() => ({
    fileName: "20260101_120000",
    display: "2026/01/01 12:00:00",
  })),
  getUtf8ByteLength: jest.fn((s: string) => new TextEncoder().encode(s).length),
  truncateToByteLimit: jest.fn((s: string, n: number) => {
    const bytes = new TextEncoder().encode(s);
    if (bytes.length <= n) return s;
    return new TextDecoder().decode(bytes.slice(0, n));
  }),
}));
jest.mock("@/utils/vaultAdapterUtils", () => ({
  ...jest.requireActual("@/utils/vaultAdapterUtils"),
  listMarkdownFiles: jest.fn().mockReturnValue([]),
  patchFrontmatter: jest.requireActual("@/utils/vaultAdapterUtils").patchFrontmatter,
}));

interface FakeFile {
  path: string;
  basename: string;
  contents?: string;
}

function makeApp() {
  const files = new Map<string, FakeFile>();
  const images = new Map<string, ArrayBuffer>();
  return {
    files,
    images,
    vault: {
      createBinary: jest.fn(async (path: string, bytes: ArrayBuffer) => {
        images.set(path, bytes);
        return { path };
      }),
      getConfig: jest.fn(() => "attachments"),
      createFolder: jest.fn(),
      getAbstractFileByPath: jest.fn((path: string) => files.get(path) ?? null),
      create: jest.fn(async (path: string, content: string) => {
        if (files.has(path)) throw new Error("File already exists.");
        const basename = path.split("/").pop()!.replace(/\.md$/, "");
        const file: FakeFile = Object.assign(Object.create(TFile.prototype), {
          path,
          basename,
          contents: content,
        });
        files.set(path, file);
        return file;
      }),
      process: jest.fn(async (file: FakeFile, update: (content: string) => string) => {
        file.contents = update(file.contents ?? "");
        return file.contents;
      }),
      modify: jest.fn(async (file: FakeFile, content: string) => {
        file.contents = content;
      }),
      read: jest.fn(async (file: FakeFile) => file.contents ?? ""),
      delete: jest.fn(async (file: FakeFile) => {
        files.delete(file.path);
      }),
      adapter: {
        list: jest.fn(async () => ({ files: [...images.keys()], folders: [] })),
        readBinary: jest.fn(async (path: string) => images.get(path)!),
        mkdir: jest.fn(),
        exists: jest.fn(async (path: string) => files.has(path) || images.has(path)),
        read: jest.fn(async (path: string) => files.get(path)?.contents ?? ""),
        write: jest.fn(async (path: string, content: string) => {
          const existing = files.get(path);
          if (existing) {
            existing.contents = content;
          } else {
            const basename = path.split("/").pop()!.replace(/\.md$/, "");
            files.set(path, { path, basename, contents: content });
          }
        }),
        remove: jest.fn(async (path: string) => {
          files.delete(path);
        }),
      },
    },
    metadataCache: {
      getFileCache: jest.fn(() => undefined),
    },
    fileManager: {
      processFrontMatter: jest.fn(
        async (file: FakeFile, update: (frontmatter: Record<string, unknown>) => void) => {
          const contents = file.contents ?? "";
          const match = /^---\n([\s\S]*?)\n---\n/.exec(contents);
          const frontmatter = (match ? parseYaml(match[1]) : {}) as Record<string, unknown>;
          update(frontmatter);
          const body = match ? contents.slice(match[0].length) : contents;
          file.contents = `---\n${stringifyYaml(frontmatter)}---\n${body}`;
        }
      ),
    },
  };
}

function makeMessage(sender: string, message: string, epoch = 1735732800000): AgentChatMessage {
  return {
    id: `msg-${epoch}`,
    sender,
    message,
    isVisible: true,
    timestamp: { epoch, display: "2026/01/01 12:00:00", fileName: "20260101_120000" },
  };
}

describe("AgentChatPersistenceManager", () => {
  let app: ReturnType<typeof makeApp>;
  let manager: AgentChatPersistenceManager;

  beforeEach(() => {
    app = makeApp();
    manager = new AgentChatPersistenceManager(app as unknown as App);
  });

  describe("saveSession", () => {
    it("keeps the transcript baseline cache bounded across many chats", async () => {
      for (let i = 0; i < 55; i++) {
        const messages = [makeMessage(USER_SENDER, `hello ${i}`, 1735732800000 + i)];
        const saved = await manager.saveSession(messages, "native", {});
        await manager.saveSession(messages, "native", { existingPath: saved!.path });
      }

      const cache = (manager as unknown as { loadedTranscripts: Map<unknown, string> })
        .loadedTranscripts;
      expect(cache.size).toBe(50);
    });

    it("saves a fork with its own identity without changing the source chat or inherited message times", async () => {
      const messages = [
        makeMessage(USER_SENDER, "Review", 1000),
        makeMessage(AI_SENDER, "Reviewed", 2000),
      ];
      const source = await manager.saveSession(messages, "native", { sessionId: "source" });
      const original = app.files.get(source!.path)!.contents;

      const fork = await manager.saveSession(messages, "native", {
        sessionId: "fork",
        chatId: "fork-chat",
        conversationEpoch: 1800000000123,
      });

      expect(fork!.path).not.toBe(source!.path);
      expect(app.files.get(source!.path)!.contents).toBe(original);
      expect(app.files.get(fork!.path)!.contents).toContain("epoch: 1800000000123");
      expect(messages[0].timestamp!.epoch).toBe(1000);
    });

    it("preserves organizer links after native rehydration, reopening and later deletion", async () => {
      const message = {
        ...makeMessage(USER_SENDER, "image"),
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
      };
      const saved = await manager.saveSession([message], "native");
      const file = app.files.get(saved!.path)!;
      Object.setPrototypeOf(file, TFile.prototype);
      file.contents = file.contents!.replace(/!\[\]\([^)]+\)/, "![[organized.png]]");
      const resumed = new AgentChatPersistenceManager(app as unknown as App);
      await resumed.saveSession([JSON.parse(JSON.stringify(message))], "native", {
        existingPath: saved!.path,
      });
      expect(file.contents).toContain("![[organized.png]]");
      file.contents = file.contents.replace(/\n/g, "\r\n");
      const loaded = await resumed.loadFile(file as unknown as TFile);
      expect(loaded.messages[0].message).not.toContain("scribe-image:");
      file.contents = file.contents.replace("organized.png", "renamed.png");
      loaded.messages[0].message = loaded.messages[0].message.replace("image", "edited text");
      await resumed.saveSession(loaded.messages, "native", { existingPath: saved!.path });
      expect(file.contents).toContain("![[renamed.png]]");
      await resumed.saveSession(loaded.messages, "native", { existingPath: saved!.path });
      expect(file.contents).toContain("![[renamed.png]]");
      expect(file.contents).toContain("edited text");
      expect(app.vault.createBinary).toHaveBeenCalledTimes(1);
    });

    it("preserves host moves of reopened legacy links while accepting intentional embed edits", async () => {
      const saved = await manager.saveSession(
        [makeMessage(USER_SENDER, "image\n\n![[old.png]]")],
        "native"
      );
      const file = app.files.get(saved!.path)!;
      Object.setPrototypeOf(file, TFile.prototype);
      const loaded = await manager.loadFile(file as unknown as TFile);
      app.files.delete(file.path);
      file.path = "scribe-conversations/renamed-legacy.md";
      app.files.set(file.path, file);
      saved!.path = file.path;
      file.contents = file.contents!.replace("old.png", "moved.png");
      await manager.saveSession(loaded.messages, "native", { existingPath: saved!.path });
      expect(file.contents).toContain("![[moved.png]]");
      loaded.messages[0].message = loaded.messages[0].message.replace("old.png", "intentional.png");
      await manager.saveSession(loaded.messages, "native", { existingPath: saved!.path });
      expect(file.contents).toContain("![[intentional.png]]");
      file.contents = file.contents.replace("intentional.png", "organized-edit.png");
      await manager.saveSession(loaded.messages, "native", { existingPath: saved!.path });
      await manager.saveSession(loaded.messages, "native", { existingPath: saved!.path });
      expect(file.contents).toContain("![[organized-edit.png]]");
      expect(app.vault.createBinary).not.toHaveBeenCalled();
    });

    it("saves uploaded image embeds beside the user message and preserves them on reload", async () => {
      const message = {
        ...makeMessage(USER_SENDER, "Look at this"),
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
      };
      app.vault.createBinary.mockImplementation(async (path) => {
        expect(app.vault.create).not.toHaveBeenCalled();
        return { path };
      });
      const saved = await manager.saveSession(
        [message, makeMessage(AI_SENDER, "An image")],
        "native"
      );
      const imagePath = app.vault.createBinary.mock.calls[0][0];
      const file = app.files.get(saved!.path)!;
      expect(file.contents).toContain(`![](/${imagePath})`);
      expect(file.contents).toContain("**ai**: An image");
      const loaded = await manager.loadFile(file as unknown as TFile);
      expect(loaded.messages[0].message).toContain(`![](/${imagePath})`);
      expect(message.message).toBe("Look at this");
    });

    it.each([false, true])(
      "saves a fresh image for a different chat with the same filename, including a failed upload retry=%s",
      async (failUpload) => {
        const message = {
          ...makeMessage(USER_SENDER, "Same opening"),
          content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
        };
        const first = await manager.saveSession([message], "native", { sessionId: "first" });
        const firstContent = app.files.get(first!.path)!.contents;
        const imagePath = app.vault.createBinary.mock.calls[0][0];
        app.images.delete(imagePath);
        await manager.saveSession([message], "native", {
          existingPath: first!.path,
          sessionId: "first",
        });
        expect(app.images.size).toBe(0);

        if (failUpload) {
          app.vault.createBinary.mockRejectedValueOnce(new Error("disk full"));
          expect(
            await manager.saveSession([message], "native", { sessionId: "second" })
          ).toBeNull();
          expect(app.files.size).toBe(1);
          expect(app.files.get(first!.path)!.contents).toBe(firstContent);
        }
        const second = await manager.saveSession([message], "native", { sessionId: "second" });

        expect(second!.path).not.toBe(first!.path);
        expect(app.images.get(imagePath)).toEqual(new Uint8Array([1, 2, 3]).buffer);
        expect(app.files.get(second!.path)!.contents).toContain(`![](/${imagePath})`);
        expect(app.files.get(first!.path)!.contents).toBe(firstContent);
        const uploads = app.vault.createBinary.mock.calls.length;
        await manager.saveSession([message], "native", {
          existingPath: second!.path,
          sessionId: "second",
        });
        expect(app.vault.createBinary).toHaveBeenCalledTimes(uploads);
      }
    );

    it("preserves the existing transcript and reports failure when an image write fails", async () => {
      const messages = [makeMessage(USER_SENDER, "Original")];
      const original = await manager.saveSession(messages, "native");
      const content = app.files.get(original!.path)!.contents;
      app.vault.createBinary.mockRejectedValueOnce(new Error("disk full"));
      const result = await manager.saveSession(
        [
          {
            ...messages[0],
            message: "Image",
            content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
          },
        ],
        "native",
        { existingPath: original!.path }
      );
      expect(result).toBeNull();
      expect(app.files.get(original!.path)!.contents).toBe(content);
      expect(app.vault.modify).not.toHaveBeenCalled();
      expect(app.vault.adapter.write).not.toHaveBeenCalled();
    });

    it("round-trips messages, backendId, and label", async () => {
      const messages = [makeMessage(USER_SENDER, "hello world"), makeMessage(AI_SENDER, "hi back")];
      const saved = await manager.saveSession(messages, "native", { label: "My chat" });
      expect(saved).not.toBeNull();

      const file = app.files.get(saved!.path)!;
      const loaded = await manager.loadFile(file as unknown as TFile);
      expect(loaded.backendId).toBe("native");
      expect(loaded.label).toBe("My chat");
      expect(loaded.messages).toHaveLength(2);
      expect(loaded.messages[0].sender).toBe(USER_SENDER);
      expect(loaded.messages[0].message).toBe("hello world");
      expect(loaded.messages[1].sender).toBe(AI_SENDER);
      expect(loaded.messages[1].message).toBe("hi back");
    });

    it("writes under the folder captured at entry, not one a mid-save root change swaps in", async () => {
      const folderMock = jest.mocked(getEffectiveConversationsFolder);
      folderMock.mockReturnValueOnce("old-folder");

      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "native", {});

      expect(saved).not.toBeNull();
      expect(saved!.path.startsWith("old-folder/")).toBe(true);
      expect(saved!.path).not.toContain("test-folder");
    });

    it("writes the built-in conversation tag independent of the persisted setting", async () => {
      (getSettings as jest.Mock).mockReturnValueOnce({
        defaultSaveFolder: "test-folder",
        defaultConversationTag: "user-custom-tag",
        defaultConversationNoteName: "{$date}_{$time}__{$topic}",
      });
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "native", {});
      const contents = app.files.get(saved!.path)!.contents!;
      expect(contents).toContain("tags:\n  - scribe-conversation");
      expect(contents).not.toContain("user-custom-tag");
    });

    it("escapes and round-trips a label containing quotes and backslashes", async () => {
      const tricky = 'has "quotes" and \\backslashes\\';
      const messages = [makeMessage(USER_SENDER, "hi")];
      const saved = await manager.saveSession(messages, "opencode", { label: tricky });
      expect(saved).not.toBeNull();
      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.label).toBe(tricky);
    });

    it("strips control characters from labels so they can't break frontmatter", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const saved = await manager.saveSession(messages, "opencode", {
        label: "first\nsecond\rthird",
      });
      const raw = app.files.get(saved!.path)!.contents!;
      const labelLines = raw.split("\n").filter((l) => l.startsWith("agentLabel:"));
      expect(labelLines).toHaveLength(1);
      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.label).toBe("first second third");
    });

    it("returns null when given zero messages instead of writing an empty file", async () => {
      const result = await manager.saveSession([], "opencode");
      expect(result).toBeNull();
      expect(app.files.size).toBe(0);
    });

    it("round-trips a real projectId for a project-scoped chat", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const saved = await manager.saveSession(messages, "native", { projectId: "proj-123" });
      expect(saved).not.toBeNull();

      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).toContain('projectId: "proj-123"');

      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.projectId).toBe("proj-123");
    });

    it.each([
      ["omitted", undefined],
      ["GLOBAL_SCOPE", GLOBAL_SCOPE],
      ["blank", "   "],
    ])(
      "writes no projectId frontmatter and loads as GLOBAL_SCOPE when projectId is %s",
      async (_label, projectId) => {
        const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "native", {
          projectId,
        });
        const raw = app.files.get(saved!.path)!.contents!;
        expect(raw).not.toContain("projectId:");

        const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
        expect(loaded.projectId).toBe(GLOBAL_SCOPE);
      }
    );

    it("normalizes a padded projectId option before writing frontmatter", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const saved = await manager.saveSession(messages, "native", { projectId: " proj-123 " });
      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).toContain('projectId: "proj-123"');
      expect(raw).not.toContain('projectId: " proj-123 "');

      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.projectId).toBe("proj-123");
    });

    it("round-trips a SessionUsage snapshot through save/load", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const usage = {
        usedTokens: 42_000,
        contextWindow: 200_000,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5000,
        cacheWriteTokens: 300,
        updatedAt: 1_700_000_000_000,
      };
      const saved = await manager.saveSession(messages, "native", { usage });
      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).toContain(`usage: '${JSON.stringify(usage)}'`);

      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.usage).toEqual(usage);
    });

    it("round-trips the persisted usage when a later save omits it", async () => {
      const messages = [makeMessage(USER_SENDER, "hi")];
      const usage = { usedTokens: 5000, contextWindow: 200_000, updatedAt: 1 };
      const first = await manager.saveSession(messages, "native", { usage });
      Object.setPrototypeOf(app.files.get(first!.path)!, TFile.prototype);
      const second = await manager.saveSession(messages, "native", {
        existingPath: first!.path,
      });
      const loaded = await manager.loadFile(app.files.get(second!.path) as unknown as TFile);
      expect(loaded.usage).toEqual(usage);
    });

    it("leaves usage undefined for a chat saved without it", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "native");
      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).not.toContain("usage:");
      const loaded = await manager.loadFile(app.files.get(saved!.path) as unknown as TFile);
      expect(loaded.usage).toBeUndefined();
    });

    it("keeps an existing note's epoch when a later save's first message carries a different time, so chat links keep working", async () => {
      const first = await manager.saveSession(
        [makeMessage(USER_SENDER, "hi", 1792522547700)],
        "native"
      );
      const note = app.files.get(first!.path)!;
      Object.setPrototypeOf(note, TFile.prototype);

      await manager.saveSession(
        [makeMessage(USER_SENDER, "hi", 1792522549569), makeMessage(AI_SENDER, "hello")],
        "native",
        { existingPath: first!.path }
      );

      expect(note.contents).toContain("epoch: 1792522547700\n");
      expect(note.contents).not.toContain("1792522549569");
    });

    it("keeps frontmatter properties it does not manage when it saves an existing chat again", async () => {
      const first = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "native", {
        sessionId: "s1",
      });
      const note = app.files.get(first!.path)!;
      Object.setPrototypeOf(note, TFile.prototype);
      note.contents = note.contents!.replace(
        "backendId: native\n",
        'backendId: native\ntopic: "Renamed"\nstatus: done\n'
      );

      await manager.saveSession(
        [makeMessage(USER_SENDER, "hi"), makeMessage(AI_SENDER, "hello")],
        "native",
        { existingPath: first!.path, usage: { usedTokens: 5, updatedAt: 1 } }
      );

      expect(note.contents).toContain(
        'backendId: native\ntopic: "Renamed"\nstatus: done\nsessionId: "s1"\n'
      );
      expect(note.contents).toContain('usage: \'{"usedTokens":5,"updatedAt":1}\'');
      expect(note.contents).toContain("**ai**: hello");
    });

    it("keeps a property written to the note even when the metadata cache still holds its older value", async () => {
      const first = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "native");
      const note = app.files.get(first!.path)!;
      Object.setPrototypeOf(note, TFile.prototype);
      note.contents = note.contents!.replace("tags:", 'topic: "New"\ntags:');
      app.metadataCache.getFileCache.mockReturnValue({
        frontmatter: { topic: "Old" },
      } as never);

      await manager.saveSession([makeMessage(USER_SENDER, "hi")], "native", {
        existingPath: first!.path,
      });

      expect(note.contents).toContain('topic: "New"\n');
      expect(note.contents).not.toContain("Old");
    });

    it("drops the projectId of a project chat that is saved again as a global chat", async () => {
      const first = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "native", {
        projectId: "proj-123",
      });

      await manager.saveSession([makeMessage(USER_SENDER, "hi")], "native", {
        existingPath: first!.path,
        projectId: GLOBAL_SCOPE,
      });

      expect(app.files.get(first!.path)!.contents).not.toContain("projectId:");
    });
    it("preserves separate chats when their filenames collide", async () => {
      const first = await manager.saveSession(
        [makeMessage(USER_SENDER, "hi"), makeMessage(AI_SENDER, "First answer")],
        "native",
        { sessionId: "old-session", projectId: "first-project" }
      );
      const original = app.files.get(first!.path)!.contents;
      const second = await manager.saveSession(
        [makeMessage(USER_SENDER, "hi"), makeMessage(AI_SENDER, "Second answer")],
        "native",
        { sessionId: "new-session", projectId: "second-project" }
      );
      const third = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "native", {
        sessionId: "third-session",
      });

      expect(new Set([first!.path, second!.path, third!.path]).size).toBe(3);
      expect(app.files.get(first!.path)!.contents).toBe(original);
      expect(app.files.get(second!.path)!.contents).toContain("Second answer");
      expect(app.files.get(second!.path)!.contents).toContain('sessionId: "new-session"');
      expect(app.files.get(second!.path)!.contents).not.toContain("first-project");

      await manager.saveSession([makeMessage(USER_SENDER, "updated second")], "native", {
        sessionId: "new-session",
        existingPath: second!.path,
      });
      expect(app.files.size).toBe(3);
      expect(app.files.get(second!.path)!.contents).toContain("updated second");
      expect(app.files.get(first!.path)!.contents).toBe(original);
    });
  });

  describe("setPinnedAt", () => {
    it("pins a chat by writing the pin time to its note's frontmatter", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "native");

      await manager.setPinnedAt(saved!.path, 1_760_000_000_000);

      expect(app.files.get(saved!.path)!.contents).toContain("pinnedAt: 1760000000000\n");
    });

    it("unpins a chat by removing the pinnedAt key from its note's frontmatter", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "native");
      await manager.setPinnedAt(saved!.path, 1_760_000_000_000);

      await manager.setPinnedAt(saved!.path, null);

      expect(app.files.get(saved!.path)!.contents).not.toContain("pinnedAt");
    });

    it("rejects pinning a note that was moved or deleted so the row is not shown pinned", async () => {
      await expect(
        manager.setPinnedAt("test-folder/agent__gone.md", 1_760_000_000_000)
      ).rejects.toThrow("test-folder/agent__gone.md");
      expect(app.files.has("test-folder/agent__gone.md")).toBe(false);
    });

    it("keeps a chat's pin through later autosaves", async () => {
      const saved = await manager.saveSession([makeMessage(USER_SENDER, "hi")], "native");
      await manager.setPinnedAt(saved!.path, 1_760_000_000_000);

      await manager.saveSession(
        [makeMessage(USER_SENDER, "hi"), makeMessage(AI_SENDER, "hi again")],
        "native",
        { existingPath: saved!.path }
      );

      expect(app.files.get(saved!.path)!.contents).toContain("pinnedAt: 1760000000000\n");
    });
  });

  describe("loadFile", () => {
    it("throws on missing backendId instead of silently defaulting", async () => {
      const path = "test-folder/agent__broken.md";
      await app.vault.adapter.write(
        path,
        ["---", "epoch: 1735732800000", "mode: agent", "---", "", "**user**: hi"].join("\n")
      );
      await expect(
        manager.loadFile({ path, basename: "agent__broken" } as unknown as TFile)
      ).rejects.toThrow(/Missing backendId/);
    });

    it("assigns deterministic ids that depend only on message timestamp", async () => {
      const messages = [
        makeMessage(USER_SENDER, "first", 1700000000000),
        makeMessage(AI_SENDER, "second", 1700000000001),
      ];
      const saved = await manager.saveSession(messages, "native");
      const file = app.files.get(saved!.path)!;

      const loadedA = await manager.loadFile(file as unknown as TFile);
      const loadedB = await manager.loadFile(file as unknown as TFile);
      expect(loadedA.messages.map((m) => m.id)).toEqual(loadedB.messages.map((m) => m.id));
      expect(loadedA.messages[0].id.startsWith("loaded-0-")).toBe(true);
    });

    it("keeps sender markers and timestamp-looking lines inside a message body", async () => {
      const body = "Pasted transcript:\n**user**: hello\n\n**ai**: hi\n[Timestamp: not a real one]";
      const messages = [
        makeMessage(USER_SENDER, body, 1700000000000),
        makeMessage(AI_SENDER, "ok", 1700000000001),
      ];

      const saved = await manager.saveSession(messages, "native");
      const loaded = await manager.loadFile(app.files.get(saved!.path)! as unknown as TFile);

      expect(loaded.messages).toHaveLength(2);
      expect(loaded.messages[0].message).toBe(body);
      expect(loaded.messages[1].message).toBe("ok");
    });

    it("maps a legacy agent__ chat with no projectId frontmatter to GLOBAL_SCOPE", async () => {
      const path = "test-folder/agent__legacy.md";
      await app.vault.adapter.write(
        path,
        [
          "---",
          "epoch: 1735732800000",
          "mode: agent",
          "backendId: native",
          "---",
          "",
          "**user**: hi",
        ].join("\n")
      );
      const loaded = await manager.loadFile(app.files.get(path) as unknown as TFile);
      expect(loaded.projectId).toBe(GLOBAL_SCOPE);
    });

    it("keeps the frontmatter epoch's milliseconds when a loaded chat is saved again", async () => {
      const path = "test-folder/agent__with-ms.md";
      await app.vault.adapter.write(
        path,
        [
          "---",
          "epoch: 1789109351267",
          "mode: agent",
          "backendId: native",
          "---",
          "",
          "**user**: hi",
          "[Timestamp: 2026/09/10 23:49:11]",
          "",
          "**ai**: hello",
          "[Timestamp: 2026/09/10 23:49:15]",
        ].join("\n")
      );

      const loaded = await manager.loadFile(app.files.get(path) as unknown as TFile);
      expect(loaded.messages[0].timestamp?.epoch).toBe(1789109351267);
      expect(loaded.messages[0].timestamp?.display).toBe("2026/09/10 23:49:11");
      expect(loaded.messages[1].timestamp?.epoch).toBe(new Date("2026/09/10 23:49:15").getTime());

      const saved = await manager.saveSession(loaded.messages, "native");
      const raw = app.files.get(saved!.path)!.contents!;
      expect(raw).toContain("epoch: 1789109351267\n");
      expect(raw).toContain("[Timestamp: 2026/09/10 23:49:11]");
    });

    it.each([
      ["has no epoch", []],
      ["has a non-numeric epoch", ["epoch: soon"]],
      ["has a zero epoch", ["epoch: 0"]],
      ["has a fractional epoch that chat links cannot carry", ["epoch: 1789109351267.5"]],
    ])("falls back to the visible timestamp when the note %s", async (_label, epochLines) => {
      const path = "test-folder/agent__no-epoch.md";
      await app.vault.adapter.write(
        path,
        [
          "---",
          ...epochLines,
          "mode: agent",
          "backendId: native",
          "---",
          "",
          "**user**: hi",
          "[Timestamp: 2026/09/10 23:49:11]",
        ].join("\n")
      );
      const visibleEpoch = new Date("2026/09/10 23:49:11").getTime();

      const loaded = await manager.loadFile(app.files.get(path) as unknown as TFile);
      expect(loaded.messages[0].timestamp?.epoch).toBe(visibleEpoch);

      const saved = await manager.saveSession(loaded.messages, "native");
      expect(app.files.get(saved!.path)!.contents).toContain(`epoch: ${visibleEpoch}\n`);
    });

    it("ignores malformed usage JSON in a historical backend record instead of failing the load", async () => {
      const path = "test-folder/agent__badusage.md";
      await app.vault.adapter.write(
        path,
        [
          "---",
          "epoch: 1735732800000",
          "mode: agent",
          "backendId: claude",
          "usage: 'not-json{'",
          "---",
          "",
          "**user**: hi",
        ].join("\n")
      );
      const loaded = await manager.loadFile(app.files.get(path) as unknown as TFile);
      expect(loaded.usage).toBeUndefined();
      expect(loaded.backendId).toBe("claude");
    });
  });
});
