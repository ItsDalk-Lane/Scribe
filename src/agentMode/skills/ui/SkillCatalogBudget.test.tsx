import React from "react";
import { render, screen } from "@testing-library/react";
import { SkillCatalogBudgetNotice } from "@/agentMode/skills/ui/SkillCatalogBudget";

describe("SkillCatalogBudget", () => {
  describe("SkillCatalogBudgetNotice", () => {
    it("reports that no skill names are visible when the budget excludes every skill https://github.com/ItsDalk-Lane/Scribe/issues/40", () => {
      render(
        <SkillCatalogBudgetNotice
          status={{ mode: "names-only", includedNames: [], omittedNames: ["alpha", "beta"] }}
        />
      );
      expect(screen.getByRole("status").textContent).toContain(
        "No skill names are in the model-visible list"
      );
      expect(screen.getByRole("status").textContent).toContain("alpha, beta");
    });

    it("identifies skill names omitted when a names-only list fits only some skills https://github.com/ItsDalk-Lane/Scribe/issues/40", () => {
      render(
        <SkillCatalogBudgetNotice
          status={{ mode: "names-only", includedNames: ["alpha"], omittedNames: ["beta"] }}
        />
      );
      expect(screen.getByRole("status").textContent).toContain("Omitted skill names (1): beta");
    });
  });
});
