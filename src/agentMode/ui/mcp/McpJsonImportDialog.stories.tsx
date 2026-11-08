import type { Meta, StoryObj } from "@/lib/story";
import { McpJsonImportContent, type McpJsonImportContentProps } from "./McpJsonImportDialog";

const sample = JSON.stringify(
  {
    mcpServers: {
      search: {
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer example-key" },
      },
    },
  },
  null,
  2
);

const meta = {
  title: "Modal/MCP JSON import",
  component: McpJsonImportContent,
  args: {
    existingNames: new Set<string>(),
    onImport: async () => undefined,
    onClose: () => undefined,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<McpJsonImportContentProps>;
export default meta;

export const Empty: StoryObj<McpJsonImportContentProps> = {};
export const ReadyWithCredential: StoryObj<McpJsonImportContentProps> = {
  args: { initialText: sample },
};
export const Duplicate: StoryObj<McpJsonImportContentProps> = {
  args: { initialText: sample, existingNames: new Set(["search"]) },
};
export const InvalidEndpoint: StoryObj<McpJsonImportContentProps> = {
  args: { initialText: '{"mcpServers":{"search":{"type":"http","url":"invalid"}}}' },
};
export const SaveFailure: StoryObj<McpJsonImportContentProps> = {
  args: {
    initialText: sample,
    onImport: async () => {
      throw new Error("synthetic save failure");
    },
  },
};
