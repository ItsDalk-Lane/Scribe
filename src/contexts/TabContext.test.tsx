import { TabProvider, useTab, useSettingsLeaveGuard } from "@/contexts/TabContext";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const TabProbe: React.FC = () => {
  const { selectedTab, setSelectedTab } = useTab();
  return (
    <button type="button" onClick={() => setSelectedTab("skills")}>
      {selectedTab}
    </button>
  );
};

describe("TabContext", () => {
  describe("TabProvider", () => {
    it("selects Basic for an ordinary settings render", () => {
      render(
        <TabProvider>
          <TabProbe />
        </TabProvider>
      );

      expect(screen.getByText("basic")).toBeTruthy();
    });

    it("selects the requested initial tab for a direct handoff", () => {
      render(
        <TabProvider initialTab="myCommands">
          <TabProbe />
        </TabProvider>
      );

      expect(screen.getByText("myCommands")).toBeTruthy();
    });
  });

  describe("useTab", () => {
    it("exposes the current tab and its selector", () => {
      render(
        <TabProvider>
          <TabProbe />
        </TabProvider>
      );

      fireEvent.click(screen.getByRole("button", { name: "basic" }));

      expect(screen.getByRole("button", { name: "skills" })).toBeTruthy();
    });
  });
  describe("useSettingsLeaveGuard()", () => {
    it("keeps the current settings tab until the active editor finishes saving", async () => {
      let finish!: () => void;
      const gate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const guard = jest.fn(() => gate);
      function Editor() {
        useSettingsLeaveGuard(guard);
        return <TabProbe />;
      }
      render(
        <TabProvider>
          <Editor />
        </TabProvider>
      );
      fireEvent.click(screen.getByRole("button", { name: "basic" }));
      expect(guard).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "basic" })).toBeTruthy();
      await act(async () => {
        finish();
        await gate;
      });
      expect(screen.getByRole("button", { name: "skills" })).toBeTruthy();
    });
    it("preserves the current tab when an editor reports a conflict and unregisters the guard on unmount", async () => {
      const guard = jest.fn().mockRejectedValue(new Error("External change"));
      function Editor() {
        useSettingsLeaveGuard(guard);
        return null;
      }
      const view = render(
        <TabProvider>
          <TabProbe />
          <Editor />
        </TabProvider>
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "basic" }));
      });
      expect(screen.getByRole("button", { name: "basic" })).toBeTruthy();
      view.rerender(
        <TabProvider>
          <TabProbe />
        </TabProvider>
      );
      fireEvent.click(screen.getByRole("button", { name: "basic" }));
      expect(screen.getByRole("button", { name: "skills" })).toBeTruthy();
      expect(guard).toHaveBeenCalledTimes(1);
    });
    it("permits isolated component previews without a settings provider", () => {
      function Preview() {
        useSettingsLeaveGuard(jest.fn());
        return <p>Preview</p>;
      }
      render(<Preview />);
      expect(screen.getByText("Preview")).toBeTruthy();
    });
  });
});
