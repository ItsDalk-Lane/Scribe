import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { setInterfaceLocale } from "@/lib/i18n";
import { DebuggingSupportSection } from "./DebuggingSupportSection";
import storyMeta from "./DebuggingSupportSection.stories";

function renderSection() {
  const props = {
    debug: false,
    onDebugChange: jest.fn(),
    frameLogEnabled: true,
    onFrameLogChange: jest.fn(),
    frameLogPath: "/tmp/obsidian-scribe/acp-frames/3f9a/acp-frames.ndjson",
    onOpenFrameLog: jest.fn(),
    onClearFrameLog: jest.fn(),
  };
  render(<DebuggingSupportSection {...props} />);
  return props;
}

describe("DebuggingSupportSection", () => {
  describe("DebuggingSupportSection()", () => {
    afterEach(() => setInterfaceLocale("en"));

    it("keeps log controls and removes feedback reporting https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      const onDebugChange = jest.fn();
      const onFrameLogChange = jest.fn();
      const onOpenFrameLog = jest.fn();
      const onClearFrameLog = jest.fn();
      render(
        <DebuggingSupportSection
          {...storyMeta.args}
          onDebugChange={onDebugChange}
          onFrameLogChange={onFrameLogChange}
          onOpenFrameLog={onOpenFrameLog}
          onClearFrameLog={onClearFrameLog}
        />
      );
      expect(screen.queryByText("Report an issue")).toBeNull();
      expect(screen.queryByText("Offer feedback reports in Agent Chat")).toBeNull();
      const switches = screen.getAllByRole("switch");
      expect(switches).toHaveLength(2);
      fireEvent.click(switches[0]);
      expect(onDebugChange).toHaveBeenCalledWith(true);
      fireEvent.click(switches[1]);
      expect(onFrameLogChange).toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(onOpenFrameLog).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      expect(onClearFrameLog).toHaveBeenCalledTimes(1);
    });
    const BUTTON_CALLBACKS = ["onOpenFrameLog", "onClearFrameLog"] as const;

    it.each([
      ["Open", "onOpenFrameLog"],
      ["Clear", "onClearFrameLog"],
    ] as const)("hands the %s button's click to %s and to no other callback", (name, own) => {
      const props = renderSection();

      fireEvent.click(screen.getByRole("button", { name }));

      for (const callback of BUTTON_CALLBACKS) {
        expect(props[callback]).toHaveBeenCalledTimes(callback === own ? 1 : 0);
      }
    });

    it("keeps the debug and activity-log switches on separate callbacks", () => {
      const props = renderSection();
      const [debugSwitch, frameLogSwitch] = screen.getAllByRole("switch");

      fireEvent.click(debugSwitch);

      expect(props.onDebugChange).toHaveBeenCalledWith(true);
      expect(props.onFrameLogChange).not.toHaveBeenCalled();

      fireEvent.click(frameLogSwitch);

      expect(props.onFrameLogChange).toHaveBeenCalledWith(false);
      expect(props.onDebugChange).toHaveBeenCalledTimes(1);
    });

    it("names where the activity log is written, so it can be found without this component reading the disk", () => {
      const props = renderSection();

      expect(screen.getByText(new RegExp(props.frameLogPath))).toBeTruthy();
    });

    it("does not promise that current native chats are recorded into the activity log (https://github.com/ItsDalk-Lane/Scribe/issues/22)", () => {
      renderSection();

      const description = screen
        .getAllByText(/frameLogPath|stored on this device/i)
        .map((node) => node.textContent)
        .join(" ");
      expect(description).toContain("Current native chats are not recorded");
    });
  });
});
