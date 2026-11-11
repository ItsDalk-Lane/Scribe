import type { App } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import * as path from "node:path";
import { getScribeDataPath } from "./appPaths";

describe("appPaths", () => {
  describe("getScribeDataPath()", () => {
    it("uses the current vault instead of the operating system home directory", () => {
      const Adapter = FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter;
      const app = { vault: { adapter: new Adapter("/Users/me/My Vault") } } as unknown as App;
      expect(getScribeDataPath(app)).toBe(path.join("/Users/me/My Vault", ".scribe"));
    });
    it("rejects a vault without a desktop filesystem", () => {
      expect(() => getScribeDataPath({ vault: { adapter: {} } } as App)).toThrow("desktop vault");
    });
  });

  it("does not require Node built-ins at module evaluation time", () => {
    const throwingIds = ["path", "node:path"];
    try {
      jest.isolateModules(() => {
        for (const id of throwingIds) {
          jest.doMock(id, () => {
            throw new Error(`eager require of ${id}`);
          });
        }
        expect(() => void jest.requireActual("./appPaths")).not.toThrow();
      });
    } finally {
      for (const id of throwingIds) jest.dontMock(id);
    }
  });
});
