import type { AgentBrand, InstallState } from "@/agentMode/session/types";
import { AppContext } from "@/context";
import { PluginProvider } from "@/contexts/PluginContext";
import { DEFAULT_SETTINGS } from "@/constants";
import type { RejectedSkill, Skill } from "@/agentMode/skills/types";
import { settingsAtom, settingsStore, updateSetting } from "@/settings/model";
import { isObsidianCliEnabled } from "@/services/obsidianCli/ObsidianCliClient";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { openVaultPath } from "@/utils/openVaultPath";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FileSystemAdapter, TFile, TFolder, type App } from "obsidian";
import React from "react";
import { Bot } from "lucide-react";
import type CopilotPlugin from "@/main";
import type { SkillLoadIssue } from "./SkillLoadIssues";
import { SkillsSettings, type SkillsSettingsProps } from "./SkillsSettings";

const setBuiltinSkillEnabled = jest.fn().mockResolvedValue({ ok: true });
const setBuiltinAgentEnabled = jest.fn().mockResolvedValue({ ok: true });
const refresh = jest.fn().mockResolvedValue({ ok: true, reconcileErrorCount: 0 });
const getAgentDirsProjectRel = jest.fn().mockReturnValue({});
let mockManagedSkills: Skill[] = [];
let mockAgents: AgentBrand[] = [];
let mockInstallStates: Record<string, InstallState> = {};
jest.mock("@/agentMode/session/useBackendInstallStates", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the production hook
  useBackendInstallStates: () => mockInstallStates,
}));
let mockRejectedSkills: RejectedSkill[] = [];
let mockCapturedLoadIssues: readonly SkillLoadIssue[] = [];
let mockCapturedFixAll: () => void = () => undefined;
const mockOpenSkillLoadIssuesModal = jest.fn();
const mockNewAgentChatWithDraft = jest.fn().mockResolvedValue(undefined);
const mockCloseSettings = jest.fn();
jest.mock("@/agentMode/skills/SkillManager", () => ({
  SkillManager: {
    getInstance: () => ({
      refresh,
      getAgentDirsProjectRel,
      setBuiltinSkillEnabled,
      setBuiltinAgentEnabled,
    }),
  },
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useManagedSkills: () => mockManagedSkills,
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useRejectedSkills: () => mockRejectedSkills,
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useEpermSeen: () => false,
  dismissEpermBanner: jest.fn(),
}));

jest.mock("./SkillLoadIssues", () => {
  const actual = jest.requireActual("./SkillLoadIssues");
  return {
    ...actual,
    SkillLoadIssuesModal: class {
      open = mockOpenSkillLoadIssuesModal;

      constructor(_app: App, issues: readonly SkillLoadIssue[], onFixAll: () => void) {
        mockCapturedLoadIssues = issues;
        mockCapturedFixAll = onFixAll;
      }
    },
  };
});

jest.mock("@/utils/openWithSystemDefault", () => ({ openWithSystemDefault: jest.fn() }));
jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  isObsidianCliEnabled: jest.fn(),
}));
jest.mock("@/utils/openVaultPath", () => ({ openVaultPath: jest.fn() }));

jest.mock("@/agentMode/backends/registry", () => ({
  listBackendDescriptors: () => mockAgents,
}));

function renderSettings(app: App = makeApp(), props: SkillsSettingsProps = {}) {
  const plugin = {
    app,
    newAgentChatWithDraft: mockNewAgentChatWithDraft,
  } as unknown as CopilotPlugin;
  return render(
    <PluginProvider plugin={plugin}>
      <AppContext.Provider value={app}>
        <SkillsSettings {...props} />
      </AppContext.Provider>
    </PluginProvider>
  );
}

describe("SkillsSettings", () => {
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });
  describe("SkillsSettings()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      __resetVaultBaseCache();
      mockManagedSkills = [];
      mockAgents = [];
      mockInstallStates = {};
      mockRejectedSkills = [];
      mockCapturedLoadIssues = [];
      mockCapturedFixAll = () => undefined;
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, copilotFolder: "copilot" });
      jest.mocked(isObsidianCliEnabled).mockReturnValue(true);
    });

    it("filters current-vault skills with the parent search while hiding the embedded header", async () => {
      const skill: Skill = {
        name: "review-notes",
        description: "Review notes",
        body: "Review",
        filePath: "/vault/copilot/skills/review-notes/SKILL.md",
        dirPath: "/vault/copilot/skills/review-notes",
        enabledAgents: [],
        location: { kind: "canonical" },
      };
      mockManagedSkills = [
        skill,
        {
          ...skill,
          name: "translate",
          description: "Translate text",
          dirPath: "/vault/copilot/skills/translate",
        },
      ];
      await act(async () => {
        renderSettings(makeApp(), {
          embedded: true,
          query: "review",
          children: <div>Plugin skills</div>,
        });
      });
      expect(screen.getByText("review-notes")).toBeTruthy();
      expect(screen.queryByText("translate")).toBeNull();
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.getByText("Plugin skills")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "New skill" })).toBeNull();
    });

    it("shares checked availability with the managed and built-in skill lists", async () => {
      mockAgents = [{ id: "claude", displayName: "Claude", Icon: Bot }];
      mockInstallStates = { claude: { kind: "ready", source: "custom" } };
      const managed: Skill = {
        name: "review-notes",
        description: "Review notes",
        body: "Review",
        filePath: "/vault/copilot/skills/review-notes/SKILL.md",
        dirPath: "/vault/copilot/skills/review-notes",
        enabledAgents: ["claude"],
        location: { kind: "canonical" },
      };
      const builtin = {
        ...managed,
        name: "obsidian-markdown",
        filePath: "/vault/copilot/skills/obsidian-markdown/SKILL.md",
        dirPath: "/vault/copilot/skills/obsidian-markdown",
        builtin: true,
      };
      mockManagedSkills = [managed, builtin];
      await act(async () => {
        renderSettings(makeApp(), {
          embedded: true,
          runtimeItems: [
            {
              id: managed.filePath,
              name: managed.name,
              source: "project",
              location: managed.filePath,
              availability: "not_listed",
            },
            {
              id: builtin.filePath,
              name: builtin.name,
              source: "project",
              location: builtin.filePath,
              availability: "loaded",
            },
          ],
        });
      });
      expect(
        screen.getByRole("switch", { name: "Enable review-notes" }).getAttribute("aria-disabled")
      ).toBe("false");
      expect(
        screen.getByRole("switch", { name: "Enable review-notes" }).getAttribute("aria-checked")
      ).toBe("true");
      expect(
        screen
          .getByRole("switch", { name: "Enable obsidian-markdown" })
          .getAttribute("aria-disabled")
      ).toBe("false");
      expect(
        screen
          .getByRole("switch", { name: "Enable obsidian-markdown" })
          .getAttribute("aria-checked")
      ).toBe("true");
    });

    it("reports background cleanup failures when settings opens and clears them after focus refresh for https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      refresh.mockResolvedValueOnce({
        ok: true,
        reconcileErrorCount: 1,
        reconcileError: "Could not remove disabled built-in skill transcript.",
      });
      await act(async () => {
        renderSettings();
      });
      expect(screen.getByRole("alert").textContent).toBe(
        "Could not remove disabled built-in skill transcript."
      );
      await act(async () => {
        fireEvent.focus(window);
      });
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("ignores refresh results after unmount for https://github.com/logancyang/obsidian-copilot/issues/3022", async () => {
      let finish!: (value: unknown) => void;
      refresh.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      );
      const { unmount } = renderSettings();
      unmount();
      await act(async () => {
        finish({ ok: false, reconcileErrorCount: 1, reconcileError: "Late failure" });
      });
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("re-derives the displayed skills folder and re-scans when the Scribe root changes", async () => {
      await act(async () => {
        renderSettings();
      });
      expect(screen.getByText(/copilot\/skills/)).not.toBeNull();
      expect(refresh).toHaveBeenCalledTimes(1);

      await act(async () => {
        updateSetting("copilotFolder", "vault-tools");
      });

      expect(screen.getByText(/vault-tools\/skills/)).not.toBeNull();
      expect(screen.queryByText(/copilot\/skills/)).toBeNull();
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("refreshes hidden external-editor repairs when Settings regains focus for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
      await act(async () => {
        renderSettings();
      });
      expect(refresh).toHaveBeenCalledTimes(1);

      await act(async () => {
        fireEvent.focus(window);
      });

      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("shows actionable recovery instead of the creation empty state for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
      mockRejectedSkills = [makeRejectedSkill()];
      await act(async () => {
        renderSettings();
      });

      expect(screen.getByRole("alert", { name: "1 skill could not be loaded" })).not.toBeNull();
      expect(screen.getByText("The skills have format errors.")).not.toBeNull();
      expect(screen.getByRole("button", { name: "View details" })).not.toBeNull();
      expect(screen.queryByText("broken-skill")).toBeNull();
      expect(screen.queryByText(".claude/skills/broken-skill/")).toBeNull();
      expect(screen.queryByText("0 loaded")).toBeNull();
      expect(screen.getByText(/No skills are loaded yet/)).not.toBeNull();
      expect(screen.queryByText("No skills yet")).toBeNull();
    });

    it("opens hidden rejected skills and their folders with system apps for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
      mockRejectedSkills = [makeRejectedSkill()];
      await act(async () => {
        renderSettings();
      });

      fireEvent.click(screen.getByRole("button", { name: "View details" }));
      expect(mockOpenSkillLoadIssuesModal).toHaveBeenCalledTimes(1);
      expect(mockCapturedLoadIssues[0]).toMatchObject({
        location: ".claude/skills/broken-skill/SKILL.md",
        reason: 'The description contains ": " and must be quoted.',
        offendingText: "description: Use this skill for: reviewing notes",
      });
      mockCapturedLoadIssues[0].onOpen();
      mockCapturedLoadIssues[0].onReveal();

      expect(openVaultPath).toHaveBeenCalledWith(
        expect.anything(),
        "/vault/.claude/skills/broken-skill/SKILL.md"
      );
      expect(openWithSystemDefault).toHaveBeenCalledWith("/vault/.claude/skills/broken-skill");
    });

    it("opens review-before-send Agent drafts for one or all rejected skills for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
      mockRejectedSkills = [
        makeRejectedSkill(),
        makeRejectedSkill({
          filePath: "/vault/.codex/skills/second/SKILL.md",
          dirPath: "/vault/.codex/skills/second",
          reason: "Missing name.",
          offendingText: undefined,
        }),
      ];
      await act(async () => {
        renderSettings();
      });

      fireEvent.click(screen.getByRole("button", { name: "View details" }));
      mockCapturedLoadIssues[0].onFixWithAgent();
      mockCapturedFixAll();

      expect(mockCloseSettings).toHaveBeenCalledTimes(2);
      expect(mockNewAgentChatWithDraft).toHaveBeenCalledTimes(2);
      expect(mockNewAgentChatWithDraft.mock.calls[0][0]).toContain(
        'File: ".claude/skills/broken-skill/SKILL.md"'
      );
      expect(mockNewAgentChatWithDraft.mock.calls[0][0]).not.toContain("Change to");
      expect(mockNewAgentChatWithDraft.mock.calls[1][0]).toContain(
        'File: ".codex/skills/second/SKILL.md"'
      );
    });

    it("opens and reveals indexed rejected skills inside Obsidian for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
      const app = makeApp(true);
      mockRejectedSkills = [
        makeRejectedSkill({
          filePath: "/vault/copilot/skills/broken-skill/SKILL.md",
          dirPath: "/vault/copilot/skills/broken-skill",
        }),
      ];
      await act(async () => {
        renderSettings(app);
      });

      fireEvent.click(screen.getByRole("button", { name: "View details" }));
      mockCapturedLoadIssues[0].onOpen();
      mockCapturedLoadIssues[0].onReveal();

      expect(openVaultPath).toHaveBeenCalledWith(
        app,
        "/vault/copilot/skills/broken-skill/SKILL.md"
      );
      expect(
        (
          app as unknown as {
            internalPlugins: {
              getPluginById: () => { instance: { revealInFolder: jest.Mock } };
            };
          }
        ).internalPlugins.getPluginById().instance.revealInFolder
      ).toHaveBeenCalledTimes(1);
      expect(openWithSystemDefault).not.toHaveBeenCalled();
    });

    it("reveals vault-relative rejected skills inside Obsidian when no absolute vault path exists for https://github.com/Brevilabs/obsidian-copilot-private/issues/166", async () => {
      const app = makeApp(true);
      mockRejectedSkills = [
        makeRejectedSkill({
          filePath: "copilot/skills/broken-skill/SKILL.md",
          dirPath: "copilot/skills/broken-skill",
        }),
      ];
      await act(async () => {
        renderSettings(app);
      });

      fireEvent.click(screen.getByRole("button", { name: "View details" }));
      mockCapturedLoadIssues[0].onReveal();

      expect(
        (
          app as unknown as {
            internalPlugins: {
              getPluginById: () => { instance: { revealInFolder: jest.Mock } };
            };
          }
        ).internalPlugins.getPluginById().instance.revealInFolder
      ).toHaveBeenCalledTimes(1);
      expect(openWithSystemDefault).not.toHaveBeenCalled();
    });
  });
});

function makeApp(indexRejectedSkill = false): App {
  const file = new (TFile as unknown as new (path: string) => TFile)(
    "copilot/skills/broken-skill/SKILL.md"
  );
  const folder = new (TFolder as unknown as new (path: string) => TFolder)(
    "copilot/skills/broken-skill"
  );
  const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter)(
    "/vault"
  );
  const revealInFolder = jest.fn();
  return {
    vault: {
      adapter,
      getAbstractFileByPath: jest.fn((path: string) => {
        if (!indexRejectedSkill) return null;
        if (path.endsWith("/SKILL.md")) return file;
        if (path === "copilot/skills/broken-skill") return folder;
        return null;
      }),
    },
    workspace: {
      openLinkText: jest.fn(),
    },
    setting: {
      close: mockCloseSettings,
    },
    internalPlugins: {
      getPluginById: jest.fn(() => ({ enabled: true, instance: { revealInFolder } })),
    },
  } as unknown as App;
}

function makeRejectedSkill(overrides: Partial<RejectedSkill> = {}): RejectedSkill {
  return {
    name: "broken-skill",
    filePath: "/vault/.claude/skills/broken-skill/SKILL.md",
    dirPath: "/vault/.claude/skills/broken-skill",
    reason: 'The description contains ": " and must be quoted.',
    offendingText: "description: Use this skill for: reviewing notes",
    ...overrides,
  };
}
