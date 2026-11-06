/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 测试替身必须保留真实 Hook 导出名称。 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Notice } from "obsidian";
import { SkillsSettings } from "@/agentMode/skills/ui/SkillsSettings";
import type { Skill, RejectedSkill, SkillPackage } from "@/agentMode/skills/types";

const mockRefresh = jest.fn();
const mockHasInstance = jest.fn();
const mockGetInstance = jest.fn();
const mockToggle = jest.fn();
const mockDelete = jest.fn();
const mockStatus = jest.fn();
const mockCreateChat = jest.fn();
const mockAuthor = jest.fn();
const mockClose = jest.fn();
const mockOpenDetails = jest.fn();
const mockConfirm = jest.fn();
const mockModal = jest.fn();
const mockPick = jest.fn();
const mockReadPackage = jest.fn();
const mockConfirmPackage = jest.fn();
const mockInstall = jest.fn();
let mockSkills: Skill[] = [];
let mockRejected: RejectedSkill[] = [];
const mockApp = { setting: { close: mockClose } };
jest.mock("@/context", () => ({ useApp: () => mockApp }));
jest.mock("@/contexts/PluginContext", () => ({
  usePlugin: () => ({ newAgentChatWithDraft: mockCreateChat, newSkillAuthoringChat: mockAuthor }),
}));
jest.mock("@/agentMode/skills/SkillManager", () => ({
  SkillManager: {
    hasInstance: () => mockHasInstance(),
    getInstance: () => {
      mockGetInstance();
      return {
        refresh: mockRefresh,
        toggleAgent: mockToggle,
        deleteSkill: mockDelete,
        getBuiltinStatuses: mockStatus,
        installPackage: mockInstall,
      };
    },
  },
  useManagedSkills: () => mockSkills,
  getManagedSkills: () => mockSkills,
  useRejectedSkills: () => mockRejected,
}));
jest.mock("@/agentMode/skills/pickSkillImport", () => ({
  pickSkillImport: (...args: unknown[]) => mockPick(...args),
}));
jest.mock("@/agentMode/skills/skillImport", () => ({
  readSkillPackage: (...args: unknown[]) => mockReadPackage(...args),
}));
jest.mock("@/agentMode/skills/ui/SkillDetails", () => ({
  clearSkillEditorDraft: jest.fn(),
  SkillDetails: (props: { onBack: () => void; onRepair: () => void }) => {
    mockOpenDetails(props);
    return (
      <div>
        <button type="button" onClick={props.onBack}>
          Back to skills
        </button>
        <button type="button" onClick={props.onRepair}>
          Ask Agent to repair
        </button>
      </div>
    );
  },
}));
jest.mock("@/agentMode/skills/ui/SkillImportDialogs", () => ({
  confirmSkillAction: (...args: unknown[]) => mockConfirm(...args),
  confirmSkillPackage: (...args: unknown[]) => mockConfirmPackage(...args),
  LocalSkillImportView: (props: {
    onImportPath: (path: string) => void;
    onPickFolder: () => void;
    onPickZip: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => props.onImportPath("/downloads/dropped.zip")}>
        Simulate drop
      </button>
      <button type="button" onClick={props.onPickFolder}>
        Import folder
      </button>
      <button type="button" onClick={props.onPickZip}>
        Import ZIP archive
      </button>
    </div>
  ),
  SystemSkillSearch: () => <p>System search panel</p>,
  BuiltinSkillRecovery: () => <p>Recovery panel</p>,
}));
jest.mock("@/agentMode/skills/ui/SkillModal", () => ({
  SkillModal: class {
    constructor(_app: unknown, title: string, content: (close: () => void) => React.ReactElement) {
      mockModal(title, content(jest.fn()));
    }
    open() {}
  },
}));
jest.mock("@/utils/vaultPath", () => ({
  getVaultBase: () => "/vault",
  toVaultRelative: (path: string) => path.replace("/vault/", ""),
}));
const makeSkill = (overrides: Partial<Skill> = {}): Skill => ({
  name: "review-notes",
  description: "Review notes",
  body: "Read",
  filePath: "/vault/.scribe/skills/review-notes/SKILL.md",
  dirPath: "/vault/.scribe/skills/review-notes",
  enabledAgents: ["native"],
  location: { kind: "canonical" },
  ...overrides,
});
const makeSkillCreator = (overrides: Partial<Skill> = {}): Skill =>
  makeSkill({
    name: "skill-creator",
    description: "Create new skills",
    filePath: "/vault/.scribe/skills/skill-creator/SKILL.md",
    dirPath: "/vault/.scribe/skills/skill-creator",
    source: { kind: "builtin" },
    ...overrides,
  });
function openMenu(label: string) {
  fireEvent.pointerDown(screen.getByRole("button", { name: label }), { button: 0, ctrlKey: false });
}
function nearestCommonAncestor(a: Element, b: Element): Element {
  const ancestors = new Set<Element>();
  for (let node: Element | null = a; node; node = node.parentElement) ancestors.add(node);
  let node: Element | null = b;
  while (node && !ancestors.has(node)) node = node.parentElement;
  return node as Element;
}
describe("SkillsSettings", () => {
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = document;
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });
  describe("SkillsSettings()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockHasInstance.mockReturnValue(true);
      mockSkills = [];
      mockRejected = [];
      mockRefresh.mockResolvedValue({ ok: true });
      mockToggle.mockResolvedValue({ ok: true });
      mockDelete.mockResolvedValue({ ok: true });
      mockStatus.mockResolvedValue([]);
      mockCreateChat.mockResolvedValue(undefined);
      mockAuthor.mockResolvedValue(undefined);
      mockConfirm.mockResolvedValue(true);
      mockConfirmPackage.mockResolvedValue(true);
      mockInstall.mockResolvedValue({ ok: true });
    });
    it("skips focus refresh during the plugin unload gap and resumes with one captured manager after initialization", async () => {
      await act(async () => {
        render(<SkillsSettings />);
      });
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      mockHasInstance.mockReturnValue(false);
      await act(async () => {
        fireEvent.focus(window);
      });
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockGetInstance).toHaveBeenCalledTimes(1);
      mockHasInstance.mockReturnValue(true);
      await act(async () => {
        fireEvent.focus(window);
      });
      expect(mockRefresh).toHaveBeenCalledTimes(2);
      expect(mockGetInstance).toHaveBeenCalledTimes(2);
    });
    it("offers exactly Agent creation, system search, and local import without a blank creation entry", async () => {
      mockSkills = [makeSkillCreator()];
      await act(async () => {
        render(<SkillsSettings />);
      });
      openMenu("Add skill");
      expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
        "Create with Agent",
        "System search",
        "Local import",
      ]);
      expect(screen.queryByRole("button", { name: "New skill" })).toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: "Create with Agent" }));
      });
      expect(mockAuthor).toHaveBeenCalledTimes(1);
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
    it("merges restore and add actions into the search header row without a manual refresh button (https://github.com/ItsDalk-Lane/Scribe/issues/36)", async () => {
      await act(async () => {
        render(<SkillsSettings />);
      });
      expect(screen.queryByRole("button", { name: "Refresh and check" })).toBeNull();
      const search = screen.getByPlaceholderText("Search skills…");
      const headerRow = nearestCommonAncestor(search, screen.getByText(/^Skills/));
      const add = screen.getByRole("button", { name: "Add skill" });
      const restore = screen.getByRole("button", { name: "Restore built-in skills" });
      expect(nearestCommonAncestor(search, add)).toBe(headerRow);
      expect(nearestCommonAncestor(search, restore)).toBe(headerRow);
    });
    it("keeps existing unmarked skills local and opens the new detail view", async () => {
      mockSkills = [makeSkill()];
      await act(async () => {
        render(<SkillsSettings />);
      });
      expect(screen.getByText("Local")).toBeTruthy();
      fireEvent.click(screen.getByText("review-notes"));
      expect(mockOpenDetails).toHaveBeenCalledWith(
        expect.objectContaining({ skill: mockSkills[0] })
      );
      expect(screen.queryByRole("button", { name: "Add skill" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      expect(screen.getByRole("button", { name: "Add skill" })).toBeTruthy();
    });
    it("uses the renamed record even for action callbacks captured before the rename completed", async () => {
      mockSkills = [makeSkill()];
      await act(async () => {
        render(<SkillsSettings />);
      });
      fireEvent.click(screen.getByText("review-notes"));
      const renamed = makeSkill({
        name: "renamed-review",
        filePath: "/vault/.scribe/skills/renamed-review/SKILL.md",
        dirPath: "/vault/.scribe/skills/renamed-review",
      });
      mockSkills = [renamed];
      await act(async () => {
        mockOpenDetails.mock.calls.at(-1)[0].onSkillChanged(renamed);
      });
      const details = mockOpenDetails.mock.calls[0][0];
      await act(async () => {
        details.onUse();
      });
      expect(mockCreateChat).toHaveBeenCalledWith("/renamed-review ");
      await act(async () => {
        details.onToggle(false);
      });
      expect(mockToggle).toHaveBeenCalledWith(renamed, "native", false);
      await act(async () => {
        details.onUninstall();
      });
      expect(mockDelete).toHaveBeenCalledWith(renamed);
    });
    it.each(["use", "toggle", "uninstall"] as const)(
      "targets the requested list skill for %s after returning from another skill's details",
      async (action) => {
        const first = makeSkill();
        const second = makeSkill({
          name: "other-skill",
          filePath: "/vault/.scribe/skills/other-skill/SKILL.md",
          dirPath: "/vault/.scribe/skills/other-skill",
        });
        mockSkills = [first, second];
        await act(async () => {
          render(<SkillsSettings />);
        });
        fireEvent.click(screen.getByText("review-notes"));
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
        if (action === "uninstall") openMenu("More actions for other-skill");
        await act(async () => {
          if (action === "use")
            fireEvent.click(screen.getByRole("button", { name: "Use other-skill now" }));
          else if (action === "toggle")
            fireEvent.click(screen.getByRole("switch", { name: "Enable other-skill" }));
          else fireEvent.click(screen.getByRole("menuitem", { name: "Uninstall" }));
        });
        if (action === "use") expect(mockCreateChat).toHaveBeenCalledWith("/other-skill ");
        if (action === "toggle") expect(mockToggle).toHaveBeenCalledWith(second, "native", false);
        if (action === "uninstall") expect(mockDelete).toHaveBeenCalledWith(second);
      }
    );
    it("shows malformed skills as rows and prepares an unsent repair draft from their details", async () => {
      mockRejected = [
        {
          name: "broken",
          filePath: "/vault/.scribe/skills/broken/SKILL.md",
          dirPath: "/vault/.scribe/skills/broken",
          reason: "Missing name",
        },
      ];
      await act(async () => {
        render(<SkillsSettings />);
      });
      fireEvent.click(screen.getByText("broken"));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Ask Agent to repair" }));
      });
      expect(mockCreateChat).toHaveBeenCalledWith(
        expect.stringContaining(".scribe/skills/broken/SKILL.md")
      );
      expect(mockCreateChat).toHaveBeenCalledWith(expect.stringContaining("Missing name"));
    });
    it.each(["authoring", "use", "repair"] as const)(
      "keeps the settings window alive until %s chat initialization completes",
      async (entry) => {
        let finish!: () => void;
        const gate = new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (entry === "authoring") mockAuthor.mockReturnValue(gate);
        else mockCreateChat.mockReturnValue(gate);
        if (entry === "repair")
          mockRejected = [
            {
              name: "broken",
              filePath: "/vault/.scribe/skills/broken/SKILL.md",
              dirPath: "/vault/.scribe/skills/broken",
              reason: "Missing name",
            },
          ];
        else if (entry === "authoring") mockSkills = [makeSkillCreator()];
        else mockSkills = [makeSkill()];
        await act(async () => {
          render(<SkillsSettings />);
        });
        if (entry === "authoring") {
          openMenu("Add skill");
          fireEvent.click(screen.getByRole("menuitem", { name: "Create with Agent" }));
        } else if (entry === "use")
          fireEvent.click(screen.getByRole("button", { name: "Use review-notes now" }));
        else {
          fireEvent.click(screen.getByText("broken"));
          fireEvent.click(screen.getByRole("button", { name: "Ask Agent to repair" }));
        }
        expect(mockClose).not.toHaveBeenCalled();
        await act(async () => {
          finish();
          await gate;
        });
        expect(mockClose).toHaveBeenCalledTimes(1);
      }
    );
    it("opens a skill reference without sending a task automatically", async () => {
      mockSkills = [makeSkill()];
      await act(async () => {
        render(<SkillsSettings />);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Use review-notes now" }));
      });
      expect(mockCreateChat).toHaveBeenCalledWith("/review-notes ");
      expect(mockToggle).not.toHaveBeenCalled();
    });
    it("asks before enabling a disabled skill for immediate use", async () => {
      mockSkills = [makeSkill({ enabledAgents: [] })];
      await act(async () => {
        render(<SkillsSettings />);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Use review-notes now" }));
      });
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(mockToggle).toHaveBeenCalledWith(mockSkills[0], "native", true);
      expect(mockCreateChat).toHaveBeenCalledWith("/review-notes ");
    });
    it("leaves a disabled skill unchanged when enablement is declined", async () => {
      mockConfirm.mockResolvedValue(false);
      mockSkills = [makeSkill({ enabledAgents: [] })];
      await act(async () => {
        render(<SkillsSettings />);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Use review-notes now" }));
      });
      expect(mockToggle).not.toHaveBeenCalled();
      expect(mockCreateChat).not.toHaveBeenCalled();
    });
    it("asks before enabling a disabled skill-creator for Agent skill creation (https://github.com/ItsDalk-Lane/Scribe/issues/34)", async () => {
      mockSkills = [makeSkillCreator({ enabledAgents: [] })];
      await act(async () => {
        render(<SkillsSettings />);
      });
      openMenu("Add skill");
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: "Create with Agent" }));
      });
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(mockToggle).toHaveBeenCalledWith(mockSkills[0], "native", true);
      expect(mockAuthor).toHaveBeenCalledTimes(1);
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
    it("keeps the skills page when skill-creator enablement for Agent skill creation is declined (https://github.com/ItsDalk-Lane/Scribe/issues/34)", async () => {
      mockConfirm.mockResolvedValue(false);
      mockSkills = [makeSkillCreator({ enabledAgents: [] })];
      await act(async () => {
        render(<SkillsSettings />);
      });
      openMenu("Add skill");
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: "Create with Agent" }));
      });
      expect(mockToggle).not.toHaveBeenCalled();
      expect(mockAuthor).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
    });
    it("points to restoring built-in skills when skill-creator is missing instead of opening a chat (https://github.com/ItsDalk-Lane/Scribe/issues/34)", async () => {
      await act(async () => {
        render(<SkillsSettings />);
      });
      openMenu("Add skill");
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: "Create with Agent" }));
      });
      expect(Notice).toHaveBeenCalledWith(expect.stringContaining("Restore built-in skills"));
      expect(mockAuthor).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
    });
    it("confirms builtin uninstallation with recovery information and deletes only after confirmation", async () => {
      mockSkills = [makeSkill({ source: { kind: "builtin" } })];
      await act(async () => {
        render(<SkillsSettings />);
      });
      openMenu("More actions for review-notes");
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: "Uninstall" }));
      });
      expect(mockConfirm.mock.calls[0][1].content).toContain("Restore built-in skills");
      expect(mockDelete).toHaveBeenCalledWith(mockSkills[0]);
    });
    it("updates a damaged local import from the same source after explicit confirmation", async () => {
      const pkg: SkillPackage = {
        name: "review-notes",
        source: { kind: "local", origin: "/downloads/review.zip" },
        files: [],
      };
      mockRejected = [
        {
          name: pkg.name,
          filePath: "/vault/.scribe/skills/review-notes/SKILL.md",
          dirPath: "/vault/.scribe/skills/review-notes",
          reason: "Invalid metadata",
          source: pkg.source,
        },
      ];
      mockPick.mockResolvedValue(pkg.source.origin);
      mockReadPackage.mockResolvedValue(pkg);
      await act(async () => {
        render(<SkillsSettings />);
      });
      openMenu("Add skill");
      fireEvent.click(screen.getByRole("menuitem", { name: "Local import" }));
      render(mockModal.mock.calls[0][1]);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Import ZIP archive" }));
      });
      expect(mockConfirmPackage).toHaveBeenCalledWith(
        mockApp,
        pkg,
        expect.anything(),
        mockRejected
      );
      expect(mockInstall).toHaveBeenCalledWith(pkg, true, expect.anything());
    });
    it("imports a dropped local path through the same confirm-and-install pipeline without opening a picker (https://github.com/ItsDalk-Lane/Scribe/issues/33)", async () => {
      const pkg: SkillPackage = {
        name: "review-notes",
        source: { kind: "local", origin: "/downloads/dropped.zip" },
        files: [],
      };
      mockReadPackage.mockResolvedValue(pkg);
      await act(async () => {
        render(<SkillsSettings />);
      });
      openMenu("Add skill");
      fireEvent.click(screen.getByRole("menuitem", { name: "Local import" }));
      render(mockModal.mock.calls[0][1]);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Simulate drop" }));
      });
      expect(mockPick).not.toHaveBeenCalled();
      expect(mockReadPackage).toHaveBeenCalledWith(
        "/downloads/dropped.zip",
        "local",
        expect.anything()
      );
      expect(mockInstall).toHaveBeenCalledWith(pkg, false, expect.anything());
    });
    it("filters the one skill list and refreshes external edits when focus returns", async () => {
      mockSkills = [
        makeSkill(),
        makeSkill({ name: "translate", description: "Translate", dirPath: "other" }),
      ];
      await act(async () => {
        render(<SkillsSettings query="review" />);
      });
      expect(screen.queryByText("translate")).toBeNull();
      await act(async () => {
        fireEvent.focus(window);
      });
      expect(mockRefresh).toHaveBeenCalledTimes(2);
    });
    it("reports refresh failures with context and offers recovery for modified builtins", async () => {
      mockRefresh.mockResolvedValue({ ok: false, discoveryError: "Permission denied" });
      mockStatus.mockResolvedValue([{ name: "skill-creator", status: "modified" }]);
      await act(async () => {
        render(<SkillsSettings />);
      });
      expect(screen.getByRole("alert").textContent).toContain("Could not refresh skills");
      expect(screen.getByText(/Some built-in skills need attention/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Restore built-in skills" }));
      expect(mockModal.mock.calls[0][0]).toBe("Restore built-in skills");
    });
  });
});
