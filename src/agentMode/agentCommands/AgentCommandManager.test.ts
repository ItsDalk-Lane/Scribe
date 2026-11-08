import type { App } from "obsidian";
import { act, renderHook } from "@testing-library/react";
import {
  AgentCommandManager,
  getAgentCommands,
  subscribeAgentCommands,
  useAgentCommands,
  type AgentCommandDefinition,
} from "./AgentCommandManager";

const example: AgentCommandDefinition = {
  id: "translate",
  name: "翻译",
  description: "译成英文",
  content: "请把下面的内容翻译成英文：",
  enabled: true,
};

function fixture() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const adapter = {
    exists: async (path: string) => files.has(path) || dirs.has(path),
    stat: async (path: string) => (dirs.has(path) ? { type: "folder" } : null),
    mkdir: async (path: string) => {
      dirs.add(path);
    },
    list: async () => ({ files: [...files.keys()], folders: [] }),
    read: async (path: string) => {
      if (!files.has(path)) throw new Error("Missing");
      return files.get(path)!;
    },
    write: jest.fn(async (path: string, text: string) => {
      files.set(path, text);
    }),
    rename: async (from: string, to: string) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    remove: async (path: string) => {
      files.delete(path);
    },
  };
  const manager = AgentCommandManager.getInstance({ vault: { adapter } } as unknown as App);
  return { files, dirs, adapter, manager };
}

describe("AgentCommandManager", () => {
  beforeEach(() => AgentCommandManager.reset());
  describe("AgentCommandManager", () => {
    describe("save()", () => {
      it("writes each command as its own hidden JSON file without a stored revision and publishes it", async () => {
        const f = fixture();
        await f.manager.save(example);
        await f.manager.save({ ...example, id: "weekly", name: "周报" });
        expect(getAgentCommands().map((command) => command.name)).toEqual(["翻译", "周报"]);
        expect([...f.files.keys()]).toEqual([
          ".scribe/agent-commands/translate.json",
          ".scribe/agent-commands/weekly.json",
        ]);
        expect(
          JSON.parse(f.files.get(".scribe/agent-commands/translate.json")!)
        ).not.toHaveProperty("revision");
      });

      it("rejects a name the built-in compact command already uses, ignoring case and surrounding spaces", async () => {
        const f = fixture();
        await expect(f.manager.save({ ...example, name: " Compact " })).rejects.toThrow();
        expect(f.files.size).toBe(0);
      });

      it("rejects a name another command already uses, while letting a command keep its own name when edited", async () => {
        const f = fixture();
        await f.manager.save(example);
        await expect(f.manager.save({ ...example, id: "other" })).rejects.toThrow();
        expect(f.files.has(".scribe/agent-commands/other.json")).toBe(false);
        const [opened] = getAgentCommands();
        await f.manager.save({ ...example, content: "新的内容", revision: opened.revision });
        expect(getAgentCommands()[0]).toEqual(
          expect.objectContaining({ name: "翻译", content: "新的内容" })
        );
      });

      it("refuses to overwrite a command edited outside Scribe after it was opened and keeps the external edit", async () => {
        const f = fixture();
        await f.manager.save(example);
        const [opened] = getAgentCommands();
        f.files.set(
          ".scribe/agent-commands/translate.json",
          JSON.stringify({ ...example, content: "外部修改" })
        );
        await expect(f.manager.save({ ...opened, content: "Scribe 草稿" })).rejects.toThrow();
        expect(JSON.parse(f.files.get(".scribe/agent-commands/translate.json")!).content).toBe(
          "外部修改"
        );
      });

      it("rejects a blank name or blank content without writing anything", async () => {
        const f = fixture();
        await expect(f.manager.save({ ...example, name: "  " })).rejects.toThrow();
        await expect(f.manager.save({ ...example, content: " \n " })).rejects.toThrow();
        expect(f.files.size).toBe(0);
      });
    });

    describe("remove()", () => {
      it("deletes a command whose revision still matches its file", async () => {
        const f = fixture();
        await f.manager.save(example);
        await f.manager.remove(getAgentCommands()[0]);
        expect(f.files.has(".scribe/agent-commands/translate.json")).toBe(false);
        expect(getAgentCommands()).toEqual([]);
      });

      it("refuses to delete a command edited outside Scribe after it was opened and keeps the file", async () => {
        const f = fixture();
        await f.manager.save(example);
        const [opened] = getAgentCommands();
        f.files.set(
          ".scribe/agent-commands/translate.json",
          JSON.stringify({ ...example, content: "外部修改" })
        );
        await expect(f.manager.remove(opened)).rejects.toThrow();
        expect(f.files.has(".scribe/agent-commands/translate.json")).toBe(true);
      });
    });

    describe("refresh()", () => {
      it("loads hidden command files and re-reads external edits without a note index", async () => {
        const f = fixture();
        f.dirs.add(".scribe/agent-commands");
        f.files.set(".scribe/agent-commands/translate.json", JSON.stringify(example));
        expect((await f.manager.refresh()).map((command) => command.name)).toEqual(["翻译"]);
        f.files.set(
          ".scribe/agent-commands/translate.json",
          JSON.stringify({ ...example, name: "译文" })
        );
        expect((await f.manager.refresh())[0].name).toBe("译文");
      });

      it("ignores files whose names do not follow the identifier rule", async () => {
        const f = fixture();
        f.dirs.add(".scribe/agent-commands");
        f.files.set(".scribe/agent-commands/notes.md", "# 备注");
        f.files.set(".scribe/agent-commands/bad name.json", JSON.stringify(example));
        expect(await f.manager.refresh()).toEqual([]);
      });

      it("keeps the prior inventory when a corrupt file prevents a complete refresh", async () => {
        const f = fixture();
        await f.manager.save(example);
        f.files.set(".scribe/agent-commands/translate.json", "broken");
        await expect(f.manager.refresh()).rejects.toThrow();
        expect(getAgentCommands()[0].name).toBe("翻译");
      });
    });

    describe("reset()", () => {
      it("releases the published inventory and the shared service", async () => {
        const f = fixture();
        await f.manager.save(example);
        AgentCommandManager.reset();
        expect(getAgentCommands()).toEqual([]);
        expect(() => AgentCommandManager.getInstance()).toThrow();
      });
    });
  });

  describe("getAgentCommands()", () => {
    it("returns an empty inventory before any command has been read", () => {
      expect(getAgentCommands()).toEqual([]);
    });
  });

  describe("subscribeAgentCommands()", () => {
    it("notifies a listener when the inventory changes and stops notifying it after unsubscribing", async () => {
      const f = fixture();
      const listener = jest.fn();
      const unsubscribe = subscribeAgentCommands(listener);
      await f.manager.save(example);
      const notified = listener.mock.calls.length;
      expect(notified).toBeGreaterThan(0);
      unsubscribe();
      await f.manager.save({ ...example, id: "weekly", name: "周报" });
      expect(listener).toHaveBeenCalledTimes(notified);
    });
  });

  describe("useAgentCommands()", () => {
    it("re-renders the consumer when a command is saved", async () => {
      const f = fixture();
      const { result } = renderHook(() => useAgentCommands());
      expect(result.current).toEqual([]);
      await act(async () => {
        await f.manager.save(example);
      });
      expect(result.current.map((command) => command.name)).toEqual(["翻译"]);
    });
  });
});
