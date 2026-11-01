import { t } from "@/lib/i18n";
import type { InstallState } from "@/agentMode/session/types";
import { compareSemver, parseSemver } from "@/utils/semver";

export type BinaryInspection =
  | { kind: "absent" }
  | { kind: "error"; message: string }
  | { kind: "installed"; version: string; source: "managed" | "custom" };

export function classifyBinaryInstall(
  inspection: BinaryInspection,
  minimumVersion: string,
  displayName: string
): InstallState {
  if (inspection.kind !== "installed") return inspection;
  const parsed = parseSemver(inspection.version);
  if (!parsed || !parseSemver(minimumVersion)) {
    return {
      kind: "error",
      message: t("{p0} has invalid version metadata. Configure a valid installation.", {
        p0: displayName,
      }),
    };
  }
  const order = compareSemver(inspection.version, minimumVersion);
  // Prereleases of the minimum do not guarantee its stable protocol contract. https://github.com/Brevilabs/obsidian-copilot-private/issues/535
  if (order < 0 || (order === 0 && parsed.prerelease !== undefined)) {
    return {
      kind: "incompatible",
      source: inspection.source,
      currentVersion: inspection.version,
      minVersion: minimumVersion,
      message: t("{p0} v{p1} is not supported. Scribe requires {p2} v{p3} or newer.", {
        p0: displayName,
        p1: inspection.version,
        p2: displayName,
        p3: minimumVersion,
      }),
    };
  }
  return { kind: "ready", source: inspection.source };
}

export function assertBinaryCompatible(
  inspection: BinaryInspection,
  minimumVersion: string,
  displayName: string
): void {
  const state = classifyBinaryInstall(inspection, minimumVersion, displayName);
  if (state.kind !== "ready")
    throw new Error(
      "message" in state
        ? state.message
        : t("{p0} is not installed. Configure an installation.", { p0: displayName })
    );
}
