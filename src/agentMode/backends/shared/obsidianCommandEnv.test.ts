import { buildObsidianCommandEnv } from "./obsidianCommandEnv";
import {
  SCRIBE_OBSIDIAN_CLI_ENV,
  resolveObsidianCliPath,
} from "@/agentMode/backends/shared/obsidianCliPath";

jest.mock("@/agentMode/backends/shared/obsidianCliPath", () => ({
  SCRIBE_OBSIDIAN_CLI_ENV: "SCRIBE_OBSIDIAN_CLI",
  resolveObsidianCliPath: jest.fn(),
}));

const mockResolveObsidianCliPath = jest.mocked(resolveObsidianCliPath);

describe("obsidianCommandEnv", () => {
  describe("buildObsidianCommandEnv()", () => {
    it("passes only the Obsidian command path to the agent when it is available", async () => {
      mockResolveObsidianCliPath.mockReturnValue(
        "/Applications/Obsidian.app/Contents/MacOS/obsidian"
      );
      expect(await buildObsidianCommandEnv()).toEqual({
        [SCRIBE_OBSIDIAN_CLI_ENV]: "/Applications/Obsidian.app/Contents/MacOS/obsidian",
      });
    });

    it("returns a stable empty value when the command is unavailable", async () => {
      mockResolveObsidianCliPath.mockReturnValue(null);
      const first = await buildObsidianCommandEnv();
      expect(first).toEqual({});
      expect(await buildObsidianCommandEnv()).toBe(first);
    });
  });
});
