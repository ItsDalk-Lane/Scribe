import { AgentChatPersistenceManager } from "./AgentChatPersistenceManager";
import { GLOBAL_SCOPE } from "./scope";
import { type App, TFile } from "obsidian";
import { listMarkdownFiles, patchFrontmatter, trashFile } from "@/utils/vaultAdapterUtils";

jest.mock("@/logger");
jest.mock("@/settings/scribeFolder", () => ({
  getEffectiveConversationsFolder: () => "scribe/old-chats",
}));
jest.mock("@/utils/vaultAdapterUtils", () => ({
  listMarkdownFiles: jest.fn(),
  patchFrontmatter: jest.fn(),
  trashFile: jest.fn(),
}));

function note(path: string, content: string) {
  return Object.assign(Object.create(TFile.prototype), {
    path,
    basename: path.split("/").pop()!.replace(/\.md$/, ""),
    content,
  });
}

function fixture() {
  const file = note(
    "scribe/old-chats/agent__legacy.md",
    "---\nepoch: 1789109351267\nbackendId: native\nsessionId: s1\nagentLabel: 'My chat'\nusage: '{\"usedTokens\":42,\"updatedAt\":1}'\n---\n\n**user**: hello\n[Timestamp: 2026/09/10 23:49:11]\n\n**ai**: hi\n[Timestamp: 2026/09/10 23:49:15]"
  );
  const app = {
    vault: {
      read: jest.fn(async () => file.content),
      getAbstractFileByPath: jest.fn(() => file),
      create: jest.fn(),
      modify: jest.fn(),
    },
  };
  const manager = new AgentChatPersistenceManager(app as unknown as App);
  return { file, app, manager };
}

describe("AgentChatPersistenceManager", () => {
  describe("AgentChatPersistenceManager", () => {
    describe("loadFile()", () => {
      it("loads existing notes without creating or changing a note https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
        const { manager, app, file } = fixture();
        const loaded = await manager.loadFile(file);
        expect(loaded).toMatchObject({
          backendId: "native",
          sessionId: "s1",
          label: "My chat",
          projectId: GLOBAL_SCOPE,
          usage: { usedTokens: 42 },
        });
        expect(loaded.messages.map((message) => message.message)).toEqual(["hello", "hi"]);
        expect(loaded.messages[0].timestamp?.epoch).toBe(1789109351267);
        expect((await manager.loadFile(file)).messages.map((message) => message.id)).toEqual(
          loaded.messages.map((message) => message.id)
        );
        expect(app.vault.create).not.toHaveBeenCalled();
        expect(app.vault.modify).not.toHaveBeenCalled();
      });
      it("preserves quoted sender markers and ignores malformed historical usage", async () => {
        const { manager, file } = fixture();
        file.content =
          "---\nbackendId: native\nusage: not-json\n---\n\n**user**: Pasted:\n**user\u200b**: inner\n[Timestamp:\u200b not a timestamp]\n[Timestamp: 2026/09/10 23:49:11]";
        const loaded = await manager.loadFile(file);
        expect(loaded.usage).toBeUndefined();
        expect(loaded.messages).toHaveLength(1);
        expect(loaded.messages[0].message).toBe(
          "Pasted:\n**user**: inner\n[Timestamp: not a timestamp]"
        );
      });
      it("rejects a note with no backend identity", async () => {
        const { manager, file } = fixture();
        file.content = "**user**: hello";
        await expect(manager.loadFile(file)).rejects.toThrow("Missing backendId");
      });
    });
    describe("getAgentChatHistoryFiles()", () => {
      it("lists existing conversation notes without treating other notes as chats", async () => {
        const { manager, file } = fixture();
        jest
          .mocked(listMarkdownFiles)
          .mockReturnValue([file, note("scribe/old-chats/other.md", "")]);
        expect(await manager.getAgentChatHistoryFiles()).toEqual([file]);
      });
    });
    describe("updateTopic()", () => {
      it("keeps explicit title updates available for an existing legacy note", async () => {
        const { manager, file } = fixture();
        await manager.updateTopic(file.path, " Renamed ");
        expect(patchFrontmatter).toHaveBeenCalledWith(expect.anything(), file.path, {
          topic: "Renamed",
        });
      });
    });
    describe("deleteFile()", () => {
      it("trashes an existing note only after explicit deletion", async () => {
        const { manager, file } = fixture();
        await manager.deleteFile(file.path);
        expect(trashFile).toHaveBeenCalledWith(expect.anything(), file);
      });
      it("rejects deletion when the note is already absent", async () => {
        const { manager, app } = fixture();
        app.vault.getAbstractFileByPath.mockReturnValue(null);
        await expect(manager.deleteFile("missing.md")).rejects.toThrow("Chat file not found");
      });
    });
  });
});
