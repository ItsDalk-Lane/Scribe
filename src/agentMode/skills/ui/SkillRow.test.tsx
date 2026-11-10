import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SkillActions, SkillRow, SkillSourceBadge } from "@/agentMode/skills/ui/SkillRow";
import type { Skill } from "@/agentMode/skills/types";

const skill: Skill = {
  name: "review-notes",
  description: "Review notes",
  body: "Read notes",
  filePath: "/vault/.scribe/skills/review-notes/SKILL.md",
  dirPath: "/vault/.scribe/skills/review-notes",
  enabledAgents: ["native"],
  location: { kind: "canonical" },
};
const actions = () => ({ onUse: jest.fn(), onToggle: jest.fn(), onUninstall: jest.fn() });

describe("SkillRow", () => {
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = document;
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });
  describe("SkillRow()", () => {
    it("uninstalls directly without opening the detail view", () => {
      const onOpen = jest.fn();
      const handlers = actions();
      render(<SkillRow skill={skill} onOpen={onOpen} {...handlers} />);
      fireEvent.click(screen.getByRole("button", { name: "Uninstall review-notes" }));
      expect(handlers.onUninstall).toHaveBeenCalledTimes(1);
      expect(onOpen).not.toHaveBeenCalled();
    });
    it("opens details from its name and keeps use, enablement, and uninstall in that order", () => {
      const onOpen = jest.fn();
      const handlers = actions();
      const view = render(<SkillRow skill={skill} onOpen={onOpen} {...handlers} />);
      fireEvent.click(screen.getByRole("button", { name: /review-notes.*Review notes/ }));
      expect(onOpen).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Use review-notes now" }));
      expect(handlers.onUse).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledTimes(1);
      const control = view.container.querySelectorAll(
        '[aria-label="Use review-notes now"], [role="switch"], [aria-label="Uninstall review-notes"]'
      );
      expect(Array.from(control).map((item) => item.getAttribute("aria-label"))).toEqual([
        "Use review-notes now",
        "Enable review-notes",
        "Uninstall review-notes",
      ]);
    });
    it("shows rejected skills as detail rows while disabling use and enablement", () => {
      render(
        <SkillRow
          skill={{
            name: "broken",
            filePath: "/vault/.scribe/skills/broken/SKILL.md",
            dirPath: "/vault/.scribe/skills/broken",
            reason: "Missing description",
          }}
          onOpen={jest.fn()}
          {...actions()}
        />
      );
      expect(screen.getByText("Could not load this skill")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Use broken now" }).hasAttribute("disabled")).toBe(
        true
      );
      expect(screen.getByRole("switch").getAttribute("aria-disabled")).toBe("true");
    });
  });
  describe("SkillActions()", () => {
    it("offers a direct uninstall action for built-in skills", () => {
      const handlers = actions();
      render(<SkillActions skill={{ ...skill, source: { kind: "builtin" } }} {...handlers} />);
      fireEvent.click(screen.getByRole("button", { name: "Uninstall review-notes" }));
      expect(handlers.onUninstall).toHaveBeenCalledTimes(1);
    });
    it("preserves saved enablement and allows switching without runtime checks", () => {
      const handlers = actions();
      render(<SkillActions skill={skill} {...handlers} />);
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
      fireEvent.click(screen.getByRole("switch"));
      expect(handlers.onToggle).toHaveBeenCalledWith(false);
    });
    it("prevents immediate use of a skill hidden from manual invocation", () => {
      render(<SkillActions skill={{ ...skill, userInvocable: false }} {...actions()} />);
      expect(
        screen.getByRole("button", { name: "Use review-notes now" }).hasAttribute("disabled")
      ).toBe(true);
    });
  });
  describe("SkillSourceBadge()", () => {
    it.each([
      [undefined, "Local"],
      ["builtin", "Built-in"],
      ["agent", "Agent created"],
      ["system", "System imported"],
      ["local", "Local"],
    ] as const)("shows %s as %s", (kind, label) => {
      render(<SkillSourceBadge source={kind ? { kind } : undefined} />);
      expect(screen.getByText(label)).toBeTruthy();
    });
  });
});
