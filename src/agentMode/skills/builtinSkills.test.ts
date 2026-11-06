import { createHash } from "node:crypto";
import {
  BUILTIN_SKILL_PROVENANCE,
  getBuiltinSkillPackages,
} from "@/agentMode/skills/builtinSkills";
import { parseSkillFile } from "@/agentMode/skills/skillFormat";

describe("builtinSkills", () => {
  describe("getBuiltinSkillPackages()", () => {
    it("includes the seven promised builtin skills with valid descriptors and their supporting files", () => {
      const packages = getBuiltinSkillPackages();
      expect(packages.map((skill) => skill.name)).toEqual([
        "skill-creator",
        "defuddle",
        "json-canvas",
        "knap",
        "obsidian-bases",
        "obsidian-cli",
        "obsidian-markdown",
      ]);
      for (const skill of packages) {
        const descriptor = skill.files.find((file) => file.path === "SKILL.md");
        const content = new TextDecoder().decode(descriptor?.data);
        expect(parseSkillFile(content, skill.name).frontmatter.name).toBe(skill.name);
        expect(skill.source.kind).toBe("builtin");
        expect(skill.files.some((file) => file.path === "SCRIBE-COMPATIBILITY.md")).toBe(true);
      }
    });

    it("preserves the pinned package contents, complete supporting files, and bundled licenses", () => {
      const packages = getBuiltinSkillPackages();
      const expected = [
        ["skill-creator", 19, "a8ce5c6fbf5e1102f44824188dcb4a0cc7943ccb72e80fb75a2d6781e9bda431"],
        ["defuddle", 3, "22c7cf33d5575110e0c600026023b34cf9a6ff6c9466f6079e264d9a4b8346e0"],
        ["json-canvas", 4, "1d7be0269d2bbe37f1ee2eedcdf4ebbed9fe01bf70624ab70138290a999938a9"],
        ["knap", 3, "0ea4fbc8e8b836c52c137c5733fe44f242c06e59e3b429859c66893c1995b5ba"],
        ["obsidian-bases", 4, "4d955d87458d13bec411cfa25c36c632a4cce324e69c2e4c29362fced7b7a6e4"],
        ["obsidian-cli", 3, "9b05a00a0692658aa1bc7ac73fd08906dca5f5b9fc196c20ab0711544a837cfa"],
        [
          "obsidian-markdown",
          6,
          "02f5f80410cfe1bb185a4d5b0944fc273360065cbc9ea2aff237a25129ca806e",
        ],
      ];
      expect(
        packages.map((skill) => {
          const hash = createHash("sha256");
          for (const file of skill.files)
            hash.update(file.path).update("\0").update(file.data).update("\0");
          return [skill.name, skill.files.length, hash.digest("hex")];
        })
      ).toEqual(expected);

      const creatorLicense = packages[0].files.find((file) => file.path === "LICENSE.txt");
      expect(new TextDecoder().decode(creatorLicense?.data)).toContain("Apache License");
      for (const skill of packages.slice(1)) {
        const license = skill.files.find((file) => file.path === "LICENSE");
        const text = new TextDecoder().decode(license?.data);
        expect(text).toContain("MIT License");
        expect(text).toContain("Copyright (c) 2026 Steph Ango (@kepano)");
      }
    });

    it("pins provenance to the vendored commits and keeps an unchanged origin across upgrades", () => {
      const packages = getBuiltinSkillPackages();
      expect(packages[0].source).toEqual({
        kind: "builtin",
        origin: "https://github.com/anthropics/skills/tree/main/skills/skill-creator",
        version: "ca45fc496a3436251f191354091d557da31c15b5",
      });
      expect(packages.slice(1).map((skill) => skill.source.version)).toEqual(
        Array(6).fill("3ccff5338ea700537839b21900aa5358a0402c98")
      );
      expect(BUILTIN_SKILL_PROVENANCE.map((skill) => skill.name)).toEqual(
        packages.map((skill) => skill.name)
      );
      for (const record of BUILTIN_SKILL_PROVENANCE) {
        expect(record.sourceUrl).toBe(
          `${record.repository}/tree/${record.revision}/${record.upstreamPath}`
        );
        expect(record.adaptedFiles).toEqual(["SKILL.md"]);
        expect(Object.isFrozen(record)).toBe(true);
      }
      expect(Object.isFrozen(BUILTIN_SKILL_PROVENANCE)).toBe(true);
    });

    it("keeps skill-creator naturally invocable and requires the Scribe draft confirmation flow", () => {
      const creator = getBuiltinSkillPackages()[0];
      const descriptor = creator.files.find((file) => file.path === "SKILL.md");
      const parsed = parseSkillFile(new TextDecoder().decode(descriptor?.data), creator.name);
      expect(parsed.frontmatter.disableModelInvocation).toBeUndefined();
      expect(parsed.frontmatter.userInvocable).toBeUndefined();
      expect(parsed.body).toContain("propose_skill");
      expect(parsed.body).toContain("Only the user's explicit Save action installs the skill");
      expect(parsed.body).toContain("Do not run the Claude-specific");
      expect(parsed.body).toContain(".scribe/skills/.workspaces/<skill-name>/");
    });

    it("returns independent package files so an installation cannot alter future builtin copies", () => {
      const first = getBuiltinSkillPackages();
      const originalByte = first[0].files[0].data[0];
      first[0].files[0].data[0] ^= 255;
      first[0].files.pop();
      first.pop();

      const next = getBuiltinSkillPackages();
      expect(next).toHaveLength(7);
      expect(next[0].files).toHaveLength(19);
      expect(next[0].files[0].data[0]).toBe(originalByte);
    });
  });
});
