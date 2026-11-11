import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import {
  OrphanedProjectError,
  pickScopeNeighbor,
  resolveProjectIdForCwd,
  resolveScopeCwd,
} from "@/agentMode/session/sessionScope";
import { updateCachedProjectRecords } from "@/projects/state";
import type { ProjectFileRecord } from "@/projects/type";

describe("sessionScope", () => {
  beforeEach(() =>
    updateCachedProjectRecords([
      {
        project: { id: "research", workspacePath: "Research Workspace" },
        filePath: ".scribe/projects/research/project.md",
        folderName: "research",
      } as ProjectFileRecord,
    ])
  );
  afterEach(() => updateCachedProjectRecords([]));
  describe("resolveScopeCwd()", () => {
    it("uses the selected project workspace instead of its hidden configuration folder", () => {
      expect(resolveScopeCwd("/vault", "research")).toBe("/vault/Research Workspace");
    });
    it("uses the vault root for a global chat and rejects a removed project", () => {
      expect(resolveScopeCwd("/vault", GLOBAL_SCOPE)).toBe("/vault");
      expect(() => resolveScopeCwd("/vault", "removed")).toThrow(OrphanedProjectError);
    });
  });
  describe("resolveProjectIdForCwd()", () => {
    it("matches a project by workspace and leaves unrelated directories unassigned", () => {
      expect(resolveProjectIdForCwd("/vault", "/vault/Research Workspace")).toBe("research");
      expect(resolveProjectIdForCwd("/vault", "/vault/.scribe/projects/research")).toBeUndefined();
      expect(resolveProjectIdForCwd("/vault", "/vault")).toBeUndefined();
    });
  });
  describe("pickScopeNeighbor()", () => {
    it("prefers an available recent scope and otherwise chooses the neighboring scope", () => {
      expect(pickScopeNeighbor(["one", "two"], 0, "two")).toBe("two");
      expect(pickScopeNeighbor(["one", "two"], 1, undefined)).toBe("two");
      expect(pickScopeNeighbor([], 0, undefined)).toBeNull();
    });
  });
  describe("OrphanedProjectError", () => {
    describe("constructor()", () => {
      it("identifies the project that can no longer be opened", () => {
        const error = new OrphanedProjectError("removed");
        expect(error.projectId).toBe("removed");
        expect(error.message).toContain("removed");
      });
    });
  });
});
