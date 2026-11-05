import { getBuiltinSkillContentHash, getBuiltinSkillVersion } from "./builtinOwnership";

describe("builtinOwnership", () => {
  describe("getBuiltinSkillVersion()", () => {
    it(`recognizes string and numeric versions in YAML metadata`, () => {
      for (const marker of ['"3"', "3"]) {
        expect(
          getBuiltinSkillVersion(`---\nmetadata:\n  scribe-builtin-version: ${marker}\n---\nbody`)
        ).toBe(3);
      }
    });
    it(`does not claim body examples, top-level fields, malformed YAML, or invalid versions`, () => {
      for (const content of [
        'scribe-builtin-version: "1"',
        '---\nname: user-skill\n---\nExample:\nscribe-builtin-version: "1"',
        '---\nscribe-builtin-version: "1"\n---\nbody',
        '---\nmetadata:\n  independent-builtin-version: "1"\n---\nbody',
        "---\nmetadata: [\n---\nbody",
        "---\nmetadata:\n  scribe-builtin-version: true\n---\nbody",
        '---\nmetadata:\n  scribe-builtin-version: "bad"\n---\nbody',
        "---\nmetadata:\n  scribe-builtin-version: 99999999999999999\n---\nbody",
      ])
        expect(getBuiltinSkillVersion(content)).toBeNull();
    });
  });
  describe("getBuiltinSkillContentHash()", () => {
    it("returns only a valid current content hash from metadata", () => {
      const hash = "a".repeat(64);
      expect(
        getBuiltinSkillContentHash(`---\nmetadata:\n  scribe-content-hash: "${hash}"\n---\nbody`)
      ).toBe(hash);
      expect(
        getBuiltinSkillContentHash(
          `---\nmetadata:\n  independent-content-hash: "${hash}"\n---\nbody`
        )
      ).toBeNull();
    });
  });
});
