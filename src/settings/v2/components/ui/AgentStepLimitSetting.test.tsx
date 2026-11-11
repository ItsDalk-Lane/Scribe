import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentStepLimitSetting } from "./AgentStepLimitSetting";

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/31";

describe("AgentStepLimitSetting", () => {
  describe("AgentStepLimitSetting()", () => {
    it(`shows Unlimited explicitly without an implicit 50-step limit ${issue}`, () => {
      const onChange = jest.fn();
      render(<AgentStepLimitSetting onChange={onChange} />);
      expect(screen.getByRole<HTMLOptionElement>("option", { name: "Unlimited" }).selected).toBe(
        true
      );
      expect(screen.queryByRole("spinbutton")).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "limited" } });
      expect(onChange).toHaveBeenLastCalledWith(50);
    });
    it(`keeps an explicit saved 50 and allows selecting Unlimited ${issue}`, () => {
      const onChange = jest.fn();
      render(<AgentStepLimitSetting maxSteps={50} onChange={onChange} />);
      expect(screen.getByRole<HTMLInputElement>("spinbutton").value).toBe("50");
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "unlimited" } });
      expect(onChange).toHaveBeenLastCalledWith(undefined);
    });
    it(`accepts limits above 1000 and preserves the saved limit for blank, negative and fractional input ${issue}`, () => {
      const onChange = jest.fn();
      render(<AgentStepLimitSetting maxSteps={75} onChange={onChange} />);
      const input = screen.getByRole("spinbutton");
      fireEvent.change(input, { target: { value: "1500" } });
      expect(onChange).toHaveBeenLastCalledWith(1500);
      for (const value of ["", "-1", "1.5", "9007199254740992"]) {
        fireEvent.change(input, { target: { value } });
      }
      expect(onChange).toHaveBeenCalledTimes(1);
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "unlimited" } });
      expect(onChange).toHaveBeenLastCalledWith(undefined);
    });
  });
});
