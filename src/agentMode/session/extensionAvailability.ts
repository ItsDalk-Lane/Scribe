import type { AgentExtensionItem } from "./extensionInventory";

export interface ExtensionSwitchState {
  checked: boolean;
  disabled: boolean;
  phase?: "checking" | "pending";
  reason?: string;
}

export interface ExtensionDotState {
  enabled: boolean;
  connecting?: boolean;
  informational?: boolean;
  reason?: string;
}

function isAvailabilityChecked(item: AgentExtensionItem): boolean {
  return (
    ["loaded", "loaded_with_errors", "manual_only", "connected"].includes(
      item.availability ?? ""
    ) && !(item.kind === "mcp" && !item.toolCount)
  );
}

interface DotRendering {
  connecting?: boolean;
  reason: string;
}

function dotRendering(item: AgentExtensionItem): DotRendering | null {
  if (item.availability === "pending") return { connecting: true, reason: "Connecting…" };
  if (item.kind === "mcp" && item.availability === "connected" && !item.toolCount)
    return {
      reason:
        item.toolCount === 0
          ? "This server did not expose any callable tools."
          : "Availability could not be confirmed. Check again.",
    };
  if (item.availability === "needs-auth") return { reason: "Sign in before enabling this item." };
  if (item.availability === "failed")
    return { reason: "Resolve the loading error before enabling this item." };
  if (item.availability === "not_loaded" && item.enabled !== false)
    return {
      reason: item.unavailableReason ?? "This item could not be loaded in the selected scope.",
    };
  if (
    !item.availability ||
    item.availability === "not_listed" ||
    item.availability === "unconfirmed"
  )
    return {
      reason: item.unavailableReason ?? "Availability could not be confirmed. Check again.",
    };
  return null;
}

export function getExtensionSwitchState(
  item: AgentExtensionItem,
  checking = false
): ExtensionSwitchState {
  const checked = isAvailabilityChecked(item);
  if (checking)
    return { checked, disabled: true, phase: "checking", reason: "Checking availability…" };
  const blocked = dotRendering(item);
  const owned = item.builtin || item.readOnly || item.parentPluginId || item.source === "runtime";
  const allowed = checked ? item.canDisable : item.canEnable;
  const disabled = Boolean(blocked || owned || !item.capabilities?.toggle || allowed === false);
  return {
    checked,
    disabled,
    reason:
      blocked?.reason ??
      item.unavailableReason ??
      (disabled
        ? item.parentPluginId
          ? "Managed by its plugin; it cannot be switched independently."
          : "This item cannot be switched in the selected scope."
        : undefined),
  };
}

export function isExtensionToggleable(item: AgentExtensionItem): boolean {
  if (item.builtin || item.readOnly || item.parentPluginId || item.source === "runtime")
    return false;
  if (!item.capabilities?.toggle) return false;
  if (dotRendering(item)) return false;
  if (isAvailabilityChecked(item)) return item.canDisable !== false;
  return item.canEnable !== false;
}

export function getExtensionDotState(item: AgentExtensionItem): ExtensionDotState {
  if (item.availability === "disabled" || item.enabled === false)
    return {
      enabled: false,
      reason: item.parentPluginId
        ? "Its plugin is not enabled in this scope."
        : "This item is disabled in the current configuration.",
    };
  const dot = dotRendering(item);
  if (dot) return { enabled: false, connecting: dot.connecting, reason: dot.reason };
  if (isAvailabilityChecked(item)) {
    if (isExtensionToggleable(item)) return { enabled: true };
    return {
      enabled: true,
      informational: true,
      reason: item.parentPluginId
        ? "Managed by its plugin; it cannot be switched independently."
        : item.builtin
          ? "Built-in; managed by its source"
          : item.source === "runtime"
            ? "Reported by the running session."
            : "Read-only; manage at its source",
    };
  }
  return {
    enabled: false,
    reason: "Availability could not be confirmed. Check again.",
  };
}
