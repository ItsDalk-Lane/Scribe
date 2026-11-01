import { ClaudeBackendDescriptor } from "@/agentMode/backends/claude/descriptor";
import type { ExtensionDiscoveryInput } from "@/agentMode/backends/shared/extensionInventory";
import { DEFAULT_SETTINGS } from "@/constants";

const mockDiscovery = jest.fn().mockResolvedValue([]);
let mockManagedEnv: Record<string, string> = {};
jest.mock("@/agentMode/backends/claude/discoverExtensions", () => ({
  discoverClaudeExtensions: (input: ExtensionDiscoveryInput) => mockDiscovery(input),
}));
jest.mock("@/agentMode/backends/shared/builtinSkillEnv", () => ({
  buildBuiltinSkillEnv: async () => mockManagedEnv,
}));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

function settingsFor(backend: "claude", envOverrides: Record<string, string> = {}) {
  return {
    ...DEFAULT_SETTINGS,
    agentMode: {
      ...DEFAULT_SETTINGS.agentMode,
      backends: {
        ...DEFAULT_SETTINGS.agentMode.backends,
        [backend]: { ...DEFAULT_SETTINGS.agentMode.backends[backend], envOverrides },
      },
    },
  };
}

describe("extensionEnvironments", () => {
  beforeEach(() => {
    mockDiscovery.mockClear();
    mockManagedEnv = {};
  });
  describe("ClaudeBackendDescriptor", () => {
    describe("readExtensions()", () => {
      it("matches the runtime environment order with user overrides winning over managed values", async () => {
        mockManagedEnv = { CLAUDE_CONFIG_DIR: "/managed", COPILOT_OBSIDIAN_CLI: "/cli" };
        await ClaudeBackendDescriptor.readExtensions!({
          settings: settingsFor("claude", { CLAUDE_CONFIG_DIR: "/user" }),
          cwd: "/project",
        });
        const discovered = mockDiscovery.mock.calls[0][0] as ExtensionDiscoveryInput;
        expect(discovered.cwd).toBe("/project");
        expect(discovered.env.CLAUDE_CONFIG_DIR).toBe("/user");
        expect(discovered.env.COPILOT_OBSIDIAN_CLI).toBe("/cli");
      });
    });
  });
});
