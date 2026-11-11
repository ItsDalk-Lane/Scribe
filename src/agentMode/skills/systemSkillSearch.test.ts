import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Skill } from "@/agentMode/skills/types";
import {
  parseLoginSkillEnvironment,
  resolveSystemSkillRoots,
  searchSystemSkills,
} from "@/agentMode/skills/systemSkillSearch";

const os = jest.requireActual<typeof import("node:os")>("node:os");
const childProcess = jest.requireActual<typeof import("node:child_process")>("node:child_process");
const fs = jest.requireActual<typeof import("node:fs")>("node:fs");

describe("systemSkillSearch", () => {
  describe("resolveSystemSkillRoots()", () => {
    it("lists all fifteen sources and resolves environment overrides relative to home", () => {
      const roots = resolveSystemSkillRoots("/users/alice", {
        CODEX_HOME: "custom-codex",
        CLAUDE_CONFIG_DIR: "/other/claude",
        XDG_CONFIG_HOME: "config",
      });
      expect(roots).toHaveLength(15);
      expect(roots.find((root) => root.name === "Codex")?.path).toBe(
        "/users/alice/custom-codex/skills"
      );
      expect(roots.find((root) => root.name === "Claude Code")?.path).toBe("/other/claude/skills");
      expect(roots.find((root) => root.name === "OpenCode")?.path).toBe(
        "/users/alice/config/opencode/skills"
      );
      expect(
        resolveSystemSkillRoots("/users/alice", {}).find((root) => root.name === "OpenCode")?.path
      ).toBe("/users/alice/.config/opencode/skills");
      expect(
        resolveSystemSkillRoots("C:\\Users\\Alice", { CODEX_HOME: "custom" }).find(
          (item) => item.name === "Codex"
        )?.path
      ).toBe("C:\\Users\\Alice\\custom\\skills");
    });
  });

  describe("parseLoginSkillEnvironment()", () => {
    it("extracts only skill directory overrides despite login shell output", () => {
      expect(
        parseLoginSkillEnvironment(
          "welcome\nSECRET=not retained\0CODEX_HOME=/custom=dir\0XDG_CONFIG_HOME=relative\0"
        )
      ).toEqual({ CODEX_HOME: "/custom=dir", XDG_CONFIG_HOME: "relative" });
    });
  });

  describe("searchSystemSkills()", () => {
    let root: string;
    let homeSpy: jest.SpyInstance;
    let shellSpy: jest.SpyInstance;
    beforeEach(async () => {
      root = await realpath(await mkdtemp(join(tmpdir(), "scribe-search-")));
      homeSpy = jest.spyOn(os, "homedir").mockReturnValue(root);
      shellSpy = jest.spyOn(childProcess, "execFile").mockImplementation((...args: unknown[]) => {
        const callback = args[args.length - 1] as (
          error: Error | null,
          stdout: string,
          stderr: string
        ) => void;
        callback(
          null,
          "CLAUDE_CONFIG_DIR=.claude\0CODEX_HOME=.codex\0XDG_CONFIG_HOME=.config\0",
          ""
        );
        return {} as import("node:child_process").ChildProcess;
      });
    });
    afterEach(async () => {
      homeSpy.mockRestore();
      shellSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    });

    async function skill(
      relative: string,
      name = relative.split("/").pop()!,
      valid = true
    ): Promise<string> {
      const directory = join(root, relative);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "SKILL.md"),
        valid
          ? `---\nname: ${name}\ndescription: ${name} workflow\n---\nFull body`
          : "broken metadata"
      );
      return directory;
    }

    // 可修复候选带差异进入确认流程，不可修复候选维持错误。https://github.com/ItsDalk-Lane/Scribe/issues/44
    it("carries staged repairs on repairable candidates and errors on unrepairable ones", async () => {
      const repairable = join(root, ".agents/skills/repairable");
      await mkdir(repairable, { recursive: true });
      await writeFile(
        join(repairable, "SKILL.md"),
        "---\nname: repairable\ndescription: Use ffmpeg: converts media\n---\nFull body"
      );
      const unrepairable = join(root, ".agents/skills/unrepairable");
      await mkdir(unrepairable, { recursive: true });
      await writeFile(
        join(unrepairable, "SKILL.md"),
        "---\nname: Broken Name\ndescription: Works\n---\nFull body"
      );
      const result = await searchSystemSkills({
        skillsDirectory: join(root, ".scribe/skills"),
        installed: [],
      });
      const repaired = result.candidates.find((candidate) => candidate.name === "repairable");
      expect(repaired).toMatchObject({
        status: "available",
        repair: [
          {
            before: "description: Use ffmpeg: converts media",
            after: 'description: "Use ffmpeg: converts media"',
          },
        ],
      });
      expect(repaired?.error).toBeUndefined();
      const broken = result.candidates.find((candidate) => candidate.name === "unrepairable");
      expect(broken?.error).toBeTruthy();
      expect(broken?.repair).toBeUndefined();
    });

    it("finds skills through login environment overrides and merges physical duplicates", async () => {
      const directory = await skill(".agents/skills/review-prose");
      await mkdir(join(root, ".claude"));
      await symlink(join(root, ".agents", "skills"), join(root, ".claude", "skills"), "dir");
      const result = await searchSystemSkills({
        skillsDirectory: join(root, ".scribe/skills"),
        installed: [],
      });
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        name: "review-prose",
        path: directory,
        sources: ["Agent Skills", "Claude Code"],
        status: "available",
      });
    });

    it("distinguishes installed copies, occupied names and invalid candidates", async () => {
      const installedPath = await skill(".agents/skills/installed");
      await skill(".agents/skills/conflict");
      await skill(".agents/skills/broken", "broken", false);
      await mkdir(join(root, ".scribe/skills/CONFLICT"), { recursive: true });
      const installed = [
        { name: "installed", source: { kind: "system", origin: installedPath } },
      ] as Skill[];
      const result = await searchSystemSkills({
        skillsDirectory: join(root, ".scribe/skills"),
        installed,
      });
      expect(result.candidates.find((candidate) => candidate.name === "installed")?.status).toBe(
        "installed"
      );
      expect(result.candidates.find((candidate) => candidate.name === "conflict")?.status).toBe(
        "conflict"
      );
      expect(
        result.candidates.find((candidate) => candidate.name === "broken")?.error
      ).toBeTruthy();
    });

    it("updates the installed name after a local rename even when another source occupies the original name", async () => {
      const source = await skill(".agents/skills/original-name");
      const installed = [
        { name: "renamed-skill", source: { kind: "system", origin: source } },
        { name: "original-name", source: { kind: "local" } },
      ] as Skill[];
      const result = await searchSystemSkills({
        skillsDirectory: join(root, ".scribe/skills"),
        installed,
      });
      expect(result.candidates[0]).toMatchObject({
        name: "renamed-skill",
        status: "installed",
        renamedFrom: "original-name",
      });
    });

    it("skips hidden descendants and node_modules but permits the root hidden whitelist", async () => {
      await skill(".agents/skills/.agents/allowed");
      await skill(".agents/skills/.hidden/skipped");
      await skill(".agents/skills/node_modules/skipped");
      await skill(".agents/skills/visible/.claude/skipped");
      const result = await searchSystemSkills({
        skillsDirectory: join(root, ".scribe/skills"),
        installed: [],
      });
      expect(result.candidates.map((candidate) => candidate.name)).toEqual(["allowed"]);
    });

    it("excludes the managed library, stops at a skill and avoids link cycles", async () => {
      const directory = await skill(".agents/skills/outer");
      await skill(".agents/skills/outer/nested");
      await skill(".scribe/skills/managed");
      await symlink(join(root, ".scribe/skills"), join(root, ".agents/skills/library"), "dir");
      await mkdir(join(root, ".agents/skills/cycle"));
      await symlink(join(root, ".agents/skills"), join(root, ".agents/skills/cycle/back"), "dir");
      const result = await searchSystemSkills({
        skillsDirectory: join(root, ".scribe/skills"),
        installed: [],
      });
      expect(result.candidates.map((candidate) => candidate.path)).toEqual([directory]);
    });

    it("keeps the tenth level and skips the eleventh", async () => {
      await skill(
        `.agents/skills/${Array.from({ length: 9 }, (_, i) => `level-${i}`).join("/")}/allowed`
      );
      await skill(
        `.agents/skills/${Array.from({ length: 10 }, (_, i) => `other-${i}`).join("/")}/skipped`
      );
      const result = await searchSystemSkills({
        skillsDirectory: join(root, ".scribe/skills"),
        installed: [],
      });
      expect(result.candidates.map((candidate) => candidate.name)).toEqual(["allowed"]);
    });

    it("revisits a directory reached by a shallower link so valid skills are not lost to the depth limit", async () => {
      await skill("shared/one/two/three/four/five/six/review");
      const source = join(root, ".agents/skills");
      await mkdir(join(source, "a-deep/one/two/three"), { recursive: true });
      await symlink(join(root, "shared"), join(source, "a-deep/one/two/three/link"), "dir");
      await symlink(join(root, "shared"), join(source, "z-shallow"), "dir");
      const result = await searchSystemSkills({
        skillsDirectory: join(root, ".scribe/skills"),
        installed: [],
      });
      expect(result.candidates.map((candidate) => candidate.name)).toEqual(["review"]);
    });

    it("falls back to inherited environment when login shell lookup fails", async () => {
      shellSpy.mockImplementation((...args: unknown[]) => {
        const callback = args[args.length - 1] as (error: Error) => void;
        callback(new Error("shell unavailable"));
        return {} as import("node:child_process").ChildProcess;
      });
      await skill(".agents/skills/fallback");
      expect(
        (
          await searchSystemSkills({ skillsDirectory: join(root, ".scribe/skills"), installed: [] })
        ).candidates.map((candidate) => candidate.name)
      ).toContain("fallback");
    });

    it("rejects a missing home and aborts cancelled searches", async () => {
      homeSpy.mockReturnValue("");
      await expect(searchSystemSkills({ skillsDirectory: root, installed: [] })).rejects.toThrow();
      const controller = new AbortController();
      controller.abort();
      await expect(
        searchSystemSkills({ skillsDirectory: root, installed: [], signal: controller.signal })
      ).rejects.toThrow();
    });

    it("reports an unreadable subtree while keeping readable skills", async () => {
      await skill(".agents/skills/readable");
      const denied = join(root, ".agents/skills/denied");
      await mkdir(denied);
      const originalReaddir = fs.promises.readdir.bind(fs.promises);
      const spy = jest.spyOn(fs.promises, "readdir").mockImplementation((async (path, options) => {
        if (path === denied) throw Object.assign(new Error("denied"), { code: "EACCES" });
        return originalReaddir(path, options);
      }) as typeof fs.promises.readdir);
      try {
        const result = await searchSystemSkills({
          skillsDirectory: join(root, ".scribe/skills"),
          installed: [],
        });
        expect(result.candidates.map((candidate) => candidate.name)).toEqual(["readable"]);
        expect(result.warnings).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    });

    // 完整性契约：部分失败显式标记并给出原因摘要，ENOENT 仍静默。
    // https://github.com/ItsDalk-Lane/Scribe/issues/49
    it("marks the scan incomplete with per-source failure summaries", async () => {
      await skill(".agents/skills/readable");
      const denied = join(root, ".cursor/skills/denied");
      await mkdir(denied, { recursive: true });
      const originalReaddir = fs.promises.readdir.bind(fs.promises);
      const spy = jest.spyOn(fs.promises, "readdir").mockImplementation((async (path, options) => {
        if (path === denied)
          throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        return originalReaddir(path, options);
      }) as typeof fs.promises.readdir);
      try {
        const result = await searchSystemSkills({
          skillsDirectory: join(root, ".scribe/skills"),
          installed: [],
        });
        expect(result.incomplete).toBe(true);
        expect(result.failures).toEqual([
          expect.objectContaining({ root: "Cursor", reason: expect.stringContaining("EACCES") }),
        ]);
      } finally {
        spy.mockRestore();
      }
    });

    it("marks a complete scan with no failures as not incomplete", async () => {
      await skill(".agents/skills/readable");
      const result = await searchSystemSkills({
        skillsDirectory: join(root, ".scribe/skills"),
        installed: [],
      });
      expect(result.incomplete).toBe(false);
      expect(result.failures).toEqual([]);
    });

    it("stops at the global directory budget and explains that results are partial", async () => {
      const source = join(root, ".agents/skills");
      const virtualPrefix = join(source, "virtual-");
      await mkdir(source, { recursive: true });
      const originalReaddir = fs.promises.readdir.bind(fs.promises);
      const originalRealpath = fs.promises.realpath.bind(fs.promises);
      const realpathSpy = jest.spyOn(fs.promises, "realpath").mockImplementation(async (path) => {
        if (String(path).startsWith(virtualPrefix)) return String(path);
        return originalRealpath(path);
      });
      const readdirSpy = jest.spyOn(fs.promises, "readdir").mockImplementation((async (
        path,
        options
      ) => {
        if (path === source)
          return Array.from({ length: 10001 }, (_, index) => ({
            name: `virtual-${index}`,
            isDirectory: () => true,
            isSymbolicLink: () => false,
          }));
        if (String(path).startsWith(virtualPrefix)) return [];
        return originalReaddir(path, options);
      }) as typeof fs.promises.readdir);
      try {
        const result = await searchSystemSkills({
          skillsDirectory: join(root, ".scribe/skills"),
          installed: [],
        });
        expect(result.candidates).toEqual([]);
        expect(result.warnings.some((warning) => warning.includes("10000"))).toBe(true);
      } finally {
        realpathSpy.mockRestore();
        readdirSpy.mockRestore();
      }
    });
  });
});
