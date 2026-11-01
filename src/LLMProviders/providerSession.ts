import type { CustomModel } from "@/aiParams";
import { v4 as uuidv4 } from "uuid";

interface ProviderSessionOptions {
  options: {
    headers: Record<string, string>;
  };
}

const sessions = new WeakMap<object, string>();

export function getProviderSessionOptions(
  model: Pick<CustomModel, "provider" | "baseUrl"> | null,
  owner: object
): ProviderSessionOptions | undefined {
  // Go 要求每段对话携带稳定的会话标识，自定义代理不应收到其专用头。https://github.com/anomalyco/opencode/issues/47756
  let endpoint: URL;
  try {
    endpoint = new URL(model?.baseUrl?.trim() ?? "");
  } catch {
    return undefined;
  }
  if (
    endpoint.origin !== "https://opencode.ai" ||
    !endpoint.pathname.startsWith("/inference/go/")
  ) {
    return undefined;
  }

  let sessionId = sessions.get(owner);
  if (!sessionId) {
    sessionId = uuidv4();
    sessions.set(owner, sessionId);
  }

  return {
    options: {
      headers: {
        "User-Agent": "obsidian-scribe/4",
        "x-opencode-session": sessionId,
      },
    },
  };
}

export function resetProviderSession(owner: object): void {
  sessions.delete(owner);
}
