import type { ScribeSettings } from "@/settings/model";
import {
  backendDisplayOrder,
  backendRegistry,
  getActiveBackendDescriptor,
  listBackendDescriptors,
  RECOMMENDED_BACKEND_ID,
} from "./registry";
import { NativeBackendDescriptor } from "./native/descriptor";

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
  const baseSettings = (activeBackend?: string): ScribeSettings =>
    ({
      agentMode: {
        enabled: true,
        byok: {},
        activeBackend,
        backends: { native: {} },
      },
    }) as unknown as ScribeSettings;

  describe("getActiveBackendDescriptor()", () => {
    it("returns Scribe when no agent has been selected", () => {
      expect(getActiveBackendDescriptor(baseSettings())).toBe(NativeBackendDescriptor);
    });

    it.each(["native", "claude", "opencode", "codex", "nonexistent"])(
      "returns Scribe for the saved selection %s",
      (id) => {
        expect(getActiveBackendDescriptor(baseSettings(id))).toBe(NativeBackendDescriptor);
      }
    );
  });

  describe("listBackendDescriptors()", () => {
    it("lists only Scribe", () => {
      expect(listBackendDescriptors()).toEqual([NativeBackendDescriptor]);
      expect(Object.keys(backendRegistry)).toEqual(["native"]);
    });
  });

  describe("backendDisplayOrder()", () => {
    it("lists only Scribe", () => {
      expect(backendDisplayOrder()).toEqual([NativeBackendDescriptor]);
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
      expect(RECOMMENDED_BACKEND_ID).toBe("native");
      expect(backendRegistry[RECOMMENDED_BACKEND_ID]).toBe(NativeBackendDescriptor);
    });
  });
});
