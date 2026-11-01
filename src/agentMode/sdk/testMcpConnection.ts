import {
  query,
  type Query,
  type McpServerConfig,
  type Options,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { AsyncPushQueue } from "./asyncPushQueue";
import type { AgentMcpConnectionResult } from "@/agentMode/session/extensionManagement";

export interface McpConnectionProbeInput {
  binaryPath: string;
  cwd?: string;
  env: Readonly<Record<string, string | undefined>>;
  name: string;
  config: Record<string, unknown>;
}

export async function testMcpConnection(
  input: McpConnectionProbeInput
): Promise<AgentMcpConnectionResult> {
  const prompts = new AsyncPushQueue<SDKUserMessage>();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  const options: Options = {
    pathToClaudeCodeExecutable: input.binaryPath,
    cwd: input.cwd,
    env: { ...input.env },
    abortController: controller,
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: { [input.name]: input.config as McpServerConfig },
    allowedTools: [],
    canUseTool: async () => ({ behavior: "deny", message: "连接检查不执行业务工具。" }),
  };
  let connection: Query | undefined;
  let consuming: Promise<void> | undefined;
  try {
    connection = query({ prompt: prompts, options });
    const stream = connection;
    consuming = (async () => {
      for await (const message of stream) {
        void message;
      }
    })().catch(() => undefined);
    await connection.initializationResult();
    const server = (await connection.mcpServerStatus()).find((entry) => entry.name === input.name);
    if (!server) return { status: "failed", message: "服务未被识别，请检查连接配置。" };
    return {
      status: server.status === "disabled" ? "failed" : server.status,
      ...(server.tools ? { toolCount: server.tools.length } : {}),
    };
  } catch {
    return {
      status: "failed",
      message: controller.signal.aborted
        ? "连接检查超时。"
        : "连接检查失败，请检查地址、命令或登录状态。",
    };
  } finally {
    window.clearTimeout(timeout);
    prompts.end();
    controller.abort();
    connection?.close();
    await consuming;
  }
}
