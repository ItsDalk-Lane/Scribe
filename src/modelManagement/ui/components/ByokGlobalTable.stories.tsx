import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import { ModelManagementProvider } from "@/modelManagement/ui/ModelManagementContext";
import { ByokGlobalTable, type ByokTableGroup } from "./ByokGlobalTable";

const group: ByokTableGroup = {
  provider: {
    providerId: "preview-provider",
    providerType: "openai-compatible",
    displayName: "项目自备模型 · 长名称与连接状态预览",
    origin: { kind: "byok" },
    addedAt: 0,
    requiresApiKey: true,
  },
  verification: { ok: true, checkedAt: 0 },
  models: [
    {
      configuredModelId: "preview-model",
      providerId: "preview-provider",
      info: {
        id: "reasoning-model",
        displayName: "Long context reasoning model for project notes",
      },
      configuredAt: 0,
    },
  ],
};
const api = {
  coordinator: { removeConfiguredModel: async () => undefined },
} as unknown as ModelManagementApi;
type Props = React.ComponentProps<typeof ByokGlobalTable>;
const meta = {
  title: "Settings/Provider List",
  component: ByokGlobalTable,
  args: { groups: [group], onConfigure: () => {}, onRemove: () => {} },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

export const Providers: StoryObj<Props> = {
  render: (args) => (
    <ModelManagementProvider api={api}>
      <ByokGlobalTable {...meta.args} {...args} />
    </ModelManagementProvider>
  ),
};
export const ConnectionFailed: StoryObj<Props> = {
  ...Providers,
  args: {
    groups: [
      {
        ...group,
        verification: { ok: false, message: "请检查服务地址和账号配置。", checkedAt: 0 },
      },
    ],
  },
};
export const Empty: StoryObj<Props> = { args: { groups: [] } };
