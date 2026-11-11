import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SubagentLimitSettings } from "./SubagentLimitSettings";

describe("SubagentLimitSettings", () => {
  describe("SubagentLimitSettings()", () => {
    it("saves the selected limit without changing the other protections https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
      const onChange = jest.fn();
      render(
        <SubagentLimitSettings
          values={{ maxConcurrent: 3, maxQueued: 20, maxTaskRequests: 100 }}
          onChange={onChange}
        />
      );
      fireEvent.change(screen.getByLabelText("Model requests per task"), {
        target: { value: "200" },
      });
      expect(onChange).toHaveBeenLastCalledWith({
        maxConcurrent: 3,
        maxQueued: 20,
        maxTaskRequests: 200,
      });
      fireEvent.change(screen.getByLabelText("Queued subagents"), { target: { value: "0" } });
      expect(onChange).toHaveBeenLastCalledWith({
        maxConcurrent: 3,
        maxQueued: 0,
        maxTaskRequests: 100,
      });
    });

    it("retains the saved limits while an input is empty, negative or fractional https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
      const onChange = jest.fn();
      render(
        <SubagentLimitSettings
          values={{ maxConcurrent: 3, maxQueued: 20, maxTaskRequests: 100 }}
          onChange={onChange}
        />
      );
      const input = screen.getByLabelText("Concurrent subagents");
      for (const value of ["", "0", "-1", "1.5"]) fireEvent.change(input, { target: { value } });
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
