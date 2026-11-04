import type { AgentExtensionItem } from "./extensionInventory";
import {
  getExtensionDotState,
  getExtensionSwitchState,
  isExtensionToggleable,
} from "./extensionAvailability";

const item: AgentExtensionItem = {
  id: "review",
  name: "review",
  source: "user",
  kind: "skill",
  capabilities: { edit: true, delete: true, toggle: true },
};

describe("extensionAvailability", () => {
  describe("getExtensionSwitchState", () => {
    it("enables the switch only after availability is confirmed", () => {
      expect(getExtensionSwitchState({ ...item, availability: "loaded" })).toMatchObject({
        checked: true,
        disabled: false,
      });
      expect(getExtensionSwitchState({ ...item, enabled: true })).toMatchObject({
        checked: false,
        disabled: true,
      });
    });
    it("allows a confirmed disabled item to be enabled", () => {
      expect(
        getExtensionSwitchState({ ...item, enabled: false, availability: "disabled" })
      ).toMatchObject({ checked: false, disabled: false });
    });
    it("locks built-in and plugin-owned items without hiding their availability", () => {
      expect(
        getExtensionSwitchState({ ...item, availability: "loaded", builtin: true })
      ).toMatchObject({ checked: true, disabled: true });
      expect(
        getExtensionSwitchState({ ...item, availability: "disabled", parentPluginId: "notes" })
      ).toMatchObject({ checked: false, disabled: true });
    });
    it("keeps unconfirmed and prerequisite-blocked items off their switch", () => {
      expect(getExtensionSwitchState({ ...item, availability: "not_listed" })).toMatchObject({
        disabled: true,
      });
      expect(getExtensionSwitchState({ ...item, availability: "needs-auth" })).toMatchObject({
        checked: false,
        disabled: true,
      });
      expect(
        getExtensionSwitchState({
          ...item,
          availability: "not_loaded",
          unavailableReason: "Installation files are missing.",
        })
      ).toMatchObject({
        checked: false,
        disabled: true,
        reason: "Installation files are missing.",
      });
    });
    it("keeps the last confirmed state while another check is in progress", () => {
      expect(getExtensionSwitchState({ ...item, availability: "loaded" }, true)).toMatchObject({
        checked: true,
        disabled: true,
        phase: "checking",
      });
    });
    it("keeps a loaded plugin enabled when one of its components fails", () => {
      expect(
        getExtensionSwitchState({ ...item, kind: "plugin", availability: "loaded_with_errors" })
      ).toMatchObject({ checked: true, disabled: false });
    });
    it("requires callable tools for a connected MCP server", () => {
      expect(
        getExtensionSwitchState({ ...item, kind: "mcp", availability: "connected" })
      ).toMatchObject({ checked: false, disabled: true });
      expect(
        getExtensionSwitchState({ ...item, kind: "mcp", availability: "connected", toolCount: 0 })
      ).toMatchObject({ checked: false, disabled: true });
    });
  });
  describe("isExtensionToggleable", () => {
    it("allows switching only for entries the user controls in this scope", () => {
      expect(isExtensionToggleable({ ...item, availability: "loaded" })).toBe(true);
      expect(isExtensionToggleable({ ...item, builtin: true })).toBe(false);
      expect(isExtensionToggleable({ ...item, readOnly: true })).toBe(false);
      expect(isExtensionToggleable({ ...item, parentPluginId: "docs" })).toBe(false);
      expect(isExtensionToggleable({ ...item, source: "runtime" })).toBe(false);
      expect(isExtensionToggleable({ ...item, capabilities: undefined })).toBe(false);
      expect(
        isExtensionToggleable({
          ...item,
          capabilities: { edit: true, delete: true, toggle: false },
        })
      ).toBe(false);
    });
    it("renders a dot instead of a switch while connecting, unverifiable, or blocked by a prerequisite", () => {
      expect(isExtensionToggleable({ ...item, availability: "needs-auth" })).toBe(false);
      expect(isExtensionToggleable({ ...item, availability: "failed" })).toBe(false);
      expect(isExtensionToggleable({ ...item, availability: "not_loaded" })).toBe(false);
      expect(isExtensionToggleable({ ...item, availability: "not_listed" })).toBe(false);
      expect(isExtensionToggleable({ ...item, availability: "unconfirmed" })).toBe(false);
      expect(isExtensionToggleable({ ...item, kind: "mcp", availability: "pending" })).toBe(false);
      expect(isExtensionToggleable(item)).toBe(false);
    });
    it("follows the scope rules recorded for the entry", () => {
      expect(isExtensionToggleable({ ...item, availability: "loaded", canDisable: false })).toBe(
        false
      );
      expect(isExtensionToggleable({ ...item, canEnable: false })).toBe(false);
      expect(isExtensionToggleable({ ...item, availability: "disabled", enabled: false })).toBe(
        true
      );
    });
  });
  describe("getExtensionDotState", () => {
    it("marks confirmed entries as enabled without a reason", () => {
      expect(getExtensionDotState({ ...item, availability: "loaded" })).toEqual({ enabled: true });
      expect(
        getExtensionDotState({ ...item, kind: "mcp", availability: "connected", toolCount: 2 })
      ).toEqual({ enabled: true });
    });
    it("explains where a confirmed but non-switchable row is managed instead of rendering nothing", () => {
      expect(getExtensionDotState({ ...item, availability: "loaded", readOnly: true })).toEqual({
        enabled: true,
        informational: true,
        reason: "Read-only; manage at its source",
      });
      expect(getExtensionDotState({ ...item, availability: "loaded", builtin: true })).toEqual({
        enabled: true,
        informational: true,
        reason: "Built-in; managed by its source",
      });
      expect(
        getExtensionDotState({ ...item, availability: "loaded", parentPluginId: "docs" })
      ).toEqual({
        enabled: true,
        informational: true,
        reason: "Managed by its plugin; it cannot be switched independently.",
      });
      expect(getExtensionDotState({ ...item, availability: "loaded", source: "runtime" })).toEqual({
        enabled: true,
        informational: true,
        reason: "Reported by the running session.",
      });
    });
    it("marks a connecting server with the connecting reason instead of a failure", () => {
      expect(getExtensionDotState({ ...item, kind: "mcp", availability: "pending" })).toEqual({
        enabled: false,
        connecting: true,
        reason: "Connecting…",
      });
    });
    it("explains why a plugin-owned entry is unavailable", () => {
      expect(
        getExtensionDotState({ ...item, availability: "disabled", parentPluginId: "docs" })
      ).toEqual({ enabled: false, reason: "Its plugin is not enabled in this scope." });
    });
    it("explains configuration-disabled, scope and prerequisite failures", () => {
      expect(getExtensionDotState({ ...item, availability: "disabled", enabled: false })).toEqual({
        enabled: false,
        reason: "This item is disabled in the current configuration.",
      });
      expect(getExtensionDotState({ ...item, availability: "needs-auth" }).reason).toBe(
        "Sign in before enabling this item."
      );
      expect(getExtensionDotState({ ...item, availability: "failed" }).reason).toBe(
        "Resolve the loading error before enabling this item."
      );
      expect(
        getExtensionDotState({ ...item, kind: "mcp", availability: "connected", toolCount: 0 })
          .reason
      ).toBe("This server did not expose any callable tools.");
      expect(getExtensionDotState({ ...item, availability: "not_loaded" }).reason).toBe(
        "This item could not be loaded in the selected scope."
      );
      expect(
        getExtensionDotState({ ...item, unavailableReason: "Installed plugin files are missing." })
          .reason
      ).toBe("Installed plugin files are missing.");
      expect(getExtensionDotState(item)).toEqual({
        enabled: false,
        reason: "Availability could not be confirmed. Check again.",
      });
      expect(getExtensionDotState({ ...item, availability: "unconfirmed" }).reason).toBe(
        "Availability could not be confirmed. Check again."
      );
    });
  });
});
