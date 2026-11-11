import type { App } from "obsidian";
import { act, renderHook } from "@testing-library/react";
import {
  SubagentManager,
  getSubagents,
  useSubagents,
  type SubagentDefinition,
} from "./SubagentManager";

const example: SubagentDefinition = {
  id: "research",
  name: "Researcher",
  description: "Find sources",
  instructions: "Always cite the sources you read.",
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
  const manager = SubagentManager.getInstance({ vault: { adapter } } as unknown as App);
  return { files, dirs, adapter, manager };
}

describe("SubagentManager", () => {
  beforeEach(() => SubagentManager.reset());
  describe("SubagentManager", () => {
    describe("getInstance()", () => {
      it("requires the app initially and shares one service for the plugin lifecycle", () => {
        expect(() => SubagentManager.getInstance()).toThrow();
        const { manager } = fixture();
        expect(SubagentManager.getInstance()).toBe(manager);
      });
    });
    describe("reset()", () => {
      it("releases definitions and the previous service", async () => {
        const { manager } = fixture();
        await manager.save(example);
        SubagentManager.reset();
        expect(getSubagents()).toEqual([]);
        expect(() => SubagentManager.getInstance()).toThrow();
      });
    });
    describe("refresh()", () => {
      it("rejects numeric identifiers rather than exposing an undelegatable definition", async () => {
        const f = fixture();
        f.dirs.add(".scribe/subagents");
        f.files.set(".scribe/subagents/123.json", JSON.stringify({ ...example, id: 123 }));
        await expect(f.manager.refresh()).rejects.toThrow("标识");
        expect(getSubagents()).toEqual([]);
      });
      it("does not publish an old vault read after the plugin is reset", async () => {
        const f = fixture();
        await f.manager.save(example);
        let started!: () => void;
        const reading = new Promise<void>((resolve) => {
          started = resolve;
        });
        let release!: (value: string) => void;
        const content = new Promise<string>((resolve) => {
          release = resolve;
        });
        f.adapter.read = async () => {
          started();
          return content;
        };
        const pending = f.manager.refresh();
        await reading;
        SubagentManager.reset();
        const next = fixture();
        await next.manager.save({ ...example, id: "next", name: "Next vault" });
        release(JSON.stringify(example));
        await pending;
        expect(getSubagents().map((entry) => entry.name)).toEqual(["Next vault"]);
        await expect(f.manager.refresh()).rejects.toMatchObject({ name: "AbortError" });
      });
      it("loads hidden definitions and re-reads external edits without a note index", async () => {
        const f = fixture();
        f.dirs.add(".scribe/subagents");
        f.files.set(".scribe/subagents/research.json", JSON.stringify(example));
        expect(await f.manager.refresh()).toEqual([expect.objectContaining(example)]);
        f.files.set(
          ".scribe/subagents/research.json",
          JSON.stringify({ ...example, name: "Writer" })
        );
        expect((await f.manager.refresh())[0].name).toBe("Writer");
      });
      it("keeps the prior inventory when an invalid file prevents a complete refresh", async () => {
        const f = fixture();
        await f.manager.save(example);
        f.files.set(".scribe/subagents/research.json", "broken");
        await expect(f.manager.refresh()).rejects.toThrow();
        expect(getSubagents()[0].name).toBe("Researcher");
      });
    });
    describe("save()", () => {
      it("creates independent JSON files, edits instructions and disables one definition", async () => {
        const f = fixture();
        await f.manager.save(example);
        await f.manager.save({ ...example, id: "writing", name: "Writer" });
        await f.manager.save({
          ...getSubagents()[0],
          instructions: "Review carefully",
          enabled: false,
        });
        expect(getSubagents()).toEqual([
          expect.objectContaining({
            id: "research",
            instructions: "Review carefully",
            enabled: false,
          }),
          expect.objectContaining({ id: "writing", enabled: true }),
        ]);
        expect([...f.files.keys()]).toEqual([
          ".scribe/subagents/research.json",
          ".scribe/subagents/writing.json",
        ]);
        expect(JSON.parse(f.files.get(".scribe/subagents/research.json")!)).not.toHaveProperty(
          "revision"
        );
      });
      it("retains the saved file and inventory when the next write fails", async () => {
        const f = fixture();
        await f.manager.save(example);
        const before = f.files.get(".scribe/subagents/research.json");
        f.adapter.write.mockRejectedValueOnce(new Error("Disk full"));
        await expect(f.manager.save({ ...getSubagents()[0], name: "New name" })).rejects.toThrow(
          "Disk full"
        );
        expect(f.files.get(".scribe/subagents/research.json")).toBe(before);
        expect(getSubagents()[0].name).toBe("Researcher");
      });
      it("refuses stale edits, deleted records and invalid identifiers without overwriting files", async () => {
        const f = fixture();
        await f.manager.save(example);
        const opened = getSubagents()[0];
        f.files.set(
          ".scribe/subagents/research.json",
          JSON.stringify({ ...example, name: "External" })
        );
        await expect(f.manager.save({ ...opened, name: "Stale" })).rejects.toThrow("其他操作");
        f.files.delete(".scribe/subagents/research.json");
        await expect(f.manager.save(opened)).rejects.toThrow("删除");
        await expect(f.manager.save({ ...example, id: "../escape" })).rejects.toThrow("标识");
        await expect(f.manager.save({ ...example, name: " " })).rejects.toThrow("填写");
        expect(f.files.size).toBe(0);
      });
    });
    describe("remove()", () => {
      it("removes only the selected definition and updates the inventory", async () => {
        const f = fixture();
        await f.manager.save(example);
        await f.manager.save({ ...example, id: "other" });
        await f.manager.remove("research");
        await f.manager.remove("research");
        expect(getSubagents().map((x) => x.id)).toEqual(["other"]);
        expect([...f.files.keys()]).toEqual([".scribe/subagents/other.json"]);
      });
    });
  });
  describe("getSubagents()", () => {
    it("returns a stable empty snapshot and the current saved definitions", async () => {
      expect(getSubagents()).toBe(getSubagents());
      await fixture().manager.save(example);
      expect(getSubagents()[0].id).toBe("research");
    });
  });
  describe("useSubagents()", () => {
    it("updates mounted settings when definitions are saved and removed", async () => {
      const { manager } = fixture();
      const view = renderHook(() => useSubagents());
      expect(view.result.current).toEqual([]);
      await act(() => manager.save(example));
      expect(view.result.current[0].name).toBe("Researcher");
      await act(() => manager.remove(example.id));
      expect(view.result.current).toEqual([]);
    });
  });
});
