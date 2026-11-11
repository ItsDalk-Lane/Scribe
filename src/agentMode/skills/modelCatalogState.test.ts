import { act, renderHook } from "@testing-library/react";
import {
  getSkillCatalogStatus,
  publishSkillCatalogStatus,
  resetSkillCatalogStatusForTesting,
  useSkillCatalogStatus,
  type SkillCatalogStatus,
} from "@/agentMode/skills/modelCatalogState";

// 目录预算状态向设置页发布，重复发布不触发新通知。https://github.com/ItsDalk-Lane/Scribe/issues/40
describe("modelCatalogState", () => {
  beforeEach(() => {
    resetSkillCatalogStatusForTesting();
  });

  describe("publishSkillCatalogStatus()", () => {
    it("stores the latest catalog status for readers", () => {
      expect(getSkillCatalogStatus()).toBeNull();
      publishSkillCatalogStatus({ mode: "full", includedNames: ["a"], omittedNames: [] });
      expect(getSkillCatalogStatus()).toEqual({
        mode: "full",
        includedNames: ["a"],
        omittedNames: [],
      });
      publishSkillCatalogStatus({ mode: "pruned", includedNames: ["a"], omittedNames: ["b"] });
      expect(getSkillCatalogStatus()?.mode).toBe("pruned");
    });

    it("keeps the previous object identity for an identical repeat so per-turn rebuilds do not churn subscribers", () => {
      const status: SkillCatalogStatus = { mode: "full", includedNames: ["a"], omittedNames: [] };
      publishSkillCatalogStatus(status);
      const stored = getSkillCatalogStatus();
      publishSkillCatalogStatus({ ...status });
      expect(getSkillCatalogStatus()).toBe(stored);
    });
  });

  describe("useSkillCatalogStatus()", () => {
    it("exposes the published status to React consumers", () => {
      const { result } = renderHook(() => useSkillCatalogStatus());
      expect(result.current).toBeNull();
      act(() => {
        publishSkillCatalogStatus({ mode: "names-only", includedNames: [], omittedNames: ["a"] });
      });
      expect(result.current?.mode).toBe("names-only");
    });
  });
});
