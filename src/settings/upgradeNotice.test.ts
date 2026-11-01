import type { CopilotSettings } from "@/settings/model";
import { buildUpgradeRelocationEntries } from "@/settings/upgradeNotice";

function buildSettings(
  overrides: Partial<{
    copilotFolder: string;
    defaultSaveFolder: string;
    customPromptsFolder: string;
    userSystemPromptsFolder: string;
    skillsFolder: string;
    memoryFolderName: string;
  }> = {}
): CopilotSettings {
  const {
    copilotFolder = "copilot",
    defaultSaveFolder = "copilot/scribe-conversations",
    customPromptsFolder = "copilot/scribe-custom-prompts",
    userSystemPromptsFolder = "copilot/system-prompts",
    skillsFolder = "copilot/skills",
    memoryFolderName = "copilot/memory",
  } = overrides;
  return {
    copilotFolder,
    defaultSaveFolder,
    customPromptsFolder,
    userSystemPromptsFolder,
    memoryFolderName,
    agentMode: { skills: { folder: skillsFolder } },
  } as unknown as CopilotSettings;
}

describe("upgradeNotice", () => {
  describe("buildUpgradeRelocationEntries()", () => {
    it("returns no entries when every folder is at its legacy default", () => {
      expect(buildUpgradeRelocationEntries(buildSettings())).toEqual([]);
    });

    it("reports a single customized folder with its old value and derived new path", () => {
      const entries = buildUpgradeRelocationEntries(
        buildSettings({ defaultSaveFolder: "my-notes/chats" })
      );
      expect(entries).toEqual([
        {
          label: "Chat conversations",
          oldPath: "my-notes/chats",
          newPath: "copilot/scribe-conversations",
        },
      ]);
    });

    it("reports every customized folder while omitting the untouched ones", () => {
      const entries = buildUpgradeRelocationEntries(
        buildSettings({
          customPromptsFolder: "prompts",
          userSystemPromptsFolder: "sys",
          skillsFolder: "my-skills",
        })
      );
      expect(entries).toEqual([
        { label: "Custom prompts", oldPath: "prompts", newPath: "copilot/scribe-custom-prompts" },
        { label: "System prompts", oldPath: "sys", newPath: "copilot/system-prompts" },
        { label: "Agent skills", oldPath: "my-skills", newPath: "copilot/skills" },
      ]);
    });

    it("lists every sub-folder when the root moves, since they all relocate", () => {
      const entries = buildUpgradeRelocationEntries(
        buildSettings({ copilotFolder: "team/ai", defaultSaveFolder: "old/chats" })
      );
      expect(entries).toEqual([
        {
          label: "Chat conversations",
          oldPath: "old/chats",
          newPath: "team/ai/scribe-conversations",
        },
        {
          label: "Custom prompts",
          oldPath: "copilot/scribe-custom-prompts",
          newPath: "team/ai/scribe-custom-prompts",
        },
        {
          label: "System prompts",
          oldPath: "copilot/system-prompts",
          newPath: "team/ai/system-prompts",
        },
        { label: "Agent skills", oldPath: "copilot/skills", newPath: "team/ai/skills" },
        { label: "Memory", oldPath: "copilot/memory", newPath: "team/ai/memory" },
      ]);
    });

    it("surfaces a customized memory folder, since the new manager reads the derived path", () => {
      const entries = buildUpgradeRelocationEntries(
        buildSettings({ memoryFolderName: "my-memory" })
      );
      expect(entries).toEqual([
        { label: "Memory", oldPath: "my-memory", newPath: "copilot/memory" },
      ]);
    });

    it("omits folders whose old value already equals the derived new path", () => {
      const entries = buildUpgradeRelocationEntries(
        buildSettings({
          copilotFolder: "team/ai",
          defaultSaveFolder: "team/ai/scribe-conversations",
          customPromptsFolder: "team/ai/scribe-custom-prompts",
          userSystemPromptsFolder: "team/ai/system-prompts",
          skillsFolder: "team/ai/skills",
          memoryFolderName: "team/ai/memory",
        })
      );
      expect(entries).toEqual([]);
    });

    it("does not flag a default folder that differs only by a trailing slash", () => {
      expect(
        buildUpgradeRelocationEntries(
          buildSettings({ defaultSaveFolder: "copilot/scribe-conversations/" })
        )
      ).toEqual([]);
    });

    it("does not flag a default folder that differs only by a trailing slash then whitespace", () => {
      expect(
        buildUpgradeRelocationEntries(
          buildSettings({ defaultSaveFolder: "copilot/scribe-conversations/ " })
        )
      ).toEqual([]);
    });

    it("flags a folder that differs from its default only by letter case as customized", () => {
      expect(
        buildUpgradeRelocationEntries(
          buildSettings({ defaultSaveFolder: "Copilot/scribe-conversations" })
        )
      ).toEqual([
        {
          label: "Chat conversations",
          oldPath: "Copilot/scribe-conversations",
          newPath: "copilot/scribe-conversations",
        },
      ]);
    });

    it("does not flag a default folder that differs only by path separator", () => {
      expect(
        buildUpgradeRelocationEntries(
          buildSettings({ userSystemPromptsFolder: "copilot\\system-prompts" })
        )
      ).toEqual([]);
    });
  });
});
