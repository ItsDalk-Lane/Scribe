import type { Vault } from "obsidian";
import { ensureFolderExists } from "@/utils";
import {
  deriveConversationsFolder,
  deriveCustomPromptsFolder,
  deriveProjectsFolder,
  deriveSkillsFolder,
  ensureScribeSubfolders,
  getEffectiveConversationsFolder,
  getEffectiveScribeFolder,
  getEffectiveCustomPromptsFolder,
  getEffectiveProjectsFolder,
  getEffectiveSkillsFolder,
} from "./scribeFolder";

jest.mock("@/utils", () => ({ ensureFolderExists: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

describe("scribeFolder", () => {
  describe.each([
    ["deriveConversationsFolder()", deriveConversationsFolder, ".scribe/chats"],
    ["deriveCustomPromptsFolder()", deriveCustomPromptsFolder, ".scribe/scribe-custom-prompts"],
    ["deriveSkillsFolder()", deriveSkillsFolder, ".scribe/skills"],
    ["deriveProjectsFolder()", deriveProjectsFolder, ".scribe/projects"],
  ])("%s", (_name, derive, path) => {
    it("uses the current vault's hidden folder regardless of a legacy custom location", () => {
      expect(derive({ scribeFolder: "old/custom-location" })).toBe(path);
      expect(derive()).toBe(path);
    });
  });
  describe.each([
    ["getEffectiveScribeFolder()", getEffectiveScribeFolder, ".scribe"],
    ["getEffectiveConversationsFolder()", getEffectiveConversationsFolder, ".scribe/chats"],
    [
      "getEffectiveCustomPromptsFolder()",
      getEffectiveCustomPromptsFolder,
      ".scribe/scribe-custom-prompts",
    ],
    ["getEffectiveSkillsFolder()", getEffectiveSkillsFolder, ".scribe/skills"],
    ["getEffectiveProjectsFolder()", getEffectiveProjectsFolder, ".scribe/projects"],
  ])("%s", (_name, derive, path) => {
    it("returns a fixed vault-relative location", () => {
      expect(derive()).toBe(path);
    });
  });
  describe("ensureScribeSubfolders()", () => {
    beforeEach(() => jest.mocked(ensureFolderExists).mockClear());
    it("creates only the new layout without recreating old chat-note folders", async () => {
      await ensureScribeSubfolders({} as Vault, { scribeFolder: "old-location" });
      expect(jest.mocked(ensureFolderExists).mock.calls.map((call) => call[1])).toEqual([
        ".scribe/scribe-custom-prompts",
        ".scribe/skills",
        ".scribe/projects",
      ]);
    });
    it("reports no fallback location when a folder cannot be created", async () => {
      jest.mocked(ensureFolderExists).mockRejectedValueOnce(new Error("read only"));
      await ensureScribeSubfolders({} as Vault);
      expect(
        jest.mocked(ensureFolderExists).mock.calls.every((call) => call[1].startsWith(".scribe/"))
      ).toBe(true);
    });
  });
});
