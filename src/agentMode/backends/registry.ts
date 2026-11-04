import type { ScribeSettings } from "@/settings/model";
import { NativeBackendDescriptor } from "./native/descriptor";
import type { BackendDescriptor, BackendId } from "@/agentMode/session/types";

export const backendRegistry: Record<BackendId, BackendDescriptor> = {
  native: NativeBackendDescriptor,
};

export const RECOMMENDED_BACKEND_ID: BackendId = "native";

let displayOrderCache: BackendDescriptor[] | null = null;

export function backendDisplayOrder(): BackendDescriptor[] {
  if (!displayOrderCache) {
    displayOrderCache = [NativeBackendDescriptor];
  }
  return displayOrderCache;
}

export function getActiveBackendDescriptor(settings: ScribeSettings): BackendDescriptor {
  const id = settings.agentMode?.activeBackend ?? "native";
  return backendRegistry[id] ?? NativeBackendDescriptor;
}

export function listBackendDescriptors(): BackendDescriptor[] {
  return Object.values(backendRegistry);
}
