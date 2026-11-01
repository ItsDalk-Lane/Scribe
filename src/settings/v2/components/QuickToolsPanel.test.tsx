import { QuickToolsPanel } from "@/settings/v2/components/QuickToolsPanel";
import { updateSetting } from "@/settings/model";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

let mockQuickCommandModelKey: string | undefined = "legacy-default";

jest.mock("@/agentMode", () => {
  throw new Error("Quick tools settings must not initialize desktop agents");
});
jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the public hook
  useSettingsValue: () => ({
    defaultModelKey: "old-chat",
    quickCommandModelKey: mockQuickCommandModelKey,
  }),
  updateSetting: jest.fn(),
}));
jest.mock("@/hooks/useChatBackendModelOptions", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the public hook
  useChatBackendModelOptions: (fallbackToFirst = true) => ({
    options: [
      { label: "Model A", value: "a" },
      { label: "Model B", value: "b" },
    ],
    resolveSelectionId: (selection: string | undefined) =>
      selection === "legacy-default" || fallbackToFirst ? "a" : undefined,
  }),
}));
jest.mock("@/settings/v2/components/ChatModelEnableList", () => ({
  ChatModelEnableList: () => <div>Enabled chat models</div>,
}));

describe("QuickToolsPanel", () => {
  describe("QuickToolsPanel()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockQuickCommandModelKey = "legacy-default";
    });
    it("resolves the saved default and persists a new model without desktop agents (https://github.com/Brevilabs/obsidian-copilot-private/issues/373)", () => {
      render(<QuickToolsPanel />);
      expect(screen.getByDisplayValue("Model A")).not.toBeNull();
      expect(screen.getByText("Enabled chat models")).not.toBeNull();
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });
      expect(updateSetting).toHaveBeenCalledWith("quickCommandModelKey", "b");
      expect(
        screen.getByText(
          "Used by Quick Ask, Quick Command, and saved commands set to Default model."
        )
      ).not.toBeNull();
    });
    it("asks for the shared quick-tool default instead of reusing the removed chat's default", () => {
      mockQuickCommandModelKey = undefined;
      render(<QuickToolsPanel />);

      expect(screen.getByDisplayValue("Select model")).not.toBeNull();
      expect(updateSetting).not.toHaveBeenCalled();
    });
  });
});
