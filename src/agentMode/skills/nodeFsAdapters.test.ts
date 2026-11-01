import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeMigrateSkillFs } from "./nodeFsAdapters";

describe("nodeFsAdapters", () => {
  describe("createNodeMigrateSkillFs()", () => {
    it("preserves an existing user file when an exclusive skill creation races another write", async () => {
      const folder = await mkdtemp(join(tmpdir(), "scribe-skill-create-"));
      const file = join(folder, "SKILL.md");
      try {
        await writeFile(file, "User instructions");
        const adapter = createNodeMigrateSkillFs();
        await expect(adapter.writeFile(file, "Replacement", "wx")).rejects.toMatchObject({
          code: "EEXIST",
        });
        expect(await readFile(file, "utf8")).toBe("User instructions");
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });
  });
});
