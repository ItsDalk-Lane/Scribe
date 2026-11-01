import type { CopilotSettings } from "@/settings/model";
import { ClaudeBackendDescriptor } from "./claude/descriptor";
import type { BackendDescriptor, BackendId } from "@/agentMode/session/types";

export const backendRegistry: Record<BackendId, BackendDescriptor> = {
  claude: ClaudeBackendDescriptor,
};

export const RECOMMENDED_BACKEND_ID: BackendId = "claude";

let displayOrderCache: BackendDescriptor[] | null = null;

export function backendDisplayOrder(): BackendDescriptor[] {
  if (!displayOrderCache) {
    displayOrderCache = [ClaudeBackendDescriptor];
  }
  return displayOrderCache;
}

export function getActiveBackendDescriptor(settings: CopilotSettings): BackendDescriptor {
  const id = settings.agentMode?.activeBackend ?? "claude";
  return backendRegistry[id] ?? ClaudeBackendDescriptor;
}

export function listBackendDescriptors(): BackendDescriptor[] {
  return Object.values(backendRegistry);
}
