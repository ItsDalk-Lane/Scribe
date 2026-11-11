import React, { useState } from "react";
import { ActionCard } from "@/agentMode/ui/ActionCard";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { Meta, StoryObj } from "@/lib/story";

type Props = React.ComponentProps<typeof ActionCard>;
const sample: ToolCallPart = {
  kind: "tool_call",
  id: "search",
  title: "Search notes",
  vendorToolName: "mcp__library__search",
  mcpServer: "library",
  status: "completed",
  input: '{"id":900719925474099312345,"query":"原始搜索条件"}',
  output: [
    {
      type: "text",
      text: "# 搜索结果\n\n| 标题 | 分数 |\n| --- | --- |\n| 资料一 | 98 |\n\n- 完整返回正文\n- 不改写模型内容",
    },
  ],
};
const meta = {
  title: "Agent Mode/Tool Input and Output",
  component: ActionCard,
  args: { part: sample, open: true, onToggle: () => undefined },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;
export const Complete: StoryObj<Props> = {};
export const StringWrappedJson: StoryObj<Props> = {
  args: {
    part: {
      ...sample,
      output: [
        {
          type: "text",
          text: JSON.stringify(
            '[{"title":"Obsidian","id":900719925474099312345,"url":"https://obsidian.md","details":"{\\"kept\\":true}"}]'
          ),
        },
      ],
    },
  },
};
export const Running: StoryObj<Props> = {
  args: {
    part: {
      ...sample,
      vendorToolName: "search_content",
      mcpServer: undefined,
      title: "search_content",
      input: { query: "会议记录" },
      status: "in_progress",
      output: [],
    },
  },
};
export const RunningWebpage: StoryObj<Props> = {
  args: {
    part: {
      ...sample,
      vendorToolName: "fetch_url",
      mcpServer: undefined,
      title: "fetch_url",
      input: { url: "https://example.com/report" },
      status: "in_progress",
      output: [],
    },
  },
};
export const RunningMcpWebSearch: StoryObj<Props> = {
  args: {
    part: {
      ...sample,
      vendorToolName: "mcp__research__web_search_extra",
      mcpServer: "research",
      title: "web_search_extra",
      input: { query: "公开资料" },
      status: "in_progress",
      output: [],
    },
  },
};
export const RunningChildTool: StoryObj<Props> = {
  args: {
    part: {
      ...sample,
      vendorToolName: "list_directory",
      mcpServer: undefined,
      title: "list_directory",
      input: { path: "资料" },
      parentToolCallId: "research-child",
      status: "in_progress",
      output: [],
    },
  },
};
export const Waiting: StoryObj<Props> = {
  args: { part: { ...sample, status: "pending", output: [] } },
};
export const Failed: StoryObj<Props> = {
  args: {
    part: {
      ...sample,
      status: "failed",
      output: [{ type: "text", text: "连接失败：服务未响应。" }],
    },
  },
};
export const Cancelled: StoryObj<Props> = { args: { part: { ...sample, status: "cancelled" } } };
export const Diff: StoryObj<Props> = {
  args: {
    part: {
      ...sample,
      output: [{ type: "diff", path: "笔记.md", oldText: "旧正文", newText: "新正文" }],
    },
  },
};
export const MixedContent: StoryObj<Props> = {
  args: {
    part: {
      ...sample,
      output: [
        { type: "text", text: "原始纯文本\n第二行" },
        {
          type: "content",
          content: {
            type: "json",
            name: "structuredContent",
            text: '{"nested":{"id":900719925474099312345,"count":3}}',
          },
        },
        {
          type: "content",
          content: {
            type: "image",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=",
            mimeType: "image/png",
          },
        },
        {
          type: "content",
          content: {
            type: "resource_link",
            name: "完整参考资料",
            uri: "https://example.com/report",
            description: "按服务器原始地址展示",
          },
        },
        {
          type: "content",
          content: {
            type: "resource",
            resource: {
              uri: "mcp://report",
              mimeType: "text/markdown",
              text: "## 嵌入资源\n\n**完整原文**\n\n- 一\n- 二",
            },
          },
        },
        { type: "diff", path: "笔记.md", oldText: "旧正文", newText: "新正文" },
      ],
    },
  },
};
export const LongResult: StoryObj<Props> = {
  args: {
    part: {
      ...sample,
      output: [
        {
          type: "text",
          text: "完整结果，保持全部原文。\n".repeat(10_000) + "最后一行：完整结束。",
        },
      ],
    },
  },
};
export const Interactive: StoryObj<Props> = {
  render: function InteractiveCard() {
    const [open, setOpen] = useState(false);
    return <ActionCard part={sample} open={open} onToggle={() => setOpen((value) => !value)} />;
  },
};
