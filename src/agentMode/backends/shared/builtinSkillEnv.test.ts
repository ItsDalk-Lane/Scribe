import { buildBuiltinSkillEnv } from "./builtinSkillEnv";
import {
  SCRIBE_OBSIDIAN_CLI_ENV,
  resolveObsidianCliPath,
} from "@/agentMode/backends/shared/obsidianCliPath";

jest.mock("@/agentMode/backends/shared/obsidianCliPath", () => ({
  SCRIBE_OBSIDIAN_CLI_ENV: "SCRIBE_OBSIDIAN_CLI",
  resolveObsidianCliPath: jest.fn(),
}));

const mockResolveObsidianCliPath = jest.mocked(resolveObsidianCliPath);

describe("builtinSkillEnv", () => {
  describe("buildBuiltinSkillEnv()", () => {
    it("passes only the Obsidian command path to the agent when it is available", async () => {
      mockResolveObsidianCliPath.mockReturnValue(
        "/Applications/Obsidian.app/Contents/MacOS/obsidian"
      );
      expect(await buildBuiltinSkillEnv()).toEqual({
        [SCRIBE_OBSIDIAN_CLI_ENV]: "/Applications/Obsidian.app/Contents/MacOS/obsidian",
      });
    });

    it("returns a stable empty value when the command is unavailable", async () => {
      mockResolveObsidianCliPath.mockReturnValue(null);
      const first = await buildBuiltinSkillEnv();
      expect(first).toEqual({});
      expect(await buildBuiltinSkillEnv()).toBe(first);
    });
  });
});
