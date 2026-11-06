import { generateDefaultCommands } from "@/commands/migrator";
import { getCachedCustomCommands } from "@/commands/state";
const mockUpdateCommands = jest.fn().mockResolvedValue(undefined);

jest.mock("@/commands/customCommandManager", () => ({
  CustomCommandManager: {
    getInstance: jest.fn(() => ({ updateCommands: mockUpdateCommands })),
  },
}));

jest.mock("@/commands/state", () => ({
  getCachedCustomCommands: jest.fn(() => []),
}));

describe("migrator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCachedCustomCommands as jest.Mock).mockReturnValue([]);
  });

  describe("generateDefaultCommands()", () => {
    it("adds only defaults that are not already present", async () => {
      (getCachedCustomCommands as jest.Mock).mockReturnValue([
        {
          title: "Summarize",
          content: "Existing",
          showInContextMenu: true,
          showInSlashMenu: true,
          order: 1,
          modelKey: "",
          lastUsedMs: 0,
        },
      ]);

      await generateDefaultCommands();

      const saved = mockUpdateCommands.mock.calls[0][0] as Array<{ title: string }>;
      expect(saved.filter(({ title }) => title === "Summarize")).toHaveLength(1);
      expect(saved.length).toBeGreaterThan(1);
    });
  });
});
