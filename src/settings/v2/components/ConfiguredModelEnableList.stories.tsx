import { AgentModelList } from "@/components/ui/AgentModelList";
import type { Meta, StoryObj } from "@/lib/story";
import type React from "react";

type Props = React.ComponentProps<typeof AgentModelList>;
const meta = {
  title: "Agent Mode/Native Agent Model Visibility",
  component: AgentModelList,
  args: {
    agentName: "Scribe",
    defaultOpen: true,
    rows: [
      { id: "manual-model", label: "手动添加的模型", wireId: "custom-model-id", enabled: true },
      { id: "local-model", label: "本地聊天模型", wireId: "local-model", enabled: true },
    ],
    onToggle: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;
export const InheritedChatModels: StoryObj<Props> = {};
export const AllDisabled: StoryObj<Props> = {
  args: { rows: meta.args.rows.map((row) => ({ ...row, enabled: false })) },
};
export const NoConfiguredModels: StoryObj<Props> = { args: { rows: [] } };
