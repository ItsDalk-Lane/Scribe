import type { AgentExtensionItem } from "./extensionInventory";

export interface ExtensionSwitchState {
  checked: boolean;
  disabled: boolean;
  phase?: "checking" | "unknown" | "pending";
  reason?: string;
}

export interface ExtensionDotState {
  enabled: boolean;
  reason?: string;
}

function isAvailabilityChecked(item: AgentExtensionItem): boolean {
  return (
    ["loaded", "loaded_with_errors", "manual_only", "connected"].includes(
      item.availability ?? ""
    ) && !(item.kind === "mcp" && !item.toolCount)
  );
}

export function getExtensionSwitchState(
  item: AgentExtensionItem,
  checking = false
): ExtensionSwitchState {
  const checked = isAvailabilityChecked(item);
  if (checking)
    return { checked, disabled: true, phase: "checking", reason: "Checking availability…" };
  if (
    !item.availability ||
    item.availability === "not_listed" ||
    item.availability === "pending" ||
    (item.kind === "mcp" && item.availability === "connected" && item.toolCount === undefined)
  )
    return {
      checked,
      disabled: true,
      phase: "unknown",
      reason: item.unavailableReason ?? "Availability could not be confirmed. Check again.",
    };
  const owned = item.builtin || item.readOnly || item.parentPluginId || item.source === "runtime";
  const prerequisite =
    item.unavailableReason ??
    (item.availability === "needs-auth"
      ? "Sign in before enabling this item."
      : item.availability === "failed"
        ? "Resolve the loading error before enabling this item."
        : item.kind === "mcp" && item.toolCount === 0
          ? "This server did not expose any callable tools."
          : item.availability === "not_loaded" && item.enabled !== false
            ? "This item could not be loaded in the selected scope."
            : undefined);
  const allowed = checked ? item.canDisable : item.canEnable;
  const disabled = Boolean(
    owned || !item.capabilities?.toggle || allowed === false || (!checked && prerequisite)
  );
  return {
    checked,
    disabled,
    reason:
      prerequisite ??
      (disabled
        ? item.parentPluginId
          ? "Managed by its plugin; it cannot be switched independently."
          : "This item cannot be switched in the selected scope."
        : undefined),
  };
}

// A row shows a switch only when the switch can actually enable or disable the entry; every other entry renders availability as a dot with its reason. https://github.com/ItsDalk-Lane/Scribe/issues/1
export function isExtensionToggleable(item: AgentExtensionItem): boolean {
  if (item.builtin || item.readOnly || item.parentPluginId || item.source === "runtime")
    return false;
  if (!item.capabilities?.toggle) return false;
  if (isAvailabilityChecked(item)) return item.canDisable !== false;
  if (item.canEnable === false) return false;
  return !(
    item.availability === "needs-auth" ||
    item.availability === "failed" ||
    (item.availability === "not_loaded" && item.enabled !== false) ||
    (item.kind === "mcp" && item.toolCount === 0)
  );
}

export function getExtensionDotState(item: AgentExtensionItem): ExtensionDotState {
  if (isAvailabilityChecked(item)) return { enabled: true };
  const reason =
    item.unavailableReason ??
    (item.availability === "needs-auth"
      ? "Sign in before enabling this item."
      : item.availability === "failed"
        ? "Resolve the loading error before enabling this item."
        : item.kind === "mcp" && item.toolCount === 0
          ? "This server did not expose any callable tools."
          : item.availability === "not_loaded" && item.enabled !== false
            ? "This item could not be loaded in the selected scope."
            : item.availability === "disabled" || item.enabled === false
              ? item.parentPluginId
                ? "Its plugin is not enabled in this scope."
                : "This item is disabled in the current configuration."
              : "Availability could not be confirmed. Check again.");
  return { enabled: false, reason };
}
