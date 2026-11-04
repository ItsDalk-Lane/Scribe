import { setInterfaceLocale } from "@/lib/i18n";
import { registerCommands } from "@/commands";
import { COMMAND_IDS } from "@/constants";
import type ScribePlugin from "@/main";
import type { Command } from "obsidian";

jest.mock("@/commands/CustomCommandChatModal", () => ({
  CustomCommandChatModal: jest.fn(),
}));
jest.mock("@/utils/desktopRuntime", () => ({
  isDesktopRuntime: jest.fn(() => false),
}));

describe("commands", () => {
  describe("registerCommands()", () => {
    beforeEach(() => jest.clearAllMocks());
    afterEach(() => setInterfaceLocale("en"));

    it("registers Chinese display names while preserving command identifiers", () => {
      setInterfaceLocale("zh-CN");
      const commands: Command[] = [];
      const plugin = {
        addCommand: jest.fn((command: Command) => commands.push(command)),
        app: { workspace: { getActiveFile: jest.fn(() => null) } },
      } as unknown as ScribePlugin;

      registerCommands(plugin);

      expect(commands.find(({ id }) => id === COMMAND_IDS.TRIGGER_QUICK_ASK)?.name).toBe(
        "快捷提问"
      );
      expect(commands.find(({ id }) => id === COMMAND_IDS.TRIGGER_QUICK_COMMAND)?.name).toBe(
        "运行快捷指令"
      );
    });

    it("keeps Quick Ask and Quick Command without registering the removed chat interface", () => {
      const commands: Command[] = [];
      const plugin = {
        addCommand: jest.fn((command: Command) => commands.push(command)),
        app: { workspace: { getActiveFile: jest.fn(() => null) } },
      } as unknown as ScribePlugin;
      registerCommands(plugin);
      const identifiers = commands.map(({ id }) => id);
      expect(identifiers).toContain(COMMAND_IDS.TRIGGER_QUICK_ASK);
      expect(identifiers).toContain(COMMAND_IDS.TRIGGER_QUICK_COMMAND);
      expect(identifiers).not.toEqual(expect.arrayContaining(["chat-open-window"]));
      expect(identifiers).not.toEqual(expect.arrayContaining(["chat-toggle-window"]));
      expect(identifiers).not.toEqual(expect.arrayContaining(["new-chat"]));
      expect(identifiers).not.toEqual(expect.arrayContaining(["load-scribe-chat-conversation"]));
    });
  });
});
