import type { Provider } from "@/modelManagement/types/persisted";

export function isProviderModelsEnabled(provider: Provider | undefined): boolean {
  // 缺省字段视为包含，保证旧数据和新建供应商无需迁移即出现在选择器中。https://github.com/ItsDalk-Lane/Scribe/issues/69
  return provider?.enabled !== false;
}
