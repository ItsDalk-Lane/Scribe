import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { setInterfaceLocale } from "@/lib/i18n";
import { DebuggingSupportSection } from "./DebuggingSupportSection";
import storyMeta from "./DebuggingSupportSection.stories";

describe("DebuggingSupportSection", () => {
  describe("DebuggingSupportSection()", () => {
    afterEach(() => setInterfaceLocale("en"));

    it("keeps only the debug switch and removes feedback reporting https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      const onDebugChange = jest.fn();
      render(<DebuggingSupportSection {...storyMeta.args} onDebugChange={onDebugChange} />);

      expect(screen.queryByText("Report an issue")).toBeNull();
      expect(screen.queryByText("Offer feedback reports in Agent Chat")).toBeNull();
      expect(screen.queryByText("Agent activity log")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.getAllByRole("switch")).toHaveLength(1);
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
      fireEvent.click(screen.getByRole("switch"));
      expect(onDebugChange).toHaveBeenCalledWith(true);
    });

    it("shows an enabled debug switch and passes a disable action to its callback", () => {
      const onDebugChange = jest.fn();
      render(<DebuggingSupportSection {...storyMeta.args} debug onDebugChange={onDebugChange} />);

      expect(screen.getAllByRole("switch")).toHaveLength(1);
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
      fireEvent.click(screen.getByRole("switch"));
      expect(onDebugChange).toHaveBeenCalledWith(false);
    });
  });
});
