import type { Provider } from "@/modelManagement";

export const DEEPSEEK_API_ORIGIN = "https://api.deepseek.com";

export function getDeepSeekSearchCredential(provider: Provider | undefined): string | undefined {
  return /^https:\/\/api\.deepseek\.com(?:\/|$)/i.test(provider?.baseUrl?.trim() ?? "")
    ? provider?.apiKeyRef || undefined
    : undefined;
}

export type WebSearchSource = "builtin" | "mcp" | "skill";

export interface WebSearchMcpSelection {
  serverId: string;
  toolName: string;
  queryParameter: string;
}

export interface WebSearchSettings {
  preferred: WebSearchSource;
  mcp?: WebSearchMcpSelection;
  skill?: string;
}
