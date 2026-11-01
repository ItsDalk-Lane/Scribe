// 协议聊天地址不一定提供模型目录；凭据验证必须请求真正的目录接口。https://github.com/logancyang/obsidian-copilot/issues/3147
const MODEL_LIST_URLS: ReadonlyMap<string, string> = new Map([
  ["https://opencode.ai/inference/go/openai/v1", "https://opencode.ai/inference/go/v1/models"],
  ["https://opencode.ai/inference/openai/v1", "https://opencode.ai/inference/v1/models"],
]);

export function openaiCompatibleModelsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return MODEL_LIST_URLS.get(base) ?? `${base}/models`;
}
