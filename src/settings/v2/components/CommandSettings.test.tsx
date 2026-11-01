import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "@/constants";
import { EMPTY_COMMAND } from "@/commands/constants";
import type { CustomCommand } from "@/commands/type";
import { CommandSettings } from "./CommandSettings";

let mockCommands: CustomCommand[] = [];
const mockUpdate = jest.fn().mockResolvedValue(undefined);
jest.mock("@/commands/state", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 模拟真实 Hook 导出
  useCustomCommands: () => mockCommands,
}));
jest.mock("@/context", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 模拟真实 Hook 导出
  useApp: () => ({}),
}));
jest.mock("@/hooks/useChatBackendModelOptions", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 模拟真实 Hook 导出
  useChatBackendModelOptions: () => ({ options: [], resolveSelectionId: () => undefined }),
}));
jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 模拟真实 Hook 导出
  useSettingsValue: () => DEFAULT_SETTINGS,
  updateSetting: jest.fn(),
}));
jest.mock("@/commands/customCommandManager", () => ({
  CustomCommandManager: { getInstance: () => ({ updateCommand: mockUpdate }) },
}));

describe("CommandSettings", () => {
  describe("CommandSettings()", () => {
    beforeEach(() => {
      mockCommands = [
        {
          ...EMPTY_COMMAND,
          title: "Review",
          content: "Read the note",
          showInContextMenu: true,
          showInSlashMenu: true,
        },
      ];
      mockUpdate.mockClear();
    });
    it("filters shared commands with the parent page's search and appends plugin sections", () => {
      mockCommands.push({
        ...EMPTY_COMMAND,
        title: "Translate",
        content: "Translate selected text",
      });
      render(
        <CommandSettings embedded query="review">
          <div>Plugin commands</div>
        </CommandSettings>
      );
      expect(screen.getByText("My commands")).toBeTruthy();
      expect(screen.queryByText("Translate")).toBeNull();
      expect(screen.getByText("Plugin commands")).toBeTruthy();
      expect(screen.queryByRole("tablist")).toBeNull();
    });
    it("shows collapsed command options above one grouped command row instead of separate desktop and mobile lists", () => {
      render(<CommandSettings embedded />);
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.getAllByRole("switch", { name: "Enable Review" })).toHaveLength(1);
      const options = screen.getByText("Command options").closest("details");
      expect(options?.open).toBe(false);
      const heading = screen.getByText("My commands");
      expect(
        options!.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it("turns off the whole command while retaining both menu preferences", async () => {
      render(<CommandSettings embedded />);
      fireEvent.click(screen.getByRole("switch", { name: "Enable Review" }));
      await waitFor(() =>
        expect(mockUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            enabled: false,
            showInContextMenu: true,
            showInSlashMenu: true,
          }),
          "Review",
          false,
          mockCommands[0]
        )
      );
    });
  });
});
