import {
  RequestContextPreviewView,
  type RequestContextPreviewViewProps,
} from "@/agentMode/ui/RequestContextPreview";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Request Context Preview",
  component: RequestContextPreviewView,
  args: { onClose: () => {} },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<RequestContextPreviewViewProps>;
export default meta;
type Story = StoryObj<RequestContextPreviewViewProps>;
export const Recorded: Story = {
  args: {
    preview: {
      requestId: "request-2026-11-10-001",
      modelId: "configured-model",
      provider: "My provider",
      content: JSON.stringify(
        {
          messages: [
            {
              role: "system",
              content: "Use the current project rules and preserve existing notes.",
            },
            { role: "user", content: "当前项目资料：会议记录、采访摘要。替代之前的资料声明。" },
            { role: "user", content: "请按项目要求整理这份会议记录。" },
          ],
          tools: [
            {
              name: "read_note",
              description: "Read a note",
              parameters: { type: "object", properties: { path: { type: "string" } } },
            },
          ],
        },
        null,
        2
      ),
    },
  },
};
export const Empty: Story = {};
export const Loading: Story = { args: { loading: true } };
export const Failed: Story = {
  args: { error: "保存的请求内容不完整或已损坏，无法展示当时的输入。" },
};
export const LongRecorded: Story = {
  args: {
    preview: {
      requestId: "request-with-a-long-stable-identifier-2026-11-10-001",
      modelId: "provider-model-with-a-long-name",
      provider: "Configured provider",
      content: JSON.stringify(
        { messages: [{ role: "system", content: "请保留用户原始要求和资料出处。".repeat(100) }] },
        null,
        2
      ),
    },
  },
};
