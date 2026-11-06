import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { App } from "obsidian";
import type { RejectedSkill, SkillImportCandidate, SkillPackage } from "@/agentMode/skills/types";
import {
  BuiltinSkillRecovery,
  BuiltinSkillRecoveryView,
  LocalSkillImportView,
  SystemSkillSearch,
  SystemSkillSearchView,
  confirmSkillAction,
  confirmSkillPackage,
} from "@/agentMode/skills/ui/SkillImportDialogs";
const mockSearch = jest.fn();
const mockReadPackage = jest.fn();
const mockInstall = jest.fn();
const mockStatuses = jest.fn();
const mockRestore = jest.fn();
jest.mock(
  "electron",
  () => ({ webUtils: { getPathForFile: (file: File) => `/imports/${file.name}` } }),
  {
    virtual: true,
  }
);
let mockRejected: RejectedSkill[] = [];
function mockReadRejected() {
  return mockRejected;
}
let mockInstalled: Array<{ name: string; source: { kind: string; origin: string } }> = [];
let mockModal: { content: React.ReactElement; close: () => void };
jest.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    disabled,
    onCheckedChange,
    ...props
  }: {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange: (checked: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.target.checked)}
      {...props}
    />
  ),
}));
jest.mock("@/agentMode/skills/SkillManager", () => ({
  SkillManager: {
    getInstance: () => ({
      installPackage: mockInstall,
      getBuiltinStatuses: mockStatuses,
      restoreBuiltin: mockRestore,
    }),
  },
  getManagedSkills: () => mockInstalled,
  useRejectedSkills: mockReadRejected,
}));
jest.mock("@/agentMode/skills/systemSkillSearch", () => ({
  searchSystemSkills: (...args: unknown[]) => mockSearch(...args),
}));
jest.mock("@/agentMode/skills/skillImport", () => ({
  readSkillPackage: (...args: unknown[]) => mockReadPackage(...args),
}));
jest.mock("@/agentMode/skills/ui/SkillModal", () => ({
  SkillModal: class {
    content: React.ReactElement;
    constructor(
      _app: unknown,
      _title: string,
      content: (close: () => void) => React.ReactElement,
      private onClosed: () => void
    ) {
      this.content = content(() => this.close());
      mockModal = { content: this.content, close: () => this.close() };
    }
    open() {}
    close() {
      this.onClosed();
    }
  },
}));
const app = {} as App;
const candidate = (
  id: string,
  status: SkillImportCandidate["status"] = "available"
): SkillImportCandidate => ({
  id,
  path: `/external/${id}`,
  name: id,
  description: `Instructions for ${id}`,
  sources: ["Agent Skills", "Codex"],
  status,
});
const pkg: SkillPackage = {
  name: "review-notes",
  source: {
    kind: "system",
    origin: "/external/review-notes",
    displayPath: "/external/review-notes",
  },
  files: [
    {
      path: "SKILL.md",
      data: new TextEncoder().encode(
        "---\nname: review-notes\ndescription: Review notes\n---\nRead the full note"
      ),
    },
  ],
};
describe("SkillImportDialogs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInstalled = [];
    mockRejected = [];
    mockSearch.mockResolvedValue({ candidates: [], warnings: [] });
    mockReadPackage.mockResolvedValue(pkg);
    mockInstall.mockResolvedValue({ ok: true });
    mockStatuses.mockResolvedValue([]);
    mockRestore.mockResolvedValue({ ok: true });
  });
  describe("LocalSkillImportView()", () => {
    const zoneLabel = "Drop a skill folder or a ZIP archive here, or click to choose a ZIP";
    const dropPayload = (name: string): { dataTransfer: unknown } => ({
      dataTransfer: {
        items: [{ kind: "file", getAsFile: () => new File(["skill"], name) }],
        files: [new File(["skill"], name)],
      },
    });
    it("imports a dropped folder or ZIP through the shared local import path (https://github.com/ItsDalk-Lane/Scribe/issues/33)", () => {
      const onImportPath = jest.fn();
      render(
        <LocalSkillImportView
          onImportPath={onImportPath}
          onPickFolder={jest.fn()}
          onPickZip={jest.fn()}
          onPickMarkdown={jest.fn()}
        />
      );
      fireEvent.drop(screen.getByRole("button", { name: zoneLabel }), dropPayload("review-notes"));
      expect(onImportPath).toHaveBeenCalledWith(expect.stringContaining("review-notes"));
    });
    it("reports an undroppable payload inline without invoking the import callback (https://github.com/ItsDalk-Lane/Scribe/issues/33)", () => {
      const onImportPath = jest.fn();
      render(
        <LocalSkillImportView
          onImportPath={onImportPath}
          onPickFolder={jest.fn()}
          onPickZip={jest.fn()}
          onPickMarkdown={jest.fn()}
        />
      );
      fireEvent.drop(screen.getByRole("button", { name: zoneLabel }), {
        dataTransfer: { items: [], files: [] },
      });
      expect(screen.getByRole("alert").textContent).toBeTruthy();
      expect(onImportPath).not.toHaveBeenCalled();
    });
    it("highlights the zone only while a drag hovers over it (https://github.com/ItsDalk-Lane/Scribe/issues/33)", () => {
      render(
        <LocalSkillImportView
          onImportPath={jest.fn()}
          onPickFolder={jest.fn()}
          onPickZip={jest.fn()}
          onPickMarkdown={jest.fn()}
        />
      );
      const zone = screen.getByRole("button", { name: zoneLabel });
      const zoneClasses = () => zone.className.split(" ");
      expect(zoneClasses()).not.toContain("tw-border-interactive-accent");
      fireEvent.dragOver(zone, dropPayload("review-notes"));
      expect(zoneClasses()).toContain("tw-border-interactive-accent");
      fireEvent.dragLeave(zone);
      expect(zoneClasses()).not.toContain("tw-border-interactive-accent");
    });
    it("keeps the folder and ZIP picker buttons and lets clicking the zone choose a ZIP (https://github.com/ItsDalk-Lane/Scribe/issues/33)", () => {
      const onPickFolder = jest.fn();
      const onPickZip = jest.fn();
      const onPickMarkdown = jest.fn();
      render(
        <LocalSkillImportView
          onImportPath={jest.fn()}
          onPickFolder={onPickFolder}
          onPickZip={onPickZip}
          onPickMarkdown={onPickMarkdown}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Import folder" }));
      expect(onPickFolder).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Import ZIP archive" }));
      expect(onPickZip).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: zoneLabel }));
      expect(onPickZip).toHaveBeenCalledTimes(2);
    });
  });
  describe("confirmSkillAction()", () => {
    it("resolves true only when the user selects the named confirmation", async () => {
      const result = confirmSkillAction(app, {
        title: "Confirm",
        content: "Review first",
        confirmText: "Continue",
      });
      render(mockModal.content);
      expect(screen.getByText("Review first")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await expect(result).resolves.toBe(true);
    });
    it("resolves false on cancellation or an already aborted request", async () => {
      const controller = new AbortController();
      const result = confirmSkillAction(app, {
        title: "Confirm",
        content: "Review first",
        confirmText: "Continue",
        signal: controller.signal,
      });
      act(() => controller.abort());
      await expect(result).resolves.toBe(false);
      await expect(
        confirmSkillAction(app, {
          title: "Confirm",
          content: "Review",
          confirmText: "Continue",
          signal: controller.signal,
        })
      ).resolves.toBe(false);
    });
  });
  describe("confirmSkillPackage()", () => {
    it("previews the retained library name for a same-source skill renamed after import", async () => {
      mockInstalled = [
        { name: "renamed-review", source: { kind: "system", origin: pkg.source.origin! } },
      ];
      const result = confirmSkillPackage(app, pkg);
      render(mockModal.content);
      expect(screen.getByText("Install as renamed-review")).toBeTruthy();
      expect(screen.queryByText("Install as review-notes")).toBeNull();
      expect(screen.getByText("/external/review-notes")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await expect(result).resolves.toBe(false);
    });
    it("previews the final name, description and source before installation", async () => {
      const result = confirmSkillPackage(app, pkg);
      render(mockModal.content);
      expect(screen.getByText("Install as review-notes")).toBeTruthy();
      expect(screen.getByText("Review notes")).toBeTruthy();
      expect(screen.getByText("/external/review-notes")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Import" }));
      await expect(result).resolves.toBe(true);
      expect(mockInstall).not.toHaveBeenCalled();
    });
    it("recognizes a damaged same-source copy as an update and explains its disabled recovery state", async () => {
      const rejected: RejectedSkill = {
        name: "review-notes",
        filePath: "/vault/.scribe/skills/review-notes/SKILL.md",
        dirPath: "/vault/.scribe/skills/review-notes",
        source: pkg.source,
        reason: "Missing description",
      };
      const result = confirmSkillPackage(app, pkg, undefined, [rejected]);
      render(mockModal.content);
      expect(screen.getByText(/updated copy stays disabled/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Update and replace" }));
      await expect(result).resolves.toBe(true);
    });
    it("warns that reimporting a matching source replaces local edits", async () => {
      mockInstalled = [
        { name: "review-notes", source: { kind: "system", origin: pkg.source.origin! } },
      ];
      const result = confirmSkillPackage(app, pkg);
      render(mockModal.content);
      expect(screen.getByText(/including your local edits/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await expect(result).resolves.toBe(false);
    });
    it("shows the staged repair diff and resolves false when the user cancels https://github.com/ItsDalk-Lane/Scribe/issues/44", async () => {
      const result = confirmSkillPackage(app, {
        ...pkg,
        repair: [
          {
            before: "description: Use ffmpeg: converts media",
            after: 'description: "Use ffmpeg: converts media"',
          },
        ],
      });
      render(mockModal.content);
      expect(screen.getByText(/adjusted 1 lines/)).toBeTruthy();
      expect(screen.getByText("- description: Use ffmpeg: converts media")).toBeTruthy();
      expect(screen.getByText('+ description: "Use ffmpeg: converts media"')).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await expect(result).resolves.toBe(false);
    });
  });
  describe("SystemSkillSearchView()", () => {
    it("disables malformed and conflicting candidates while reporting each reason", () => {
      render(
        <SystemSkillSearchView
          candidates={[
            { ...candidate("bad"), error: "Missing description" },
            candidate("conflict", "conflict"),
          ]}
          warnings={[]}
          selected={new Set()}
          results={{}}
          loading={false}
          busy={false}
          onRefresh={jest.fn()}
          onImport={jest.fn()}
          onSelect={jest.fn()}
        />
      );
      expect(screen.getByRole("checkbox", { name: "Select bad" }).hasAttribute("disabled")).toBe(
        true
      );
      expect(
        screen.getByRole("checkbox", { name: "Select conflict" }).hasAttribute("disabled")
      ).toBe(true);
      expect(screen.getByRole("alert").textContent).toBe("Missing description");
    });
    it("marks a repairable candidate as importable with its adjustment note https://github.com/ItsDalk-Lane/Scribe/issues/44", () => {
      render(
        <SystemSkillSearchView
          candidates={[
            {
              ...candidate("fixable"),
              repair: [{ before: "user-invocable: yes", after: "user-invocable: true" }],
            },
          ]}
          warnings={[]}
          selected={new Set()}
          results={{}}
          loading={false}
          busy={false}
          onRefresh={jest.fn()}
          onImport={jest.fn()}
          onSelect={jest.fn()}
        />
      );
      expect(
        screen.getByRole("checkbox", { name: "Select fixable" }).hasAttribute("disabled")
      ).toBe(false);
      expect(screen.getByText(/1 lines will be adjusted automatically/)).toBeTruthy();
    });

    // 扫描不完整时结果页出现明确标记与原因摘要。https://github.com/ItsDalk-Lane/Scribe/issues/49
    it("announces an incomplete scan with its failure summaries and retry guidance", () => {
      render(
        <SystemSkillSearchView
          candidates={[candidate("readable")]}
          warnings={[]}
          incomplete
          failures={[{ root: "Cursor", reason: "EACCES: permission denied" }]}
          selected={new Set()}
          results={{}}
          loading={false}
          busy={false}
          onRefresh={jest.fn()}
          onImport={jest.fn()}
          onSelect={jest.fn()}
        />
      );
      expect(screen.getByText(/This scan is incomplete/)).toBeTruthy();
      expect(screen.getByText("Cursor: EACCES: permission denied")).toBeTruthy();
    });

    it("does not show an incompleteness banner for a complete scan", () => {
      render(
        <SystemSkillSearchView
          candidates={[candidate("readable")]}
          warnings={[]}
          selected={new Set()}
          results={{}}
          loading={false}
          busy={false}
          onRefresh={jest.fn()}
          onImport={jest.fn()}
          onSelect={jest.fn()}
        />
      );
      expect(screen.queryByText(/This scan is incomplete/)).toBeNull();
    });
  });
  describe("SystemSkillSearch()", () => {
    it("imports selected valid candidates independently and reports partial failure", async () => {
      mockSearch.mockResolvedValue({
        candidates: [candidate("review-notes"), candidate("weekly-review")],
        warnings: [],
      });
      mockReadPackage.mockResolvedValueOnce(pkg).mockRejectedValueOnce(new Error("Source changed"));
      await act(async () => {
        render(<SystemSkillSearch app={app} skillsDirectory="/vault/.scribe/skills" />);
      });
      fireEvent.click(screen.getByRole("checkbox", { name: "Select review-notes" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Select weekly-review" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
      });
      expect(screen.getByText("Imported")).toBeTruthy();
      expect(screen.getByText("Could not import skill: Source changed")).toBeTruthy();
      expect(mockInstall).toHaveBeenCalledTimes(1);
      expect(mockInstall).toHaveBeenCalledWith(pkg, false, expect.anything());
    });
    it("requires explicit update confirmation before replacing an imported candidate", async () => {
      mockInstalled = [
        { name: "review-notes", source: { kind: "system", origin: pkg.source.origin! } },
      ];
      mockSearch.mockResolvedValue({
        candidates: [candidate("review-notes", "installed")],
        warnings: [],
      });
      await act(async () => {
        render(<SystemSkillSearch app={app} skillsDirectory="/vault/.scribe/skills" />);
      });
      fireEvent.click(screen.getByRole("button", { name: "Reimport" }));
      await waitFor(() => expect(mockReadPackage).toHaveBeenCalledTimes(1));
      render(mockModal.content);
      expect(mockInstall).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Update and replace" }));
      });
      expect(mockInstall).toHaveBeenCalledWith(pkg, true, expect.anything());
    });
    it("includes damaged source records in system discovery and confirms their replacement", async () => {
      mockRejected = [
        {
          name: "review-notes",
          filePath: "/vault/.scribe/skills/review-notes/SKILL.md",
          dirPath: "/vault/.scribe/skills/review-notes",
          source: pkg.source,
          reason: "Invalid metadata",
        },
      ];
      mockSearch.mockResolvedValue({
        candidates: [candidate("review-notes", "installed")],
        warnings: [],
      });
      await act(async () => {
        render(<SystemSkillSearch app={app} skillsDirectory="/vault/.scribe/skills" />);
      });
      expect(mockSearch.mock.calls[0][0].installed).toEqual(mockRejected);
      fireEvent.click(screen.getByRole("button", { name: "Reimport" }));
      await waitFor(() => expect(mockReadPackage).toHaveBeenCalledTimes(1));
      render(mockModal.content);
      expect(screen.getByText(/updated copy stays disabled/)).toBeTruthy();
      expect(mockInstall).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Update and replace" }));
      });
      expect(mockInstall).toHaveBeenCalledWith(pkg, true, expect.anything());
    });
    it("aborts a pending scan when its dialog is closed", async () => {
      let finish!: (value: { candidates: SkillImportCandidate[]; warnings: string[] }) => void;
      const gate = new Promise<{ candidates: SkillImportCandidate[]; warnings: string[] }>(
        (resolve) => {
          finish = resolve;
        }
      );
      mockSearch.mockReturnValue(gate);
      const view = render(<SystemSkillSearch app={app} skillsDirectory="/vault/.scribe/skills" />);
      const signal = mockSearch.mock.calls[0][0].signal as AbortSignal;
      view.unmount();
      expect(signal.aborted).toBe(true);
      await act(async () => {
        finish({ candidates: [], warnings: [] });
        await gate;
      });
    });
  });
  describe("BuiltinSkillRecoveryView()", () => {
    it("offers recovery for removed and modified builtins but prevents overwriting a personal collision", () => {
      const onRestore = jest.fn();
      render(
        <BuiltinSkillRecoveryView
          statuses={[
            { name: "removed", status: "uninstalled" },
            { name: "edited", status: "modified" },
            { name: "collision", status: "conflict" },
          ]}
          results={{}}
          loading={false}
          busy={false}
          onRestore={onRestore}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Restore all" }));
      expect(onRestore).toHaveBeenCalledWith(["removed", "edited"]);
      expect(
        screen
          .getAllByRole("button", { name: "Restore" })
          .filter((button) => button.hasAttribute("disabled"))
      ).toHaveLength(1);
    });
  });
  describe("BuiltinSkillRecovery()", () => {
    it("restores an uninstalled builtin and refreshes the list", async () => {
      const onChanged = jest.fn();
      mockStatuses.mockResolvedValue([{ name: "removed", status: "uninstalled" }]);
      await act(async () => {
        render(<BuiltinSkillRecovery app={app} onChanged={onChanged} />);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Restore" }));
      });
      expect(mockRestore).toHaveBeenCalledWith("removed");
      expect(screen.getByText("Restored")).toBeTruthy();
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    it("keeps externally modified builtin files when reset confirmation is cancelled", async () => {
      mockStatuses.mockResolvedValue([{ name: "edited", status: "modified" }]);
      await act(async () => {
        render(<BuiltinSkillRecovery app={app} />);
      });
      fireEvent.click(screen.getByRole("button", { name: "Reset" }));
      render(mockModal.content);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      });
      expect(mockRestore).not.toHaveBeenCalled();
      expect(screen.getByText("Modified outside Scribe")).toBeTruthy();
    });
  });
});
