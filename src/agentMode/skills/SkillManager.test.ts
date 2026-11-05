import { createNodeMigrateSkillFs } from "./nodeFsAdapters";
import { parseSkillFile } from "./skillFormat";
import { act, renderHook } from "@testing-library/react";
import { FileSystemAdapter, type App, type EventRef } from "obsidian";
import { useSkillLoadErrorCount } from "@/settings/skillLoadErrorState";
import { discoverManagedSkills } from "./discoverManagedSkills";
import { reconcile } from "./reconcile";
import {
  computeSkillSetSignature,
  getManagedSkills,
  SkillManager,
  type RefreshResult,
  useRejectedSkills,
} from "./SkillManager";
import { runDeleteSkill, runToggleAgent } from "./toggleAgent";
import { runRenameSkill, runUpdateProperties } from "./updateProperties";
import type { RejectedSkill, Skill, SkillDiscoveryResult } from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

let skillsFolder = "scribe/skills";

jest.mock("@/settings/model", () => ({
  getSettings: () => ({
    agentMode: {
      skills: {
        folder: skillsFolder,
      },
    },
  }),
  updateSetting: jest.fn(),
}));

jest.mock("@/settings/scribeFolder", () => ({
  getEffectiveSkillsFolder: () => skillsFolder,
}));

jest.mock("./discoverManagedSkills", () => ({
  discoverManagedSkills: jest.fn(),
}));

jest.mock("./reconcile", () => ({
  reconcile: jest.fn(async () => ({ created: [], removedOrphans: [], errors: [] })),
}));

jest.mock("./nodeFsAdapters", () => ({
  createNodeMigrateSkillFs: jest.fn(() => ({})),
  createNodeProjectDiscoveryFs: jest.fn(() => ({})),
  createNodeReconcileFs: jest.fn(() => ({})),
}));

jest.mock("./discoverProjectSkills", () => ({
  discoverProjectSkills: jest.fn(async () => ({ accepted: [], rejected: [] })),
}));

jest.mock("./toggleAgent", () => ({
  runDeleteSkill: jest.fn(),
  runToggleAgent: jest.fn(),
}));

jest.mock("./updateProperties", () => ({
  runRenameSkill: jest.fn(),
  runUpdateProperties: jest.fn(),
}));

const mockedDiscoverManagedSkills = discoverManagedSkills as jest.MockedFunction<
  typeof discoverManagedSkills
>;
const mockedRunRenameSkill = runRenameSkill as jest.MockedFunction<typeof runRenameSkill>;
const mockedRunUpdateProperties = runUpdateProperties as jest.MockedFunction<
  typeof runUpdateProperties
>;
const mockedRunToggleAgent = runToggleAgent as jest.MockedFunction<typeof runToggleAgent>;
const mockedRunDeleteSkill = runDeleteSkill as jest.MockedFunction<typeof runDeleteSkill>;
const mockedReconcile = reconcile as jest.MockedFunction<typeof reconcile>;

describe("SkillManager", () => {
  beforeEach(() => {
    skillsFolder = "scribe/skills";
    mockedDiscoverManagedSkills.mockReset();
    mockedReconcile.mockClear();
    mockedRunRenameSkill.mockReset();
    mockedRunUpdateProperties.mockReset();
    mockedRunToggleAgent.mockReset();
    mockedRunDeleteSkill.mockReset();
    SkillManager.resetForTesting();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  afterEach(() => {
    SkillManager.resetForTesting();
    jest.useRealTimers();
  });

  describe("SkillManager", () => {
    describe("refresh", () => {
      it("queues one follow-up refresh when the configured folder changes during an in-flight pass", async () => {
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        let releaseFirst = (): void => {};

        mockedDiscoverManagedSkills.mockImplementationOnce(async () => {
          skillsFolder = "team/skills";
          void manager.refresh();
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          return discoveryResult();
        });
        mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult());

        const resultPromise = manager.refresh();
        await Promise.resolve();
        releaseFirst();
        const result = await resultPromise;

        expect(mockedDiscoverManagedSkills).toHaveBeenCalledTimes(2);
        expect(mockedDiscoverManagedSkills.mock.calls[0][0].skillsFolderRelPath).toBe(
          "scribe/skills"
        );
        expect(mockedDiscoverManagedSkills.mock.calls[1][0].skillsFolderRelPath).toBe(
          "team/skills"
        );
        expect(result.folder).toBe("team/skills");
      });

      it("publishes and clears rejected discovery state", async () => {
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        const { result: loadErrorCount } = renderHook(() => useSkillLoadErrorCount());
        const rejected: RejectedSkill = {
          name: "broken-skill",
          filePath: "/vault/scribe/skills/broken-skill/SKILL.md",
          dirPath: "/vault/scribe/skills/broken-skill",
          reason: "The description must be quoted.",
        };
        mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult([], [rejected]));
        mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult());
        mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult());
        const { result } = renderHook(() => useRejectedSkills());
        const initialRejectedSkills = result.current;

        await act(async () => {
          await manager.refresh();
        });
        expect(result.current).toEqual([rejected]);
        expect(loadErrorCount.current).toBe(1);

        await act(async () => {
          await manager.refresh();
        });
        expect(result.current).toBe(initialRejectedSkills);
        expect(loadErrorCount.current).toBe(0);

        await act(async () => {
          await manager.refresh();
        });
        expect(result.current).toBe(initialRejectedSkills);
      });

      it("notifies when a backend-visible skill signature changes", async () => {
        const app = makeApp();
        const manager = SkillManager.initialize(app, { opencode: ".opencode/skills" });
        const listener = jest.fn();
        manager.subscribeToSkillSetChange(listener);
        mockedDiscoverManagedSkills.mockResolvedValueOnce(
          discoveryResult([makeSkill({ enabledAgents: ["opencode"] })])
        );
        mockedDiscoverManagedSkills.mockResolvedValueOnce(
          discoveryResult([makeSkill({ body: "updated", enabledAgents: ["opencode"] })])
        );

        await manager.refresh();
        await manager.refresh();

        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener.mock.calls.map((call) => call[0])).toEqual(["opencode", "opencode"]);
      });
    });
    describe("initialize", () => {
      it("schedules reconciliation when a rename moves a watched old path elsewhere", () => {
        jest.useFakeTimers();
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        const refreshResult: RefreshResult = {
          ok: true,
          folder: "scribe/skills",
          skillCount: 0,
          reconcileErrorCount: 0,
        };
        const refreshSpy = jest.spyOn(manager, "refresh").mockResolvedValue(refreshResult);
        const renameHandler = app.vault.on.mock.calls.find(([event]) => event === "rename")?.[1];

        expect(renameHandler).toBeDefined();
        renameHandler?.({ path: "elsewhere/foo/SKILL.md" }, "scribe/skills/foo/SKILL.md");
        jest.advanceTimersByTime(250);

        expect(refreshSpy).toHaveBeenCalledTimes(1);
      });

      it("suppresses a vault event that matches a pending expectation", async () => {
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        const skill = makeSkill({ enabledAgents: [] });
        await seedSkills(manager, [skill]);
        mockedRunToggleAgent.mockResolvedValueOnce({ ok: true });
        const refreshResult: RefreshResult = {
          ok: true,
          folder: "scribe/skills",
          skillCount: 0,
          reconcileErrorCount: 0,
        };
        const refreshSpy = jest.spyOn(manager, "refresh").mockResolvedValue(refreshResult);

        await manager.toggleAgent(skill, "claude", true);
        refreshSpy.mockClear();

        fireVaultEvent(app, "create", { path: ".claude/skills/foo" });
        await flushMicrotasks();
        jest.useFakeTimers();
        jest.advanceTimersByTime(250);
        expect(refreshSpy).not.toHaveBeenCalled();
        jest.useRealTimers();
      });

      it("passes through a vault event that does not match any expectation", async () => {
        jest.useFakeTimers();
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        const skill = makeSkill({ enabledAgents: [] });
        mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult([skill]));
        await manager.refresh();
        mockedRunToggleAgent.mockResolvedValueOnce({ ok: true });
        await manager.toggleAgent(skill, "claude", true);

        const refreshResult: RefreshResult = {
          ok: true,
          folder: "scribe/skills",
          skillCount: 1,
          reconcileErrorCount: 0,
        };
        const refreshSpy = jest.spyOn(manager, "refresh").mockResolvedValue(refreshResult);

        fireVaultEvent(app, "create", { path: "scribe/skills/unrelated/SKILL.md" });
        jest.advanceTimersByTime(250);
        expect(refreshSpy).toHaveBeenCalledTimes(1);
      });

      it("schedules a reconcile after the safety timeout when expected vault events never arrive", async () => {
        jest.useFakeTimers();
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        const skill = makeSkill({ enabledAgents: [] });
        mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult([skill]));
        await manager.refresh();
        mockedRunToggleAgent.mockResolvedValueOnce({ ok: true });
        await manager.toggleAgent(skill, "claude", true);

        const refreshResult: RefreshResult = {
          ok: true,
          folder: "scribe/skills",
          skillCount: 1,
          reconcileErrorCount: 0,
        };
        const refreshSpy = jest.spyOn(manager, "refresh").mockResolvedValue(refreshResult);

        jest.advanceTimersByTime(10_000);
        jest.advanceTimersByTime(250);
        expect(refreshSpy).toHaveBeenCalledTimes(1);
      });

      it("preserves a pre-existing scheduled reconcile across an internal mutation", async () => {
        jest.useFakeTimers();
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        const skill = makeSkill({ enabledAgents: [] });
        mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult([skill]));
        await manager.refresh();

        const refreshResult: RefreshResult = {
          ok: true,
          folder: "scribe/skills",
          skillCount: 1,
          reconcileErrorCount: 0,
        };
        const refreshSpy = jest.spyOn(manager, "refresh").mockResolvedValue(refreshResult);

        fireVaultEvent(
          app,
          "rename",
          { path: "elsewhere/foo/SKILL.md" },
          "scribe/skills/foo/SKILL.md"
        );

        mockedRunToggleAgent.mockResolvedValueOnce({ ok: true });
        await manager.toggleAgent(skill, "claude", true);

        jest.advanceTimersByTime(250);
        expect(refreshSpy).toHaveBeenCalledTimes(1);
      });
    });
    describe("toggleAgent", () => {
      it("uses ordinary per-file enablement for a legacy-marked skill https://github.com/ItsDalk-Lane/Scribe/issues/32", async () => {
        const manager = SkillManager.initialize(makeApp(), { native: ".scribe/skills" });
        const skill = { ...makeSkill({ enabledAgents: ["native"] }), builtin: true };
        await seedSkills(manager, [skill]);
        mockedRunToggleAgent.mockResolvedValueOnce({ ok: true });
        expect(await manager.toggleAgent(skill, "native", false)).toEqual({ ok: true });
        expect(mockedRunToggleAgent).toHaveBeenCalledWith(
          expect.objectContaining({ skill, agent: "native", enabled: false })
        );
        expect(getManagedSkills()[0].enabledAgents).toEqual([]);
      });

      it("adds the agent to one row without rerunning discovery or reconcile", async () => {
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        const skill = makeSkill({ enabledAgents: [] });
        await seedSkills(manager, [skill]);
        mockedRunToggleAgent.mockResolvedValueOnce({ ok: true });
        mockedDiscoverManagedSkills.mockClear();
        mockedReconcile.mockClear();

        const result = await manager.toggleAgent(skill, "claude", true);

        expect(result).toEqual({ ok: true });
        expect(mockedDiscoverManagedSkills).not.toHaveBeenCalled();
        expect(mockedReconcile).not.toHaveBeenCalled();
        expect(getManagedSkills()[0].enabledAgents).toEqual(["claude"]);
      });
    });
    describe("deleteSkill", () => {
      it("deletes a legacy-marked skill only when the user explicitly requests deletion https://github.com/ItsDalk-Lane/Scribe/issues/32", async () => {
        const manager = SkillManager.initialize(makeApp(), { native: ".scribe/skills" });
        const skill = { ...makeSkill({ enabledAgents: ["native"] }), builtin: true };
        await seedSkills(manager, [skill]);
        expect(mockedRunDeleteSkill).not.toHaveBeenCalled();
        mockedRunDeleteSkill.mockResolvedValueOnce({ ok: true });
        expect(await manager.deleteSkill(skill)).toEqual({ ok: true });
        expect(mockedRunDeleteSkill).toHaveBeenCalledWith(expect.objectContaining({ skill }));
        expect(getManagedSkills()).toEqual([]);
      });

      it("removes one row without rerunning discovery or reconcile", async () => {
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        const skill = makeSkill();
        const other = makeSkill({ name: "bar", dirPath: "/vault/scribe/skills/bar" });
        await seedSkills(manager, [skill, other]);
        mockedRunDeleteSkill.mockResolvedValueOnce({ ok: true });
        mockedDiscoverManagedSkills.mockClear();
        mockedReconcile.mockClear();

        const result = await manager.deleteSkill(skill);

        expect(result).toEqual({ ok: true });
        expect(mockedDiscoverManagedSkills).not.toHaveBeenCalled();
        expect(mockedReconcile).not.toHaveBeenCalled();
        expect(getManagedSkills().map((s) => s.name)).toEqual(["bar"]);
      });
    });
    describe("saveProperties", () => {
      it("applies a rename plus patch with a single skill-set notification", async () => {
        const app = makeApp();
        const manager = SkillManager.initialize(app, { opencode: ".opencode/skills" });
        const listener = jest.fn();
        const skill = makeSkill({ enabledAgents: ["opencode"] });
        manager.subscribeToSkillSetChange(listener);
        await seedSkills(manager, [skill]);
        listener.mockClear();
        mockedRunRenameSkill.mockResolvedValueOnce({
          ok: true,
          newDirPath: "/vault/scribe/skills/bar",
          newFilePath: "/vault/scribe/skills/bar/SKILL.md",
        });
        mockedRunUpdateProperties.mockResolvedValueOnce({ ok: true });

        const result = await manager.saveProperties(skill, {
          newName: "bar",
          patch: { description: "Updated description." },
        });

        expect(result).toEqual({ ok: true });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(getManagedSkills()[0]).toMatchObject({
          name: "bar",
          description: "Updated description.",
        });
      });

      it("applies a description-only patch without renaming", async () => {
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        const skill = makeSkill();
        await seedSkills(manager, [skill]);
        mockedRunUpdateProperties.mockResolvedValueOnce({ ok: true });

        const result = await manager.saveProperties(skill, {
          patch: { description: "Updated description." },
        });

        expect(result).toEqual({ ok: true });
        expect(mockedRunRenameSkill).not.toHaveBeenCalled();
        expect(getManagedSkills()[0]).toMatchObject({
          name: "foo",
          description: "Updated description.",
        });
      });

      it("applies a rename with an empty patch", async () => {
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        const skill = makeSkill();
        await seedSkills(manager, [skill]);
        mockedRunRenameSkill.mockResolvedValueOnce({
          ok: true,
          newDirPath: "/vault/scribe/skills/bar",
          newFilePath: "/vault/scribe/skills/bar/SKILL.md",
        });
        mockedRunUpdateProperties.mockResolvedValueOnce({ ok: true });

        const result = await manager.saveProperties(skill, {
          newName: "bar",
          patch: {},
        });

        expect(result).toEqual({ ok: true });
        expect(getManagedSkills()[0]).toMatchObject({
          name: "bar",
          description: "A skill.",
        });
      });

      it("returns a collision error without patching when the new name is taken", async () => {
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        const skill = makeSkill();
        await seedSkills(manager, [skill]);
        mockedRunRenameSkill.mockResolvedValueOnce({ ok: false, reason: "collision" });

        const result = await manager.saveProperties(skill, {
          newName: "bar",
          patch: { description: "Updated description." },
        });

        expect(result).toEqual({
          ok: false,
          code: "collision",
          message: "A skill with that name already exists.",
        });
        expect(mockedRunUpdateProperties).not.toHaveBeenCalled();
      });

      it("refreshes from disk and returns the failure when the rename fails after mutating the canonical directory", async () => {
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        const skill = makeSkill();
        await seedSkills(manager, [skill]);
        mockedRunRenameSkill.mockResolvedValueOnce({
          ok: false,
          reason: "Could not rewrite SKILL.md",
          mutated: true,
        });
        const refreshResult: RefreshResult = {
          ok: true,
          folder: "scribe/skills",
          skillCount: 0,
          reconcileErrorCount: 0,
        };
        const refreshSpy = jest.spyOn(manager, "refresh").mockResolvedValue(refreshResult);

        const result = await manager.saveProperties(skill, {
          newName: "bar",
          patch: { description: "Updated description." },
        });

        expect(result).toEqual({
          ok: false,
          code: "fs-error",
          message: "Could not rewrite SKILL.md",
        });
        expect(refreshSpy).toHaveBeenCalledTimes(1);
        expect(mockedRunUpdateProperties).not.toHaveBeenCalled();
      });

      it("succeeds when the rename reports EPERM after mutating but the patch succeeds", async () => {
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        const skill = makeSkill();
        await seedSkills(manager, [skill]);
        mockedRunRenameSkill.mockResolvedValueOnce({ ok: false, reason: "eperm", mutated: true });
        mockedRunUpdateProperties.mockResolvedValueOnce({ ok: true });

        const result = await manager.saveProperties(skill, {
          newName: "bar",
          patch: { description: "Updated description." },
        });

        expect(result).toEqual({ ok: true });
        expect(getManagedSkills()[0]).toMatchObject({
          name: "bar",
          description: "Updated description.",
        });
      });

      it("keeps the rename in the published row when the follow-up patch fails", async () => {
        const app = makeApp();
        const manager = SkillManager.initialize(app, { claude: ".claude/skills" });
        const skill = makeSkill();
        await seedSkills(manager, [skill]);
        mockedRunRenameSkill.mockResolvedValueOnce({
          ok: true,
          newDirPath: "/vault/scribe/skills/bar",
          newFilePath: "/vault/scribe/skills/bar/SKILL.md",
        });
        mockedRunUpdateProperties.mockResolvedValueOnce({ ok: false, reason: "write failed" });

        const result = await manager.saveProperties(skill, {
          newName: "bar",
          patch: { description: "Updated description." },
        });

        expect(result).toEqual({ ok: false, code: "fs-error", message: "write failed" });
        expect(getManagedSkills()[0]).toMatchObject({
          name: "bar",
          description: "A skill.",
        });
      });
    });
    describe("readContent", () => {
      it("reads the complete original skill file without dropping unknown frontmatter", async () => {
        const raw = "---\nname: foo\ndescription: A skill\ncustom-field: keep\n---\nInstructions";
        const readFile = jest.fn().mockResolvedValue(raw);
        jest.mocked(createNodeMigrateSkillFs).mockReturnValue({ readFile } as never);
        const manager = SkillManager.initialize(makeApp(), { claude: ".claude/skills" });
        expect(await manager.readContent(makeSkill())).toBe(raw);
        expect(readFile).toHaveBeenCalledWith(makeSkill().filePath);
      });
    });
    describe("createSkill", () => {
      it("creates and enables a valid skill without overwriting an existing file", async () => {
        const fs = {
          exists: jest.fn().mockResolvedValue(false),
          mkdirRecursive: jest.fn(),
          writeFile: jest.fn(),
        };
        jest.mocked(createNodeMigrateSkillFs).mockReturnValue(fs as never);
        const manager = SkillManager.initialize(makeApp(), { claude: ".claude/skills" });
        jest.spyOn(manager, "refresh").mockResolvedValue({
          ok: true,
          folder: skillsFolder,
          skillCount: 1,
          reconcileErrorCount: 0,
        });
        expect(
          await manager.createSkill(
            "new-skill",
            "---\nname: new-skill\ndescription: A new skill\n---\nInstructions"
          )
        ).toEqual({ ok: true });
        expect(fs.writeFile.mock.calls[0][0]).toBe("/vault/scribe/skills/new-skill/SKILL.md");
        expect(fs.writeFile.mock.calls[0][2]).toBe("wx");
        expect(
          parseSkillFile(fs.writeFile.mock.calls[0][1], "new-skill").frontmatter.enabledAgents
        ).toEqual(["claude"]);
      });
      it.each([
        { ok: true, reconcileErrorCount: 1, reconcileError: "Cannot create the agent link" },
        { ok: false, reconcileErrorCount: 0, discoveryError: "Cannot read the skills folder" },
      ])(
        "keeps a new skill saved and reports incomplete syncing when refresh returns %j",
        async (failure) => {
          const writeFile = jest.fn();
          jest.mocked(createNodeMigrateSkillFs).mockReturnValue({
            exists: jest.fn().mockResolvedValue(false),
            mkdirRecursive: jest.fn(),
            writeFile,
          } as never);
          const manager = SkillManager.initialize(makeApp(), { claude: ".claude/skills" });
          jest.spyOn(manager, "refresh").mockResolvedValue({
            folder: skillsFolder,
            skillCount: 1,
            ...failure,
          });
          expect(
            await manager.createSkill(
              "new-skill",
              "---\nname: new-skill\ndescription: A new skill\n---\nInstructions"
            )
          ).toEqual({ ok: true, warning: failure.reconcileError ?? failure.discoveryError });
          expect(writeFile).toHaveBeenCalledTimes(1);
        }
      );
      it("rejects a name collision before writing to a user's folder", async () => {
        const fs = { exists: jest.fn().mockResolvedValue(true), writeFile: jest.fn() };
        jest.mocked(createNodeMigrateSkillFs).mockReturnValue(fs as never);
        const manager = SkillManager.initialize(makeApp(), { claude: ".claude/skills" });
        expect(
          await manager.createSkill(
            "foo",
            "---\nname: foo\ndescription: A skill\n---\nInstructions"
          )
        ).toMatchObject({ ok: false, code: "collision" });
        expect(fs.writeFile).not.toHaveBeenCalled();
      });
      it("rejects an invalid skill before creating any files", async () => {
        const manager = SkillManager.initialize(makeApp(), { claude: ".claude/skills" });
        expect(await manager.createSkill("../escape", "not a skill")).toMatchObject({
          ok: false,
          code: "invalid",
        });
      });
    });
    describe("saveContent", () => {
      it("allows an explicit legacy-marked skill edit while retaining its disabled agents and metadata https://github.com/ItsDalk-Lane/Scribe/issues/32", async () => {
        const writeFile = jest.fn();
        jest.mocked(createNodeMigrateSkillFs).mockReturnValue({ writeFile } as never);
        const manager = SkillManager.initialize(makeApp(), { native: ".scribe/skills" });
        jest.spyOn(manager, "refresh").mockResolvedValue({
          ok: true,
          folder: skillsFolder,
          skillCount: 1,
          reconcileErrorCount: 0,
        });
        const skill = { ...makeSkill({ enabledAgents: [] }), builtin: true };
        const content =
          '---\nname: foo\ndescription: A skill\nmetadata:\n  scribe-builtin-version: "1"\n  user-value: keep\n---\nChanged by user';
        expect(await manager.saveContent(skill, content)).toEqual({ ok: true });
        const saved = writeFile.mock.calls[0][1];
        expect(saved).toContain('scribe-builtin-version: "1"');
        expect(saved).toContain("user-value: keep");
        expect(parseSkillFile(saved, "foo").frontmatter.enabledAgents).toEqual([]);
        expect(parseSkillFile(saved, "foo").body).toBe("Changed by user");
      });

      it("updates skill instructions while preserving metadata and the existing enabled agents", async () => {
        const writeFile = jest.fn();
        jest.mocked(createNodeMigrateSkillFs).mockReturnValue({ writeFile } as never);
        const manager = SkillManager.initialize(makeApp(), { claude: ".claude/skills" });
        jest.spyOn(manager, "refresh").mockResolvedValue({
          ok: true,
          folder: skillsFolder,
          skillCount: 1,
          reconcileErrorCount: 0,
        });
        expect(
          await manager.saveContent(
            makeSkill(),
            "---\nname: foo\ndescription: A skill\ncustom-field: keep\n---\nUpdated instructions"
          )
        ).toEqual({ ok: true });
        expect(writeFile.mock.calls[0][1]).toContain("custom-field: keep");
        expect(parseSkillFile(writeFile.mock.calls[0][1], "foo").frontmatter.enabledAgents).toEqual(
          ["claude"]
        );
      });
      it("keeps updated instructions saved and reports the link failure instead of claiming syncing succeeded", async () => {
        const writeFile = jest.fn();
        jest.mocked(createNodeMigrateSkillFs).mockReturnValue({ writeFile } as never);
        const manager = SkillManager.initialize(makeApp(), { claude: ".claude/skills" });
        jest.spyOn(manager, "refresh").mockResolvedValue({
          ok: true,
          folder: skillsFolder,
          skillCount: 1,
          reconcileErrorCount: 1,
        });
        expect(
          await manager.saveContent(
            makeSkill(),
            "---\nname: foo\ndescription: A skill\n---\nUpdated instructions"
          )
        ).toEqual({
          ok: true,
          warning: "Some skill links could not be updated. Check folder permissions.",
        });
        expect(writeFile.mock.calls[0][1]).toContain("Updated instructions");
      });
    });

    describe("dispose", () => {
      it("clears the rejected-skill count on disposal so plugin reloads do not keep a stale warning", async () => {
        const manager = SkillManager.initialize(makeApp(), { claude: ".claude/skills" });
        const { result: loadErrorCount } = renderHook(() => useSkillLoadErrorCount());
        mockedDiscoverManagedSkills.mockResolvedValueOnce(
          discoveryResult(
            [],
            [
              {
                name: "broken-skill",
                filePath: "/vault/scribe/skills/broken-skill/SKILL.md",
                dirPath: "/vault/scribe/skills/broken-skill",
                reason: "The description must be quoted.",
              },
            ]
          )
        );

        await act(() => manager.refresh());
        expect(loadErrorCount.current).toBe(1);

        act(() => manager.dispose());
        expect(loadErrorCount.current).toBe(0);
      });
    });
  });
  describe("computeSkillSetSignature", () => {
    it("is identical for equivalent skill sets", () => {
      expect(computeSkillSetSignature([makeSkill()], "claude")).toBe(
        computeSkillSetSignature([makeSkill()], "claude")
      );
    });

    it("differs when a skill body or its enabled agents change", () => {
      const base = makeSkill({ enabledAgents: ["claude"] });
      const bodyChanged = makeSkill({ body: "new body", enabledAgents: ["claude"] });
      const enabledChanged = makeSkill({ enabledAgents: ["opencode"] });

      expect(computeSkillSetSignature([base], "opencode")).not.toBe(
        computeSkillSetSignature([bodyChanged], "opencode")
      );
      expect(computeSkillSetSignature([base], "opencode")).not.toBe(
        computeSkillSetSignature([enabledChanged], "opencode")
      );
    });
  });
});

function makeApp(): App & {
  vault: App["vault"] & {
    on: jest.Mock<EventRef, [string, (...args: unknown[]) => void]>;
    offref: jest.Mock<void, [EventRef]>;
  };
} {
  const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter)(
    "/vault"
  );
  adapter.exists = jest.fn().mockResolvedValue(true);
  adapter.list = jest.fn().mockResolvedValue({ files: [], folders: [] });
  adapter.read = jest.fn().mockResolvedValue("");
  return {
    vault: {
      adapter,
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => ({ event, handler })),
      offref: jest.fn(),
    },
  } as unknown as App & {
    vault: App["vault"] & {
      on: jest.Mock<EventRef, [string, (...args: unknown[]) => void]>;
      offref: jest.Mock<void, [EventRef]>;
    };
  };
}

async function seedSkills(manager: SkillManager, skills: Skill[]): Promise<void> {
  mockedDiscoverManagedSkills.mockResolvedValueOnce(discoveryResult(skills));
  await manager.refresh();
}

function discoveryResult(
  accepted: Skill[] = [],
  rejected: RejectedSkill[] = []
): SkillDiscoveryResult<Skill> {
  return { accepted, rejected };
}

function fireVaultEvent(
  app: ReturnType<typeof makeApp>,
  event: string,
  file: { path: string },
  oldPath?: string
): void {
  const call = app.vault.on.mock.calls.find(([e]) => e === event);
  if (call === undefined) throw new Error(`No handler registered for "${event}"`);
  if (oldPath !== undefined) {
    call[1](file, oldPath);
  } else {
    call[1](file);
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  const name = overrides.name ?? "foo";
  const dirPath = overrides.dirPath ?? `/vault/scribe/skills/${name}`;
  return {
    name: "foo",
    description: "A skill.",
    filePath: `${dirPath}/SKILL.md`,
    dirPath,
    body: "body",
    enabledAgents: ["claude"],
    location: { kind: "canonical" },
    ...overrides,
  };
}
