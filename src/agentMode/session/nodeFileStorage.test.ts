import {
  createNodeFileStorage,
  createNodeSnapshotStorage,
} from "@/agentMode/session/nodeFileStorage";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: (name: string) => jest.requireActual(name),
}));

describe("nodeFileStorage", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), "scribe-snapshot-test-"));
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  describe("createNodeFileStorage()", () => {
    it("creates parent folders and reads the stored contents", async () => {
      const storage = createNodeFileStorage();
      const path = join(directory, "nested", "state.json");
      expect(await storage.exists(path)).toBe(false);
      await storage.write(path, "saved");
      expect(await storage.exists(path)).toBe(true);
      expect(await storage.read(path)).toBe("saved");
    });
  });

  describe("createNodeSnapshotStorage()", () => {
    it("replaces a snapshot and removes it without leaving temporary files", async () => {
      const storage = createNodeSnapshotStorage();
      const path = join(directory, "state.json");
      await storage.write(path, "first");
      await storage.write(path, "second");
      expect(await storage.read(path)).toBe("second");
      expect(await fs.readdir(directory)).toEqual(["state.json"]);
      await storage.remove(path);
      expect(await storage.exists(path)).toBe(false);
      await expect(storage.remove(path)).resolves.toBeUndefined();
    });

    it("preserves the prior snapshot if replacing it fails and cleans the temporary file", async () => {
      const storage = createNodeSnapshotStorage();
      const path = join(directory, "state.json");
      await storage.write(path, "first");
      jest
        .spyOn(jest.requireActual<typeof fs>("node:fs/promises"), "rename")
        .mockRejectedValueOnce(new Error("Replacement failed"));

      await expect(createNodeSnapshotStorage().write(path, "second")).rejects.toThrow(
        "Replacement failed"
      );

      expect(await storage.read(path)).toBe("first");
      expect(await fs.readdir(directory)).toEqual(["state.json"]);
    });
  });
});
