import {
  AgentTurnDurationIndicator,
  formatWorkedDuration,
} from "@/agentMode/ui/AgentTurnDurationIndicator";
import { act, render, screen } from "@testing-library/react";
import React from "react";

describe("AgentTurnDurationIndicator", () => {
  describe("formatWorkedDuration()", () => {
    it("shows tenths of a second while omitting leading zero-valued units https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      expect(formatWorkedDuration(0)).toBe("0.0s");
      expect(formatWorkedDuration(18_999)).toBe("18.9s");
      expect(formatWorkedDuration(138_000)).toBe("2m 18.0s");
      expect(formatWorkedDuration(3_738_000)).toBe("1h 2m 18.0s");
    });

    it("clamps invalid and negative durations to zero", () => {
      expect(formatWorkedDuration(-1_000)).toBe("0.0s");
      expect(formatWorkedDuration(Number.NaN)).toBe("0.0s");
      expect(formatWorkedDuration(Number.POSITIVE_INFINITY)).toBe("0.0s");
    });
  });

  describe("AgentTurnDurationIndicator()", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(200_000);
    });

    afterEach(() => jest.useRealTimers());

    it("shows the animated icon and advances while the turn is running", () => {
      const { container } = render(
        <AgentTurnDurationIndicator status="running" startedAtMs={62_000} />
      );

      expect(screen.getByRole("status").textContent).toBe("Agent is working");
      const duration = screen.getByText("2m 18.0s");
      expect(duration.closest('[aria-hidden="true"]')).toBeNull();
      expect(container.querySelector(".scribe-spinner")).toBeTruthy();
      expect(container.querySelector(".scribe-spinner-dot-0")).toBeTruthy();

      act(() => jest.advanceTimersByTime(2_000));

      expect(screen.getByText("2m 20.0s")).toBeTruthy();
    });

    it("starts at one tenth and reads wall-clock elapsed time without accumulating ticks https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      render(<AgentTurnDurationIndicator status="running" startedAtMs={199_950} />);
      expect(screen.getByText("0.1s")).toBeTruthy();
      act(() => jest.advanceTimersByTime(100));
      expect(screen.getByText("0.1s")).toBeTruthy();
      jest.setSystemTime(207_450);
      act(() => jest.advanceTimersByTime(100));
      expect(screen.getByText("7.6s")).toBeTruthy();
    });

    it("keeps the minimum visible tenth when a very fast reply completes https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      render(<AgentTurnDurationIndicator status="complete" durationMs={50} />);
      expect(screen.getByText("0.1s")).toBeTruthy();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("registers and clears the ticker on the mounted element's window", () => {
      const setInterval = jest.fn(() => 42);
      const clearInterval = jest.fn();
      const popoutWindow = { setInterval, clearInterval } as unknown as Window;
      const winSpy = jest.spyOn(Node.prototype, "win", "get").mockReturnValue(popoutWindow);

      try {
        const { unmount } = render(
          <AgentTurnDurationIndicator status="running" startedAtMs={62_000} />
        );

        expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 100);
        unmount();
        expect(clearInterval).toHaveBeenCalledWith(42);
      } finally {
        winSpy.mockRestore();
      }
    });

    it("freezes the duration with a static icon after completion", () => {
      const { container } = render(
        <AgentTurnDurationIndicator status="complete" durationMs={138_000} />
      );

      expect(screen.getByText("2m 18.0s").parentElement?.textContent).toContain(
        "Worked for 2m 18.0s"
      );
      expect(container.querySelector(".scribe-spinner")).toBeTruthy();
      expect(container.querySelector(".scribe-spinner-dot-0")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();

      act(() => jest.advanceTimersByTime(60_000));

      expect(screen.getByText("2m 18.0s")).toBeTruthy();
    });

    it("shows and announces the given label in place of the turn wording while running", () => {
      render(
        <AgentTurnDurationIndicator
          status="running"
          startedAtMs={62_000}
          label="Compacting conversation…"
        />
      );

      expect(screen.getAllByText("Compacting conversation…")).toHaveLength(2);
      expect(screen.getByText("2m 18.0s")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe("Compacting conversation…");
      expect(screen.queryByText("Worked for")).toBeNull();
    });

    it("shows the given icon in place of the animated spinner while running", () => {
      const { container } = render(
        <AgentTurnDurationIndicator
          status="running"
          startedAtMs={62_000}
          icon={<svg data-testid="custom-icon" />}
        />
      );

      expect(screen.getByTestId("custom-icon")).toBeTruthy();
      expect(container.querySelector(".scribe-spinner")).toBeNull();
      expect(screen.getByText("2m 18.0s")).toBeTruthy();
    });
  });
});
