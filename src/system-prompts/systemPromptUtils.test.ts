import {
  ensurePromptFrontmatter,
  getPromptFilePath,
  getPromptFilePathInFolder,
  getSystemPromptsFolder,
} from "@/system-prompts/systemPromptUtils";
import {
  SCRIBE_SYSTEM_PROMPT_CREATED,
  SCRIBE_SYSTEM_PROMPT_LAST_USED,
  SCRIBE_SYSTEM_PROMPT_MODIFIED,
} from "@/system-prompts/constants";
import type { UserSystemPrompt } from "@/system-prompts/type";
import type { App } from "obsidian";
import { mockTFile } from "@/__tests__/mockObsidian";
import { resetSettings, updateSetting } from "@/settings/model";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

describe("systemPromptUtils", () => {
  beforeEach(() => {
    resetSettings();
    updateSetting("scribeFolder", "Archive");
  });

  describe("getSystemPromptsFolder()", () => {
    it("returns the effective system prompts folder", () => {
      updateSetting("scribeFolder", "CustomFolder");
      expect(getSystemPromptsFolder()).toBe("CustomFolder/system-prompts");
    });
  });

  describe("getPromptFilePath()", () => {
    it("returns the prompt path with its Markdown extension", () => {
      expect(getPromptFilePath("My Prompt")).toBe("Archive/system-prompts/My Prompt.md");
    });

    it("preserves special characters in the title", () => {
      expect(getPromptFilePath("Prompt (copy)")).toBe("Archive/system-prompts/Prompt (copy).md");
    });
  });

  describe("getPromptFilePathInFolder()", () => {
    it("uses the configured folder when no folder is supplied", () => {
      expect(getPromptFilePathInFolder("Saved Prompt")).toBe(
        "Archive/system-prompts/Saved Prompt.md"
      );
    });

    it("uses an explicitly supplied folder", () => {
      expect(getPromptFilePathInFolder("Saved Prompt", "Archive/Prompts")).toBe(
        "Archive/Prompts/Saved Prompt.md"
      );
    });
  });

  describe("ensurePromptFrontmatter()", () => {
    const file = mockTFile({ path: "Archive/system-prompts/Saved Prompt.md" });
    const prompt: UserSystemPrompt = {
      title: "Saved Prompt",
      content: "Original instructions",
      createdMs: 100,
      modifiedMs: 200,
      lastUsedMs: 300,
    };

    async function applyFrontmatter(frontmatter: Record<string, unknown>, source = prompt) {
      const processFrontMatter = jest.fn(
        async (_file, update: (value: Record<string, unknown>) => void) => {
          update(frontmatter);
        }
      );
      const app = { fileManager: { processFrontMatter } } as unknown as App;
      await ensurePromptFrontmatter(app, file, source);
      expect(processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
      return frontmatter;
    }

    it("fills missing migration timestamps without changing existing metadata", async () => {
      expect(
        await applyFrontmatter({ author: "User", [SCRIBE_SYSTEM_PROMPT_CREATED]: 40 })
      ).toEqual({
        author: "User",
        [SCRIBE_SYSTEM_PROMPT_CREATED]: 40,
        [SCRIBE_SYSTEM_PROMPT_MODIFIED]: 200,
        [SCRIBE_SYSTEM_PROMPT_LAST_USED]: 300,
      });
    });

    it("uses the current time for absent creation and modification times and leaves last use unset", async () => {
      const now = jest.spyOn(Date, "now").mockReturnValue(500);
      try {
        expect(
          await applyFrontmatter({}, { ...prompt, createdMs: 0, modifiedMs: NaN, lastUsedMs: -1 })
        ).toEqual({
          [SCRIBE_SYSTEM_PROMPT_CREATED]: 500,
          [SCRIBE_SYSTEM_PROMPT_MODIFIED]: 500,
          [SCRIBE_SYSTEM_PROMPT_LAST_USED]: 0,
        });
      } finally {
        now.mockRestore();
      }
    });
  });
});
