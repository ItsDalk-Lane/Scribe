import type { App, Plugin } from "obsidian";
import { CustomCommandRegister } from "./customCommandRegister";
import { updateCachedCommands } from "./state";
import { EMPTY_COMMAND } from "./constants";
import { loadAllCustomCommands } from "./customCommandUtils";
import { CustomCommandChatModal } from "./CustomCommandChatModal";

jest.mock("@/commands/customCommandUtils", () => ({
  getCommandId: (title: string) => title.toLowerCase(),
  loadAllCustomCommands: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/commands/CustomCommandChatModal", () => ({
  CustomCommandChatModal: jest.fn(() => ({ open: jest.fn() })),
}));
jest.mock("@/commands/customCommandManager", () => ({
  CustomCommandManager: {
    getInstance: () => ({ recordUsage: jest.fn().mockResolvedValue(undefined) }),
  },
}));
jest.mock("@/logger", () => ({ logError: jest.fn() }));

function setup() {
  const app = {
    vault: {
      getFiles: jest.fn(() => {
        throw new Error("Hidden data is not indexed");
      }),
    },
  } as unknown as App;
  const addCommand = jest.fn();
  const removeCommand = jest.fn();
  const plugin = { app, addCommand, removeCommand } as unknown as Plugin;
  return { app, addCommand, removeCommand, register: new CustomCommandRegister(plugin, app) };
}

describe("customCommandRegister", () => {
  describe("CustomCommandRegister", () => {
    beforeEach(() => {
      updateCachedCommands([]);
      jest.clearAllMocks();
    });
    describe("initialize()", () => {
      it("loads hidden files and registers enabled commands without scanning indexed notes", async () => {
        const fixture = setup();
        updateCachedCommands([
          { ...EMPTY_COMMAND, title: "Review" },
          { ...EMPTY_COMMAND, title: "Disabled", enabled: false },
        ]);
        await fixture.register.initialize();
        expect(loadAllCustomCommands).toHaveBeenCalledWith(fixture.app);
        expect(fixture.addCommand).toHaveBeenLastCalledWith(
          expect.objectContaining({ id: "review", name: "Review" })
        );
        expect(fixture.app.vault.getFiles).not.toHaveBeenCalled();
        const command = fixture.addCommand.mock.calls.at(-1)![0] as {
          editorCallback: (editor: { getSelection: () => string }) => void;
        };
        command.editorCallback({ getSelection: () => "selected note" });
        expect(CustomCommandChatModal).toHaveBeenCalledWith(
          fixture.app,
          expect.objectContaining({ selectedText: "selected note" })
        );
        fixture.register.cleanup();
      });
      it("updates registered commands when saved state changes", async () => {
        const fixture = setup();
        updateCachedCommands([{ ...EMPTY_COMMAND, title: "Before" }]);
        await fixture.register.initialize();
        updateCachedCommands([{ ...EMPTY_COMMAND, title: "After" }]);
        expect(fixture.removeCommand).toHaveBeenCalledWith("before");
        expect(fixture.addCommand).toHaveBeenLastCalledWith(
          expect.objectContaining({ id: "after" })
        );
        fixture.register.cleanup();
      });
    });
    describe("cleanup()", () => {
      it("unregisters commands and ignores later state updates", async () => {
        const fixture = setup();
        updateCachedCommands([{ ...EMPTY_COMMAND, title: "Review" }]);
        await fixture.register.initialize();
        fixture.register.cleanup();
        expect(fixture.removeCommand).toHaveBeenCalledWith("review");
        fixture.addCommand.mockClear();
        updateCachedCommands([{ ...EMPTY_COMMAND, title: "Later" }]);
        expect(fixture.addCommand).not.toHaveBeenCalled();
      });
    });
  });
});
