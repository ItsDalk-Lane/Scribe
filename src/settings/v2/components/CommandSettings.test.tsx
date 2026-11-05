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
    it("lists every command without a header row or search field and appends plugin sections", () => {
      mockCommands.push({
        ...EMPTY_COMMAND,
        title: "Translate",
        content: "Translate selected text",
      });
      render(
        <CommandSettings>
          <div>Plugin commands</div>
        </CommandSettings>
      );
      expect(screen.getByText("Review")).toBeTruthy();
      expect(screen.getByText("Translate")).toBeTruthy();
      expect(screen.queryByPlaceholderText("Search commands…")).toBeNull();
      expect(screen.queryByText("Custom commands")).toBeNull();
      expect(screen.getByText("Plugin commands")).toBeTruthy();
      expect(screen.queryByRole("tablist")).toBeNull();
    });
    it("keeps only the list controls, with default generation beside adding a command", () => {
      const { container } = render(<CommandSettings />);
      expect(screen.getAllByRole("switch", { name: "Enable Review" })).toHaveLength(1);
      expect(screen.queryByText("Command templating")).toBeNull();
      expect(screen.queryByText("Command sort order")).toBeNull();
      expect(container.querySelector("details")).toBeNull();
      const generate = screen.getByRole("button", { name: "Generate defaults" });
      const add = screen.getByRole("button", { name: "Add command" });
      expect(generate.parentElement).toBe(add.parentElement);
      expect(screen.queryByRole("tablist")).toBeNull();
    });

    it("turns off the whole command while retaining both menu preferences", async () => {
      render(<CommandSettings />);
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
