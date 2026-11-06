import {
  checkSkillDependency,
  checkSkillDependencies,
  clearSkillDependencyCache,
  resetSkillDependencyCacheForTesting,
} from "@/agentMode/skills/skillDependencyCheck";

// 只读依赖检测：命令行走 PATH，插件查清单，Python 包用固定查询；结果缓存且绝不安装。
// https://github.com/ItsDalk-Lane/Scribe/issues/46
describe("skillDependencyCheck", () => {
  beforeEach(() => {
    resetSkillDependencyCacheForTesting();
  });

  describe("checkSkillDependency()", () => {
    it("reports a ready command with its resolved path", async () => {
      const reading = await checkSkillDependency(
        { type: "command", name: "ffmpeg" },
        { resolveCommand: async () => "/opt/homebrew/bin/ffmpeg" }
      );
      expect(reading).toEqual({
        type: "command",
        name: "ffmpeg",
        ready: true,
        detail: "/opt/homebrew/bin/ffmpeg",
      });
    });

    it("reports a missing command, plugin and python package as not ready", async () => {
      expect(
        await checkSkillDependency(
          { type: "command", name: "ffmpeg" },
          {
            resolveCommand: async () => null,
          }
        )
      ).toMatchObject({ ready: false, detail: "not found on PATH" });
      expect(
        await checkSkillDependency({ type: "obsidian-plugin", name: "obsidian-excalidraw" })
      ).toMatchObject({ ready: false, detail: "not installed" });
      expect(
        await checkSkillDependency(
          { type: "python-package", name: "pandas" },
          {
            pythonVersion: async () => null,
          }
        )
      ).toMatchObject({ ready: false, detail: "python package not found" });
    });

    it("reports an installed plugin and python package with their versions", async () => {
      expect(
        await checkSkillDependency(
          { type: "obsidian-plugin", name: "obsidian-excalidraw" },
          {
            pluginVersion: () => "2.1.7",
          }
        )
      ).toMatchObject({ ready: true, detail: "version 2.1.7" });
      expect(
        await checkSkillDependency(
          { type: "python-package", name: "pandas" },
          {
            pythonVersion: async () => "2.2.3",
          }
        )
      ).toMatchObject({ ready: true, detail: "version 2.2.3" });
    });

    it("caches readings per dependency and recomputes only when fresh is requested", async () => {
      const resolveCommand = jest.fn(async () => "/usr/bin/ffmpeg");
      const dependency = { type: "command" as const, name: "ffmpeg" };
      await checkSkillDependency(dependency, { resolveCommand });
      await checkSkillDependency(dependency, { resolveCommand });
      expect(resolveCommand).toHaveBeenCalledTimes(1);
      await checkSkillDependency(dependency, { resolveCommand }, true);
      expect(resolveCommand).toHaveBeenCalledTimes(2);
    });
  });

  describe("checkSkillDependencies()", () => {
    it("checks every declared dependency in order", async () => {
      const readings = await checkSkillDependencies(
        [
          { type: "command", name: "ffmpeg" },
          { type: "obsidian-plugin", name: "obsidian-excalidraw" },
        ],
        { resolveCommand: async () => "/usr/bin/ffmpeg", pluginVersion: () => "2.1.7" }
      );
      expect(readings.map((reading) => reading.ready)).toEqual([true, true]);
    });
  });

  describe("clearSkillDependencyCache()", () => {
    it("drops cached readings so the next check recomputes", async () => {
      const resolveCommand = jest.fn(async () => null);
      const dependency = { type: "command" as const, name: "ffmpeg" };
      await checkSkillDependency(dependency, { resolveCommand });
      clearSkillDependencyCache();
      await checkSkillDependency(dependency, { resolveCommand });
      expect(resolveCommand).toHaveBeenCalledTimes(2);
    });
  });
});
