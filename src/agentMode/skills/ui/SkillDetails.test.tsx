/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 测试替身保留真实 Hook 导出名。 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Skill } from "@/agentMode/skills/types";
import {
  SkillDetails,
  SkillDetailsView,
  clearSkillEditorDraft,
} from "@/agentMode/skills/ui/SkillDetails";

let mockManaged: Skill[] = [];
const mockReadContent = jest.fn();
const mockListFiles = jest.fn();
const mockReadFile = jest.fn();
const mockSaveFile = jest.fn();
const mockSaveSkill = jest.fn();
const skill: Skill = {
  name: "review-notes",
  description: "Review notes",
  body: "Full instructions",
  filePath: "/vault/.scribe/skills/review-notes/SKILL.md",
  dirPath: "/vault/.scribe/skills/review-notes",
  enabledAgents: ["native"],
  location: { kind: "canonical" },
  author: "Alice",
  version: "2",
  tags: ["notes"],
};
const content =
  '---\nname: review-notes\ndescription: Review notes\nauthor: Alice\nversion: "2"\nfuture-number: 9007199254740993123456789\n---\nFull instructions';
jest.mock("@/components/Markdown", () => ({
  Markdown: ({ text }: { text: string }) => <div>{text}</div>,
}));
jest.mock("@/agentMode/skills/SkillManager", () => ({
  SkillManager: {
    getInstance: () => ({
      readContent: mockReadContent,
      listSkillFiles: mockListFiles,
      readSkillFile: mockReadFile,
      saveSkillFile: mockSaveFile,
      saveSkill: mockSaveSkill,
    }),
  },
  useManagedSkills: () => mockManaged,
  getManagedSkills: () => mockManaged,
}));
const props = () => ({
  skill,
  content,
  onBack: jest.fn(),
  onUse: jest.fn(),
  onToggle: jest.fn(),
  onUninstall: jest.fn(),
  onSave: jest.fn().mockResolvedValue(undefined),
  onRepair: jest.fn(),
});

describe("SkillDetails", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSkillEditorDraft(skill.dirPath);
    clearSkillEditorDraft("/vault/.scribe/skills/renamed-review");
    mockManaged = [];
    mockReadContent.mockResolvedValue(content);
    mockListFiles.mockResolvedValue(["SKILL.md", "references/guide.md"]);
    mockSaveSkill.mockResolvedValue({ ok: true });
    mockSaveFile.mockResolvedValue({ ok: true });
  });
  describe("SkillDetailsView()", () => {
    it("automatically saves the complete draft after the editing pause without Save or Cancel controls", async () => {
      jest.useFakeTimers();
      try {
        const input = props();
        render(<SkillDetailsView {...input} />);
        fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
        expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
        const next = content.replace("Full instructions", "Automatically saved instructions");
        fireEvent.change(screen.getByLabelText("File contents"), { target: { value: next } });
        expect(input.onSave).not.toHaveBeenCalled();
        await act(async () => {
          await jest.advanceTimersByTimeAsync(600);
        });
        expect(input.onSave).toHaveBeenCalledWith(next, skill.name, content);
        expect(screen.getByText("Saved")).toBeTruthy();
      } finally {
        jest.useRealTimers();
      }
    });
    it("flushes the latest draft before reading another file and does not switch on a conflict", async () => {
      const input = props();
      input.onSave.mockResolvedValue("The file changed outside Scribe");
      const onReadFile = jest.fn().mockResolvedValue("Supporting text");
      render(
        <SkillDetailsView {...input} files={["SKILL.md", "guide.md"]} onReadFile={onReadFile} />
      );
      fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
      const next = content + " unfinished";
      fireEvent.change(screen.getByLabelText("File contents"), { target: { value: next } });
      await act(async () => {
        fireEvent.click(screen.getByRole("treeitem", { name: "guide.md" }));
      });
      expect(input.onSave).toHaveBeenCalledWith(next, skill.name, content);
      expect(onReadFile).not.toHaveBeenCalled();
      expect(screen.getByLabelText<HTMLTextAreaElement>("File contents").value).toBe(next);
      expect(screen.getByRole("button", { name: "Reload from disk" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry save" })).toBeTruthy();
    });
    it("keeps newer typing while an older save is pending and uses the committed snapshot for the next save", async () => {
      let finish!: (value: undefined) => void;
      const gate = new Promise<undefined>((resolve) => {
        finish = resolve;
      });
      const input = props();
      input.onSave.mockReturnValueOnce(gate);
      render(<SkillDetailsView {...input} />);
      fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
      const first = content + " first";
      const second = content + " second";
      fireEvent.change(screen.getByLabelText("File contents"), { target: { value: first } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      });
      expect(input.onSave).toHaveBeenCalledWith(first, skill.name, content);
      expect(screen.getByLabelText("File contents").hasAttribute("disabled")).toBe(false);
      fireEvent.change(screen.getByLabelText("File contents"), { target: { value: second } });
      await act(async () => {
        finish(undefined);
        await gate;
      });
      expect(screen.getByLabelText<HTMLTextAreaElement>("File contents").value).toBe(second);
      expect(input.onBack).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      });
      expect(input.onSave).toHaveBeenLastCalledWith(second, skill.name, first);
      expect(input.onBack).toHaveBeenCalledTimes(1);
    });

    it("shows the settings-page header, global toggle, source-file tree and complete document preview", () => {
      render(
        <SkillDetailsView
          {...props()}
          skill={{
            ...skill,
            source: { kind: "system", displayPath: "/home/.agents/skills/review-notes" },
          }}
        />
      );
      expect(screen.getByRole("button", { name: "Back to skills" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Use now" })).toBeTruthy();
      expect(screen.getByRole("tree", { name: "Source files" })).toBeTruthy();
      expect(screen.getByText("Full instructions")).toBeTruthy();
      expect(screen.getByText(/Alice.*notes/)).toBeTruthy();
      expect(screen.getByText(/\/home\/\.agents/)).toBeTruthy();
      expect(screen.getByText("Global enabled")).toBeTruthy();
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    it("edits every metadata field as part of the complete file and preserves failed drafts exactly", async () => {
      const input = props();
      input.onSave.mockResolvedValueOnce("The file changed outside Scribe");
      render(<SkillDetailsView {...input} />);
      fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
      const next = content
        .replace("name: review-notes", "name: renamed-review")
        .replace("Full instructions", "Updated instructions");
      fireEvent.change(screen.getByLabelText("File contents"), { target: { value: next } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      });
      expect(input.onSave).toHaveBeenCalledWith(next, "renamed-review", content);
      expect(screen.getByRole("alert").textContent).toContain("The file changed outside Scribe");
      expect(screen.getByLabelText<HTMLTextAreaElement>("File contents").value).toBe(next);
      expect(screen.queryByLabelText("Author")).toBeNull();
    });
    it("retains raw edits across preview changes and flushes them before returning", async () => {
      const input = props();
      render(<SkillDetailsView {...input} />);
      fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
      const next = content.replace("Full instructions", "My unfinished draft");
      fireEvent.change(screen.getByLabelText("File contents"), { target: { value: next } });
      fireEvent.click(screen.getByRole("radio", { name: "Preview" }));
      expect(screen.getByText("My unfinished draft")).toBeTruthy();
      fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
      expect(screen.getByLabelText<HTMLTextAreaElement>("File contents").value).toBe(next);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      });
      expect(input.onSave).toHaveBeenCalledWith(next, skill.name, content);
      expect(input.onBack).toHaveBeenCalledTimes(1);
    });
    it("reads and edits a supporting file against its opening content through the source-file tree", async () => {
      const onReadFile = jest.fn().mockResolvedValue("# Supporting instructions");
      const onSaveFile = jest.fn().mockResolvedValue(undefined);
      render(
        <SkillDetailsView
          {...props()}
          files={["SKILL.md", "references/guide.md"]}
          onReadFile={onReadFile}
          onSaveFile={onSaveFile}
        />
      );
      await act(async () => {
        fireEvent.click(
          screen.getByRole("treeitem", { name: "references/guide.md", hidden: true })
        );
      });
      expect(onReadFile).toHaveBeenCalledWith("references/guide.md");
      expect(screen.getByText("# Supporting instructions", { selector: "div" })).toBeTruthy();
      fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText("File contents"), {
        target: { value: "# Revised support" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      });
      expect(onSaveFile).toHaveBeenCalledWith(
        "references/guide.md",
        "# Revised support",
        "# Supporting instructions"
      );
      fireEvent.click(screen.getByRole("radio", { name: "Preview" }));
      expect(screen.getByText("# Revised support", { selector: "div" })).toBeTruthy();
    });
    it("shows unsupported binary-file feedback without offering an editor or stale content", async () => {
      render(
        <SkillDetailsView
          {...props()}
          files={["SKILL.md", "image.png"]}
          onReadFile={jest
            .fn()
            .mockRejectedValue(new Error("This file cannot be previewed as text."))}
        />
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("treeitem", { name: "image.png" }));
      });
      expect(screen.getByRole("alert").textContent).toContain("cannot be previewed");
      expect(screen.queryByText("Full instructions")).toBeNull();
      expect(screen.queryByRole("radiogroup")).toBeNull();
    });
    it("returns to a loaded descriptor immediately when a supporting-file read is still pending", async () => {
      let finish!: (value: string) => void;
      const gate = new Promise<string>((resolve) => {
        finish = resolve;
      });
      render(
        <SkillDetailsView {...props()} files={["SKILL.md", "guide.md"]} onReadFile={() => gate} />
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("treeitem", { name: "guide.md" }));
      });
      expect(screen.getByText("Loading…")).toBeTruthy();
      await act(async () => {
        fireEvent.click(screen.getByRole("treeitem", { name: "SKILL.md" }));
      });
      expect(screen.queryByText("Loading…")).toBeNull();
      expect(screen.getByText("Full instructions")).toBeTruthy();
      await act(async () => {
        finish("Late supporting text");
        await gate;
      });
      expect(screen.getByText("Full instructions")).toBeTruthy();
      expect(screen.queryByText("Late supporting text")).toBeNull();
    });
    it("saves pending edits before switching to a supporting file", async () => {
      const input = props();
      const onReadFile = jest.fn().mockResolvedValue("Supporting text");
      render(
        <SkillDetailsView {...input} files={["SKILL.md", "guide.md"]} onReadFile={onReadFile} />
      );
      fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText("File contents"), {
        target: { value: content + " draft" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("treeitem", { name: "guide.md" }));
      });
      expect(input.onSave).toHaveBeenCalledWith(content + " draft", skill.name, content);
      expect(onReadFile).toHaveBeenCalledWith("guide.md");
      expect(screen.getByText("Supporting text", { selector: "div" })).toBeTruthy();
    });
    it("reloads a conflicted file only when requested and saves a corrected draft against that exact new baseline", async () => {
      const input = props();
      input.onSave.mockResolvedValueOnce("The file changed outside Scribe");
      const external = content.replace("Full instructions", "External changes");
      render(<SkillDetailsView {...input} onReadFile={jest.fn().mockResolvedValue(external)} />);
      fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText("File contents"), {
        target: { value: content + " mine" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      });
      expect(screen.getByLabelText<HTMLTextAreaElement>("File contents").value).toBe(
        content + " mine"
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Reload from disk" }));
      });
      expect(screen.getByLabelText<HTMLTextAreaElement>("File contents").value).toBe(external);
      fireEvent.change(screen.getByLabelText("File contents"), {
        target: { value: external + " merged" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      });
      expect(input.onSave).toHaveBeenLastCalledWith(external + " merged", skill.name, external);
      expect(input.onBack).toHaveBeenCalledTimes(1);
    });
    it("retries a failed save without replacing the user's draft or bypassing the expected content", async () => {
      const input = props();
      input.onSave.mockResolvedValueOnce("Disk unavailable");
      render(<SkillDetailsView {...input} />);
      fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText("File contents"), {
        target: { value: content + " mine" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
      });
      expect(input.onSave).toHaveBeenNthCalledWith(2, content + " mine", skill.name, content);
      expect(screen.getByLabelText<HTMLTextAreaElement>("File contents").value).toBe(
        content + " mine"
      );
      expect(screen.queryByRole("alert")).toBeNull();
    });
    it("protects its own settings window from closing while a draft is unsaved and removes the guard after cleanup", async () => {
      const input = props();
      const view = render(<SkillDetailsView {...input} />);
      fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText("File contents"), {
        target: { value: content + " mine" },
      });
      const pending = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(pending);
      expect(pending.defaultPrevented).toBe(true);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      });
      const saved = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(saved);
      expect(saved.defaultPrevented).toBe(false);
      view.unmount();
      const removed = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(removed);
      expect(removed.defaultPrevented).toBe(false);
    });
    it("uses the completed header-toggle content as the next edit baseline", async () => {
      const input = props();
      const toggled = content.replace(
        "\n---\nFull instructions",
        "\nmetadata:\n  scribe-enabled-agents: ''\n---\nFull instructions"
      );
      const onToggle = jest.fn().mockResolvedValue(undefined);
      render(
        <SkillDetailsView
          {...input}
          onToggle={onToggle}
          onReadFile={jest.fn().mockResolvedValue(toggled)}
        />
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("switch", { name: "Enable review-notes" }));
      });
      expect(onToggle).toHaveBeenCalledWith(false);
      fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
      expect(screen.getByLabelText<HTMLTextAreaElement>("File contents").value).toBe(toggled);
      fireEvent.change(screen.getByLabelText("File contents"), {
        target: { value: toggled + " changed" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      });
      expect(input.onSave).toHaveBeenCalledWith(toggled + " changed", skill.name, toggled);
    });
    it("restores a pending draft after the host hides the settings page without changing its original conflict baseline", async () => {
      const input = props();
      const view = render(<SkillDetailsView {...input} />);
      fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
      const pending = content + " uncommitted";
      fireEvent.change(screen.getByLabelText("File contents"), { target: { value: pending } });
      view.unmount();
      expect(input.onSave).not.toHaveBeenCalled();
      const external = content + " external";
      render(<SkillDetailsView {...input} content={external} />);
      expect(screen.getByLabelText<HTMLTextAreaElement>("File contents").value).toBe(pending);
      expect(screen.getByText("Restored your unsaved edits.")).toBeTruthy();
      input.onSave.mockResolvedValue("External change");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      });
      expect(input.onSave).toHaveBeenCalledWith(pending, skill.name, content);
      expect(input.onBack).not.toHaveBeenCalled();
    });
    it("does not restore a cleared draft after successful uninstallation", () => {
      const view = render(<SkillDetailsView {...props()} initialEditing />);
      fireEvent.change(screen.getByLabelText("File contents"), {
        target: { value: content + " removed" },
      });
      view.unmount();
      clearSkillEditorDraft(skill.dirPath);
      render(<SkillDetailsView {...props()} initialEditing />);
      expect(screen.getByLabelText<HTMLTextAreaElement>("File contents").value).toBe(content);
    });
    it("shows readonly builtin files without editing or Agent repair controls", () => {
      render(<SkillDetailsView {...props()} skill={{ ...skill, source: { kind: "builtin" } }} />);
      expect(screen.getByText("Read only")).toBeTruthy();
      expect(screen.queryByRole("radiogroup")).toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
    });
    it("offers personal repair or builtin restore for invalid skills without a file editor", () => {
      const input = props();
      const broken = {
        name: "broken",
        filePath: "broken/SKILL.md",
        dirPath: "broken",
        reason: "Missing description",
      };
      const view = render(<SkillDetailsView {...input} skill={broken} />);
      fireEvent.click(screen.getByRole("button", { name: "Ask Agent to repair" }));
      expect(input.onRepair).toHaveBeenCalledTimes(1);
      view.rerender(
        <SkillDetailsView
          {...input}
          skill={{ ...broken, source: { kind: "builtin" } }}
          onRestore={jest.fn()}
        />
      );
      expect(screen.getByRole("button", { name: "Restore built-in skills" })).toBeTruthy();
      expect(screen.queryByRole("radiogroup")).toBeNull();
    });
  });
  describe("SkillDetails()", () => {
    it("loads real library files and retains the opening descriptor baseline across external inventory refresh", async () => {
      const input = props();
      let view!: ReturnType<typeof render>;
      await act(async () => {
        view = render(<SkillDetails {...input} />);
      });
      expect(mockListFiles).toHaveBeenCalledWith(skill);
      fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
      const next = content.replace("Full instructions", "My unsaved changes");
      fireEvent.change(screen.getByLabelText("File contents"), { target: { value: next } });
      mockManaged = [{ ...skill, body: "External changes" }];
      await act(async () => {
        view.rerender(<SkillDetails {...input} />);
      });
      expect(mockReadContent).toHaveBeenCalledTimes(1);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      });
      expect(mockSaveSkill).toHaveBeenCalledWith(skill, next, skill.name, content);
    });
    it("keeps newer input through an autosaved rename and writes again at the new folder using the committed baseline", async () => {
      let finish!: (value: { ok: true }) => void;
      const gate = new Promise<{ ok: true }>((resolve) => {
        finish = resolve;
      });
      mockSaveSkill.mockReturnValueOnce(gate);
      const input = props();
      await act(async () => {
        render(<SkillDetails {...input} />);
      });
      fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
      const renamedContent = content.replace("name: review-notes", "name: renamed-review");
      const newerContent = renamedContent + " newer";
      fireEvent.change(screen.getByLabelText("File contents"), {
        target: { value: renamedContent },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      });
      fireEvent.change(screen.getByLabelText("File contents"), { target: { value: newerContent } });
      const renamed = {
        ...skill,
        name: "renamed-review",
        filePath: "/vault/.scribe/skills/renamed-review/SKILL.md",
        dirPath: "/vault/.scribe/skills/renamed-review",
      };
      mockManaged = [renamed];
      await act(async () => {
        finish({ ok: true });
        await gate;
      });
      expect(screen.getByLabelText<HTMLTextAreaElement>("File contents").value).toBe(newerContent);
      expect(input.onBack).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      });
      expect(mockSaveSkill).toHaveBeenNthCalledWith(
        2,
        renamed,
        newerContent,
        renamed.name,
        renamedContent
      );
    });
    it("routes supporting file saves through the manager and refreshes the shared inventory", async () => {
      mockReadFile.mockResolvedValue("Supporting text");
      const onChanged = jest.fn();
      await act(async () => {
        render(<SkillDetails {...props()} onChanged={onChanged} />);
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("treeitem", { name: "references/guide.md", hidden: true })
        );
      });
      fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
      fireEvent.change(screen.getByLabelText("File contents"), {
        target: { value: "Revised text" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Back to skills" }));
      });
      expect(mockSaveFile).toHaveBeenCalledWith(
        skill,
        "references/guide.md",
        "Revised text",
        "Supporting text"
      );
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    it("turns read errors into visible repair feedback", async () => {
      mockReadContent.mockRejectedValue(new Error("Permission denied"));
      await act(async () => {
        render(<SkillDetails {...props()} />);
      });
      expect(screen.getByRole("alert").textContent).toContain("Could not open skill");
      expect(screen.getByRole("button", { name: "Ask Agent to repair" })).toBeTruthy();
    });
  });
});
