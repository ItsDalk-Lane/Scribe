import { AppContext } from "@/context";
import type { Skill } from "@/agentMode/skills/types";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Bot } from "lucide-react";
import type { App } from "obsidian";
import React from "react";
import { SkillRow } from "./SkillRow";

const getEffectiveSkillsFolder = jest.fn(() => "scribe/skills");
jest.mock("@/settings/scribeFolder", () => ({
  getEffectiveSkillsFolder: () => getEffectiveSkillsFolder(),
}));

const resolveCanonicalNameForMigration = jest.fn((name: string) => name);
const getSuppressMigrationConfirm = jest.fn(() => false);
const toggleAgent = jest.fn().mockResolvedValue({ ok: true });
jest.mock("@/agentMode/skills/SkillManager", () => ({
  SkillManager: {
    getInstance: () => ({
      resolveCanonicalNameForMigration: (name: string) => resolveCanonicalNameForMigration(name),
      getSuppressMigrationConfirm: () => getSuppressMigrationConfirm(),
      consolidateMirroredSkill: jest.fn(),
      toggleAgent,
    }),
  },
}));

let lastMigrateModalOptions: { actionLines: { verb: string; detail: string }[] } | null = null;
jest.mock("./MigrateSkillConfirmModal", () => ({
  MigrateSkillConfirmModal: class {
    constructor(_app: unknown, options: { actionLines: { verb: string; detail: string }[] }) {
      lastMigrateModalOptions = options;
    }
    open = jest.fn();
  },
}));

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
  if (!("PointerEvent" in window)) {
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
  }
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const SCROLL_LOCK_ATTR = "data-scroll-locked";

const canonicalSkill: Skill = {
  name: "writing-helper",
  description: "Helps with writing.",
  filePath: "/vault/.scribe/skills/writing-helper/SKILL.md",
  dirPath: "/vault/.scribe/skills/writing-helper",
  body: "",
  enabledAgents: [],
  location: { kind: "canonical" },
};

function openMenu() {
  fireEvent.pointerDown(screen.getByLabelText(/More actions/i), { button: 0, ctrlKey: false });
}

function renderRow(
  onRevealInVault: () => void,
  overrides: Partial<React.ComponentProps<typeof SkillRow>> = {}
) {
  const containerRef: React.RefObject<HTMLDivElement> = { current: null };
  const utils = render(
    <AppContext.Provider value={{} as App}>
      <div ref={containerRef} />
      <SkillRow
        skill={canonicalSkill}
        agents={[]}
        agentDirsProjectRel={{}}
        onRevealInVault={onRevealInVault}
        containerRef={containerRef}
        {...overrides}
      />
    </AppContext.Provider>
  );
  return { ...utils, containerRef };
}

const mirroredSkill: Skill = {
  name: "writing-helper",
  description: "Helps with writing.",
  filePath: "/vault/.claude/skills/writing-helper/SKILL.md",
  dirPath: "/vault/.claude/skills/writing-helper",
  body: "",
  enabledAgents: [],
  location: { kind: "project", agentDirs: ["claude", "codex"] },
};

function renderMirroredRow() {
  const containerRef: React.RefObject<HTMLDivElement> = { current: null };
  return render(
    <AppContext.Provider value={{} as App}>
      <div ref={containerRef} />
      <SkillRow
        skill={mirroredSkill}
        agents={[]}
        agentDirsProjectRel={{ claude: ".claude/skills", codex: ".codex/skills" }}
        onRevealInVault={() => {}}
        containerRef={containerRef}
      />
    </AppContext.Provider>
  );
}

describe("SkillRow", () => {
  describe("SkillRow()", () => {
    beforeEach(() => {
      toggleAgent.mockClear();
    });
    afterEach(() => {
      activeDocument.body.removeAttribute(SCROLL_LOCK_ATTR);
      lastMigrateModalOptions = null;
    });

    it("lists Reveal in vault in the overflow menu without engaging a body scroll lock", () => {
      renderRow(() => {});

      openMenu();

      expect(screen.getByText("Reveal in vault")).not.toBeNull();
      expect(activeDocument.body.hasAttribute(SCROLL_LOCK_ATTR)).toBe(false);
    });

    it("invokes the reveal handler when Reveal in vault is selected", () => {
      const onRevealInVault = jest.fn();
      renderRow(onRevealInVault);

      openMenu();
      fireEvent.click(screen.getByText("Reveal in vault"));

      expect(onRevealInVault).toHaveBeenCalledTimes(1);
    });

    it("uses the checked runtime result and waits for rechecking after switching a managed skill", async () => {
      let finish!: () => void;
      const checked = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const onChanged = jest.fn(() => checked);
      renderRow(jest.fn(), {
        agents: [{ id: "claude", displayName: "Claude", Icon: Bot }],
        runtimeItems: [
          {
            id: canonicalSkill.filePath,
            name: canonicalSkill.name,
            source: "project",
            location: canonicalSkill.filePath,
            availability: "loaded",
          },
        ],
        onChanged,
      });
      const control = screen.getByRole("switch", { name: "Enable writing-helper" });
      expect(control.getAttribute("aria-checked")).toBe("true");
      await act(async () => {
        fireEvent.click(control);
      });
      expect(toggleAgent).toHaveBeenCalledWith(canonicalSkill, "claude", false);
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(control.getAttribute("aria-disabled")).toBe("true");
      await act(async () => finish());
      expect(control.getAttribute("aria-disabled")).toBe("false");
    });

    it("keeps a configured managed skill switchable when no runtime check result exists", () => {
      renderRow(jest.fn(), {
        agents: [{ id: "claude", displayName: "Claude", Icon: Bot }],
        skill: { ...canonicalSkill, enabledAgents: ["claude"] },
      });
      const control = screen.getByRole("switch", { name: "Enable writing-helper" });
      expect(control.getAttribute("aria-disabled")).toBe("false");
      expect(control.getAttribute("aria-checked")).toBe("true");
    });

    it("keeps a managed skill switchable when the backend reports it as not loaded", () => {
      renderRow(jest.fn(), {
        agents: [{ id: "claude", displayName: "Claude", Icon: Bot }],
        skill: { ...canonicalSkill, enabledAgents: ["claude"] },
        runtimeItems: [
          {
            id: canonicalSkill.filePath,
            name: canonicalSkill.name,
            source: "project",
            location: canonicalSkill.filePath,
            availability: "not_loaded",
          },
        ],
      });
      const control = screen.getByRole("switch", { name: "Enable writing-helper" });
      expect(control.getAttribute("aria-disabled")).toBe("false");
    });

    it("confirms migration into the folder derived from the Scribe root, not the retired skills field", () => {
      getEffectiveSkillsFolder.mockReturnValue("team/scribe/skills");
      renderMirroredRow();

      openMenu();
      fireEvent.click(screen.getByText("Migrate to shared folder"));

      const moveLine = lastMigrateModalOptions?.actionLines.find((line) => line.verb === "Move");
      expect(moveLine?.detail).toContain("<vault>/team/scribe/skills/writing-helper/");
    });
  });
});
