import {
  SCRIBE_SUBFOLDER,
  deriveConversationAttachmentsFolder,
  deriveConversationsFolder,
  deriveCustomPromptsFolder,
  deriveMemoryFolder,
  deriveProjectsFolder,
  deriveSkillsFolder,
  deriveSystemPromptsFolder,
  ensureScribeSubfolders,
  getEffectiveConversationsFolder,
  getEffectiveScribeFolder,
  getEffectiveCustomPromptsFolder,
  getEffectiveMemoryFolder,
  getEffectiveProjectsFolder,
  getEffectiveSkillsFolder,
  getEffectiveSystemPromptsFolder,
} from "@/settings/scribeFolder";
import type { ScribeSettings } from "@/settings/model";
import { settingsAtom, settingsStore } from "@/settings/model";
import { DEFAULT_SETTINGS } from "@/constants";

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
}));

function setGlobalRoot(scribeFolder: string): void {
  settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, scribeFolder });
}

function settingsWithRoot(scribeFolder: string): ScribeSettings {
  return { scribeFolder } as ScribeSettings;
}

describe("scribeFolder", () => {
  describe("deriveConversationsFolder()", () => {
    it("derives the historical default conversations path for the default root", () => {
      expect(deriveConversationsFolder(settingsWithRoot("scribe"))).toBe(
        "scribe/scribe-conversations"
      );
      expect(deriveConversationsFolder(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.defaultSaveFolder);
    });

    it("re-roots the conversations folder under a custom root", () => {
      expect(deriveConversationsFolder(settingsWithRoot("team/ai"))).toBe(
        "team/ai/scribe-conversations"
      );
    });

    it("falls back to the default root when the configured root is blank", () => {
      expect(deriveConversationsFolder(settingsWithRoot("  "))).toBe("scribe/scribe-conversations");
    });
  });

  describe("deriveConversationAttachmentsFolder()", () => {
    it("nests the attachment store inside the conversations folder it is given", () => {
      expect(deriveConversationAttachmentsFolder("scribe/scribe-conversations")).toBe(
        "scribe/scribe-conversations/attachments"
      );
    });

    it("follows a relocated Scribe root through the conversations folder", () => {
      expect(deriveConversationAttachmentsFolder("team/ai/scribe-conversations")).toBe(
        "team/ai/scribe-conversations/attachments"
      );
    });
  });

  describe("deriveCustomPromptsFolder()", () => {
    it("derives the historical default custom-prompts path for the default root", () => {
      expect(deriveCustomPromptsFolder(settingsWithRoot("scribe"))).toBe(
        "scribe/scribe-custom-prompts"
      );
      expect(deriveCustomPromptsFolder(DEFAULT_SETTINGS)).toBe(
        DEFAULT_SETTINGS.customPromptsFolder
      );
    });

    it("re-roots the custom-prompts folder under a custom root", () => {
      expect(deriveCustomPromptsFolder(settingsWithRoot("notes/scribe"))).toBe(
        "notes/scribe/scribe-custom-prompts"
      );
    });
  });

  describe("deriveSystemPromptsFolder()", () => {
    it("derives the historical default system-prompts path for the default root", () => {
      expect(deriveSystemPromptsFolder(settingsWithRoot("scribe"))).toBe("scribe/system-prompts");
      expect(deriveSystemPromptsFolder(DEFAULT_SETTINGS)).toBe(
        DEFAULT_SETTINGS.userSystemPromptsFolder
      );
    });

    it("re-roots the system-prompts folder under a custom root", () => {
      expect(deriveSystemPromptsFolder(settingsWithRoot("team/ai"))).toBe("team/ai/system-prompts");
    });
  });

  describe("deriveSkillsFolder()", () => {
    it("derives the historical default skills path for the default root", () => {
      expect(deriveSkillsFolder(settingsWithRoot("scribe"))).toBe("scribe/skills");
      expect(deriveSkillsFolder(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.agentMode.skills.folder);
    });

    it("re-roots the skills folder under a custom root", () => {
      expect(deriveSkillsFolder(settingsWithRoot("team/ai"))).toBe("team/ai/skills");
    });
  });

  describe("deriveMemoryFolder()", () => {
    it("derives the historical default memory path for the default root", () => {
      expect(deriveMemoryFolder(settingsWithRoot("scribe"))).toBe("scribe/memory");
      expect(deriveMemoryFolder(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.memoryFolderName);
    });

    it("re-roots the memory folder under a custom root", () => {
      expect(deriveMemoryFolder(settingsWithRoot("team/ai"))).toBe("team/ai/memory");
    });
  });

  describe("deriveProjectsFolder()", () => {
    it("derives the historical default projects path for the default root", () => {
      expect(deriveProjectsFolder(settingsWithRoot("scribe"))).toBe("scribe/projects");
      expect(deriveProjectsFolder(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.projectsFolder);
    });

    it("re-roots the projects folder under a custom root", () => {
      expect(deriveProjectsFolder(settingsWithRoot("team/ai"))).toBe("team/ai/projects");
    });
  });

  describe("SCRIBE_SUBFOLDER", () => {
    it("pins the sub-folder names to the historical hardcoded defaults", () => {
      expect(SCRIBE_SUBFOLDER).toEqual({
        conversations: "scribe-conversations",
        customPrompts: "scribe-custom-prompts",
        systemPrompts: "system-prompts",
        skills: "skills",
        memory: "memory",
        projects: "projects",
      });
    });
  });

  describe.each([
    ["getEffectiveScribeFolder", getEffectiveScribeFolder, "team/ai"],
    [
      "getEffectiveConversationsFolder",
      getEffectiveConversationsFolder,
      "team/ai/scribe-conversations",
    ],
    [
      "getEffectiveCustomPromptsFolder",
      getEffectiveCustomPromptsFolder,
      "team/ai/scribe-custom-prompts",
    ],
    ["getEffectiveSystemPromptsFolder", getEffectiveSystemPromptsFolder, "team/ai/system-prompts"],
    ["getEffectiveSkillsFolder", getEffectiveSkillsFolder, "team/ai/skills"],
    ["getEffectiveMemoryFolder", getEffectiveMemoryFolder, "team/ai/memory"],
    ["getEffectiveProjectsFolder", getEffectiveProjectsFolder, "team/ai/projects"],
  ])("%s()", (_name, getEffective, expected) => {
    it("derives the folder from the current global scribeFolder", () => {
      setGlobalRoot("team/ai");
      expect(getEffective()).toBe(expected);
    });
  });

  describe("ensureScribeSubfolders()", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ensureFolderExists } = require("@/utils") as {
      ensureFolderExists: jest.MockedFunction<(vault: unknown, folder: string) => Promise<void>>;
    };
    const fakeVault = {} as import("obsidian").Vault;

    beforeEach(() => ensureFolderExists.mockClear());

    it("creates all six derived sub-folders under the given root", async () => {
      await ensureScribeSubfolders(fakeVault, settingsWithRoot("team/ai"));
      const created = ensureFolderExists.mock.calls.map((call) => call[1]);
      expect(created).toEqual([
        "team/ai/scribe-conversations",
        "team/ai/scribe-custom-prompts",
        "team/ai/system-prompts",
        "team/ai/skills",
        "team/ai/memory",
        "team/ai/projects",
      ]);
    });

    it("continues past a folder that fails so one bad path cannot block the rest", async () => {
      ensureFolderExists
        .mockRejectedValueOnce(new Error("path conflict"))
        .mockResolvedValue(undefined);
      await expect(
        ensureScribeSubfolders(fakeVault, settingsWithRoot("scribe"))
      ).resolves.toBeUndefined();
      expect(ensureFolderExists).toHaveBeenCalledTimes(6);
    });
  });
});
