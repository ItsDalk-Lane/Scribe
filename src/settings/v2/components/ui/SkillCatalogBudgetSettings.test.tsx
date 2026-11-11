import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SkillCatalogBudgetSettings } from "./SkillCatalogBudgetSettings";

describe("SkillCatalogBudgetSettings", () => {
  describe("SkillCatalogBudgetSettings()", () => {
    it("submits valid limits as their individual budget field https://github.com/ItsDalk-Lane/Scribe/issues/40", () => {
      const onChange = jest.fn();
      render(<SkillCatalogBudgetSettings percent={2} maxTokens={10000} onChange={onChange} />);
      fireEvent.change(screen.getByLabelText("Context share (percent)"), {
        target: { value: "5" },
      });
      fireEvent.change(screen.getByLabelText("Absolute token maximum"), {
        target: { value: "500" },
      });
      expect(onChange).toHaveBeenNthCalledWith(1, { catalogBudgetPercent: 5 });
      expect(onChange).toHaveBeenNthCalledWith(2, { catalogBudgetMaxTokens: 500 });
    });

    it("keeps saved limits when invalid values are entered https://github.com/ItsDalk-Lane/Scribe/issues/40", () => {
      const onChange = jest.fn();
      render(<SkillCatalogBudgetSettings percent={2} maxTokens={10000} onChange={onChange} />);
      fireEvent.change(screen.getByLabelText("Context share (percent)"), {
        target: { value: "0" },
      });
      fireEvent.change(screen.getByLabelText("Absolute token maximum"), {
        target: { value: "-1" },
      });
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
