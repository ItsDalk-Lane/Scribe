import {
  parseSkillFile,
  serializeSkillFile,
  SkillFormatError,
  validateDescription,
  validateName,
} from "./skillFormat";

const minimalSkill = (overrides: Record<string, string> = {}) => {
  const fm = {
    name: "review-prose",
    description: "Critique writing for clarity, voice, and rhythm.",
    ...overrides,
  };
  const yaml = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `---\n${yaml}\n---\nbody text`;
};

const frontmatterOf = (...lines: string[]) => ["---", ...lines, "---", "body"].join("\n");

const parseFailure = (content: string, parentDirName: string): SkillFormatError => {
  try {
    parseSkillFile(content, parentDirName);
  } catch (error) {
    expect(error).toBeInstanceOf(SkillFormatError);
    return error as SkillFormatError;
  }
  throw new Error("expected parseSkillFile to throw");
};

describe("skillFormat", () => {
  describe("parseSkillFile", () => {
    it("parses name, description, and body from a valid SKILL.md", () => {
      const parsed = parseSkillFile(minimalSkill(), "review-prose");
      expect(parsed.frontmatter.name).toBe("review-prose");
      expect(parsed.frontmatter.description).toBe(
        "Critique writing for clarity, voice, and rhythm."
      );
      expect(parsed.frontmatter.enabledAgents).toEqual([]);
      expect(parsed.body).toBe("body text");
    });

    it("validates the descriptor name itself when parsing a complete draft without a folder", () => {
      expect(parseSkillFile(minimalSkill()).frontmatter.name).toBe("review-prose");
      expect(() => parseSkillFile(minimalSkill({ name: "Invalid Name" }))).toThrow(
        SkillFormatError
      );
      expect(() => parseSkillFile(minimalSkill({ name: "a".repeat(65) }))).toThrow(
        SkillFormatError
      );
      expect(() => parseSkillFile(minimalSkill(), "different-folder")).toThrow(SkillFormatError);
    });

    it("reads Claude-only top-level flags", () => {
      const parsed = parseSkillFile(
        frontmatterOf(
          "name: foo",
          "description: A skill",
          "model: claude-opus-4-7",
          "disable-model-invocation: true",
          "user-invocable: false",
          "allowed-tools: Read Grep"
        ),
        "foo"
      );
      expect(parsed.frontmatter.model).toBe("claude-opus-4-7");
      expect(parsed.frontmatter.disableModelInvocation).toBe(true);
      expect(parsed.frontmatter.userInvocable).toBe(false);
      expect(parsed.frontmatter.allowedTools).toBe("Read Grep");
    });

    it("reads metadata.scribe-enabled-agents as a comma-separated list", () => {
      const parsed = parseSkillFile(
        frontmatterOf(
          "name: foo",
          "description: A skill",
          "metadata:",
          '  scribe-enabled-agents: "claude,opencode"'
        ),
        "foo"
      );
      expect(parsed.frontmatter.enabledAgents).toEqual(["claude", "opencode"]);
    });

    it("reads an empty scribe-enabled-agents value as no enabled agents", () => {
      const parsed = parseSkillFile(
        frontmatterOf(
          "name: foo",
          "description: A skill",
          "metadata:",
          '  scribe-enabled-agents: ""'
        ),
        "foo"
      );
      expect(parsed.frontmatter.enabledAgents).toEqual([]);
    });

    it("accepts a Chinese description that uses full-width punctuation", () => {
      const content = frontmatterOf(
        "name: review-prose",
        "description: 用于审阅笔记：检查清晰度和结构"
      );
      expect(parseSkillFile(content, "review-prose").frontmatter.description).toBe(
        "用于审阅笔记：检查清晰度和结构"
      );
    });

    it.each([
      ["an uppercase name", "ReviewProse", "ReviewProse"],
      ["a leading hyphen", "-foo", "-foo"],
      ["a trailing hyphen", "foo-", "foo-"],
      ["consecutive hyphens", "foo--bar", "foo--bar"],
      ["a name that differs from the parent directory", "foo", "bar"],
    ])("rejects %s with the lowercase-hyphenated-name repair message", (_label, name, dir) => {
      expect(() => parseSkillFile(minimalSkill({ name }), dir)).toThrow(
        /same lowercase, hyphenated name/
      );
    });

    it("rejects a name longer than 64 characters", () => {
      const longName = "a".repeat(65);
      expect(() => parseSkillFile(minimalSkill({ name: longName }), longName)).toThrow(/64/);
    });

    it("rejects a description longer than 1024 characters", () => {
      expect(() =>
        parseSkillFile(minimalSkill({ description: "x".repeat(1025) }), "review-prose")
      ).toThrow(/1024/);
    });

    it("rejects an empty description", () => {
      expect(() => parseSkillFile(frontmatterOf("name: foo", 'description: ""'), "foo")).toThrow(
        /non-empty/
      );
    });

    it("rejects content without a frontmatter block", () => {
      expect(() => parseSkillFile("no frontmatter here", "foo")).toThrow(/frontmatter/);
    });

    it("rejects frontmatter without a name", () => {
      expect(() => parseSkillFile(frontmatterOf("description: A skill"), "foo")).toThrow(
        /missing required field `name`/
      );
    });

    it(`explains how to quote a description containing colon-space for`, () => {
      const error = parseFailure(
        frontmatterOf("name: review-prose", "description: Use this skill for: reviewing notes"),
        "review-prose"
      );
      expect(error.message).toBe('The description contains ": " and must be quoted.');
      expect(error.offendingText).toBe("description: Use this skill for: reviewing notes");
    });

    it("reports a generic YAML error for unrelated parse failures", () => {
      expect(() =>
        parseSkillFile(
          frontmatterOf("name: review-prose", "description: [unfinished"),
          "review-prose"
        )
      ).toThrow(/frontmatter YAML is invalid/);
    });

    it(`reports a generic YAML error when the parser fails on a field other than description for`, () => {
      const error = parseFailure(
        frontmatterOf(
          "name: review-prose",
          "metadata: Use this for: reviews",
          "description: Use this skill for: reviewing notes"
        ),
        "review-prose"
      );
      expect(error.message).toMatch(/frontmatter YAML is invalid/);
      expect(error.offendingText).toBe("metadata: Use this for: reviews");
    });

    it(`reports the offending name line when the YAML key has extra spacing for`, () => {
      const error = parseFailure(
        frontmatterOf("name : Release Notes", "description: A skill"),
        "Release Notes"
      );
      expect(error.message).toBe("Use the same lowercase, hyphenated name in the file and folder.");
      expect(error.offendingText).toBe("name : Release Notes");
    });

    it(`reports the offending name line when the YAML key is quoted for`, () => {
      const error = parseFailure(
        frontmatterOf('"name": Release Notes', "description: A skill"),
        "Release Notes"
      );
      expect(error.message).toBe("Use the same lowercase, hyphenated name in the file and folder.");
      expect(error.offendingText).toBe('"name": Release Notes');
    });

    it(`distinguishes a non-string name from a missing name for`, () => {
      const error = parseFailure(frontmatterOf("name: 42", "description: A skill"), "42");
      expect(error.message).toBe("Skill `name` must be a string");
      expect(error.offendingText).toBe("name: 42");
    });

    it(`distinguishes a non-string description from a missing description for`, () => {
      const error = parseFailure(
        frontmatterOf("name: review-prose", "description: []"),
        "review-prose"
      );
      expect(error.message).toBe("Skill `description` must be a string");
      expect(error.offendingText).toBe("description: []");
    });
  });

  describe("serializeSkillFile", () => {
    it("reproduces name, description, and body when parsed content is serialized unchanged", () => {
      const out = serializeSkillFile(parseSkillFile(minimalSkill(), "review-prose"));
      const reparsed = parseSkillFile(out, "review-prose");
      expect(reparsed.frontmatter.name).toBe("review-prose");
      expect(reparsed.frontmatter.description).toBe(
        "Critique writing for clarity, voice, and rhythm."
      );
      expect(reparsed.body).toBe("body text");
    });

    it("writes the patched enabledAgents as a comma-separated metadata value", () => {
      const parsed = parseSkillFile(frontmatterOf("name: foo", "description: A skill"), "foo");
      const out = serializeSkillFile(parsed, { enabledAgents: ["claude", "opencode"] });
      expect(parseSkillFile(out, "foo").frontmatter.enabledAgents).toEqual(["claude", "opencode"]);
    });

    it("preserves unknown top-level keys", () => {
      const parsed = parseSkillFile(
        frontmatterOf(
          "name: foo",
          "description: A skill",
          "custom-top-level: keep me",
          "another-foreign: 42"
        ),
        "foo"
      );
      const out = serializeSkillFile(parsed);
      expect(out).toContain("custom-top-level: keep me");
      expect(out).toContain("another-foreign: 42");
    });

    it("edits optional metadata and flow mappings without changing unrelated number spelling", () => {
      const original =
        "---\nname: test\ndescription: Test\nmetadata: { author: Jane, revision: 900719925474099312345 }\n---\nBody";
      const parsed = parseSkillFile(original, "test");
      const result = serializeSkillFile(parsed, {
        author: "Jill",
        version: "1.2",
        tags: ["writing"],
        enabledAgents: ["native"],
      });
      expect(result).toContain("900719925474099312345");
      expect(parseSkillFile(result, "test").doc.getIn(["metadata", "author"])).toBe("Jill");
      expect(parseSkillFile(result, "test").frontmatter.enabledAgents).toEqual(["native"]);
    });
    it("removes an optional flow field and fills a null optional field without invalidating other properties", () => {
      const flow =
        "---\n{name: test, description: Test, model: old, custom: 12345678901234567890}\n---\nBody";
      const removed = serializeSkillFile(parseSkillFile(flow, "test"), { model: undefined });
      expect(parseSkillFile(removed, "test").frontmatter.model).toBeUndefined();
      expect(removed).toContain("12345678901234567890");
      const empty = "---\nname: test\ndescription: Test\nmodel:\n---\nBody";
      expect(
        parseSkillFile(
          serializeSkillFile(parseSkillFile(empty, "test"), { model: "chosen" }),
          "test"
        ).frontmatter.model
      ).toBe("chosen");
    });
    it("preserves high-precision unknown numbers when enablement changes", () => {
      const original =
        "---\nname: test\ndescription: Test\nmetadata:\n  revision: 900719925474099312345\n  fraction: 1.234567890123456789\n---\nBody";
      const parsed = parseSkillFile(original, "test");
      expect(serializeSkillFile(parsed, { enabledAgents: ["native"] })).toContain(
        "900719925474099312345"
      );
      expect(serializeSkillFile(parsed, { enabledAgents: ["native"] })).toContain(
        "1.234567890123456789"
      );
    });
    it("preserves unknown metadata keys", () => {
      const parsed = parseSkillFile(
        frontmatterOf(
          "name: foo",
          "description: A skill",
          "metadata:",
          "  author: alice",
          "  version: 2",
          '  scribe-enabled-agents: "claude"'
        ),
        "foo"
      );
      const out = serializeSkillFile(parsed);
      expect(out).toContain("author: alice");
      expect(out).toContain("version: 2");
      expect(out).toContain('scribe-enabled-agents: "claude"');
    });

    it("keeps foreign metadata keys when enabledAgents is patched", () => {
      const parsed = parseSkillFile(
        frontmatterOf(
          "name: foo",
          "description: A skill",
          "metadata:",
          "  author: alice",
          '  scribe-enabled-agents: "claude"'
        ),
        "foo"
      );
      const out = serializeSkillFile(parsed, { enabledAgents: ["claude", "opencode"] });
      expect(out).toContain("author: alice");
      expect(out).toContain("claude,opencode");
    });
  });

  describe("validateName", () => {
    it.each(["review-prose", "a", "a-b-c"])("accepts the spec-conformant name %s", (name) => {
      expect(() => validateName(name, name)).not.toThrow();
    });
  });

  describe("validateDescription", () => {
    it("accepts a normal description", () => {
      expect(() => validateDescription("A short description.")).not.toThrow();
    });

    it("rejects an empty description with a SkillFormatError", () => {
      expect(() => validateDescription("")).toThrow(SkillFormatError);
    });
  });
});
