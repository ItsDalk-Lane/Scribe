import type { CopilotSettings } from "@/settings/model";
import {
  backendDisplayOrder,
  backendRegistry,
  getActiveBackendDescriptor,
  listBackendDescriptors,
  RECOMMENDED_BACKEND_ID,
} from "./registry";
import { ClaudeBackendDescriptor } from "./claude/descriptor";

jest.mock("@/components/modals/ConfirmModal", () => ({ ConfirmModal: class {} }));
jest.mock("@/components/ui/setting-item", () => ({ SettingItem: () => null }));
jest.mock("@/components/ui/button", () => ({ Button: () => null }));
jest.mock("@/components/ui/input", () => ({ Input: () => null }));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("obsidian", () => ({
  Modal: class {},
  Notice: class {},
  Platform: { isMobile: false },
}));

describe("registry", () => {
  const baseSettings = (activeBackend?: string): CopilotSettings =>
    ({
      agentMode: {
        enabled: true,
        byok: {},
        activeBackend,
        backends: { claude: {} },
      },
    }) as unknown as CopilotSettings;

  describe("getActiveBackendDescriptor()", () => {
    it("returns Claude when no agent has been selected", () => {
      expect(getActiveBackendDescriptor(baseSettings())).toBe(ClaudeBackendDescriptor);
    });

    it.each(["claude", "opencode", "codex", "nonexistent"])(
      "returns Claude for the saved selection %s",
      (id) => {
        expect(getActiveBackendDescriptor(baseSettings(id))).toBe(ClaudeBackendDescriptor);
      }
    );
  });

  describe("listBackendDescriptors()", () => {
    it("lists only Claude", () => {
      expect(listBackendDescriptors()).toEqual([ClaudeBackendDescriptor]);
      expect(Object.keys(backendRegistry)).toEqual(["claude"]);
    });
  });

  describe("backendDisplayOrder()", () => {
    it("lists only Claude", () => {
      expect(backendDisplayOrder()).toEqual([ClaudeBackendDescriptor]);
    });

    it("covers every registered backend exactly once", () => {
      const ids = backendDisplayOrder().map((descriptor) => descriptor.id);
      expect([...ids].sort()).toEqual(Object.keys(backendRegistry).sort());
    });

    it("returns a stable reference across calls", () => {
      expect(backendDisplayOrder()).toBe(backendDisplayOrder());
    });
  });

  describe("RECOMMENDED_BACKEND_ID", () => {
    it("names a registered backend", () => {
      expect(RECOMMENDED_BACKEND_ID).toBe("claude");
      expect(backendRegistry[RECOMMENDED_BACKEND_ID]).toBe(ClaudeBackendDescriptor);
    });
  });
});
