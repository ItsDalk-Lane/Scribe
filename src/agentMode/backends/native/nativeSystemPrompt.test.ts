import { FileSystemAdapter, type App } from "obsidian";
import { DEFAULT_SETTINGS } from "@/constants";
import { setSettings } from "@/settings/model";
import { buildNativeSystemPrompt } from "@/agentMode/backends/native/nativeSystemPrompt";
import { readAgentsFile } from "@/instructions/agentsFile";
import { getCachedProjectRecordById } from "@/projects/state";

jest.mock("@/agentMode/backends/shared/agentSystemPrompt", () => ({
  buildAgentSystemPrompt: () => "Scribe Obsidian identity",
}));
jest.mock("@/instructions/agentsFile", () => ({ readAgentsFile: jest.fn() }));
jest.mock("@/projects/state", () => ({ getCachedProjectRecordById: jest.fn() }));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

function app(): App {
  return {
    vault: {
      adapter: Object.assign(Object.create(FileSystemAdapter.prototype), {
        getBasePath: () => "/vault",
        exists: jest.fn().mockResolvedValue(false),
        read: jest.fn(),
      }),
    },
  } as unknown as App;
}

describe("nativeSystemPrompt", () => {
  describe("buildNativeSystemPrompt()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest
        .mocked(readAgentsFile)
        .mockImplementation(async (_app, folder) =>
          folder ? "Project directory rules" : "Vault rules"
        );
      jest.mocked(getCachedProjectRecordById).mockReturnValue(undefined);
    });
    it("combines Scribe identity, vault rules and only the selected project's own instructions in a fixed order", async () => {
      const target = app();
      jest.mocked(getCachedProjectRecordById).mockReturnValue({
        project: { systemPrompt: "Selected project instructions" },
      } as ReturnType<typeof getCachedProjectRecordById>);
      const prompt = await buildNativeSystemPrompt(target, {
        cwd: "/vault/Projects/Research",
        projectId: "research",
      });
      const parts = [
        "Scribe Obsidian identity",
        "Vault rules",
        "Selected project instructions",
        "Project directory rules",
      ];
      for (const part of parts) expect(prompt).toContain(part);
      expect(parts.map((part) => prompt.indexOf(part))).toEqual(
        [...parts.map((part) => prompt.indexOf(part))].sort((a, b) => a - b)
      );
      expect(jest.mocked(readAgentsFile).mock.calls.map((args) => args[1])).toEqual([
        "",
        "Projects/Research",
      ]);
      expect(getCachedProjectRecordById).toHaveBeenCalledWith("research");
    });
    it("keeps global chat free of other projects' instructions and reads vault AGENTS only once", async () => {
      const prompt = await buildNativeSystemPrompt(app(), { cwd: "/vault" });
      expect(prompt).toContain("Vault rules");
      expect(prompt).not.toContain("Project directory rules");
      expect(getCachedProjectRecordById).not.toHaveBeenCalled();
      expect(readAgentsFile).toHaveBeenCalledTimes(1);
    });
    it("ignores retired custom prompt settings without reading their selected directory", async () => {
      const target = app();
      jest.mocked(target.vault.adapter.exists).mockResolvedValue(true);
      jest
        .mocked(target.vault.adapter.read)
        .mockResolvedValue("---\ntitle: Selected\n---\n\nSelected prompt body");
      setSettings({
        ...DEFAULT_SETTINGS,
        ...{ defaultSystemPromptTitle: "Selected", userSystemPrompt: "Legacy text" },
      });
      const prompt = await buildNativeSystemPrompt(target, { cwd: "/vault" });
      expect(prompt).not.toContain("Selected prompt body");
      expect(prompt).not.toContain("Legacy text");
      expect(prompt).not.toContain("title: Selected");
      expect(target.vault.adapter.exists).not.toHaveBeenCalled();
      expect(target.vault.adapter.read).not.toHaveBeenCalled();
    });
    it("rejects a non-desktop vault before reading instructions", async () => {
      await expect(
        buildNativeSystemPrompt({ vault: { adapter: {} } } as unknown as App, { cwd: "/vault" })
      ).rejects.toThrow("desktop vault");
      expect(readAgentsFile).not.toHaveBeenCalled();
    });
    it("rejects a working directory outside the current vault before reading any instructions", async () => {
      await expect(buildNativeSystemPrompt(app(), { cwd: "/other-vault" })).rejects.toThrow(
        "must belong"
      );
      expect(readAgentsFile).not.toHaveBeenCalled();
    });
  });
});
