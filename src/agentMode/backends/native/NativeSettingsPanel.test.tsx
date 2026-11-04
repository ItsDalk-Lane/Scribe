import React from "react";
import type { App } from "obsidian";
import { fireEvent, render, screen } from "@testing-library/react";
import type CopilotPlugin from "@/main";
import { DEFAULT_SETTINGS } from "@/constants";
import { getSettings, resetSettings, setSettings } from "@/settings/model";
import { NativeSettingsPanel } from "@/agentMode/backends/native/NativeSettingsPanel";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

describe("NativeSettingsPanel", () => {
  describe("NativeSettingsPanel()", () => {
    beforeEach(() => resetSettings());
    it("updates native settings through the existing settings store while retaining unrelated agent preferences", () => {
      setSettings({
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          offerFeedbackCards: false,
          backends: { native: { maxSteps: 75 } },
        },
      });
      render(<NativeSettingsPanel app={{} as App} plugin={{} as CopilotPlugin} />);
      fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "auto" } });
      expect(getSettings().agentMode.backends.native).toEqual({
        defaultMode: "auto",
        maxSteps: 75,
      });
      expect(getSettings().agentMode.offerFeedbackCards).toBe(false);
    });
    it("renders the existing defaults when no native settings have been saved", () => {
      render(<NativeSettingsPanel app={{} as App} plugin={{} as CopilotPlugin} />);
      expect(screen.getByRole("spinbutton").getAttribute("value")).toBe("50");
      expect((screen.getAllByRole("combobox")[0] as HTMLSelectElement).value).toBe("");
    });
  });
});
