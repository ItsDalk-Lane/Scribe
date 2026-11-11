import type { AgentTool, ToolExecutionMode } from "@earendil-works/pi-agent-core";
import { compile, type Schema } from "@earendil-works/pi-schema";
import type { AgentToolKind } from "@/agentMode/session/types";

export interface NativeToolPolicy {
  kind: AgentToolKind;
  skillAuthoring?: boolean;
  executionMode?: ToolExecutionMode;
}

// 内部归属随工具副本保留，但不进入模型声明；未知扩展不能据此获得内置工具豁免。https://github.com/ItsDalk-Lane/Scribe/issues/70
const NATIVE_TOOL_POLICY = Symbol("Scribe native tool policy");

export function getNativeToolPolicy(tool: AgentTool): NativeToolPolicy | undefined {
  return (tool as AgentTool & { [NATIVE_TOOL_POLICY]?: NativeToolPolicy })[NATIVE_TOOL_POLICY];
}

export const NATIVE_PERMISSION_OPTIONS = Object.freeze([
  { optionId: "allow_once", name: "Allow once", kind: "allow_once" as const },
  { optionId: "reject_once", name: "Deny", kind: "reject_once" as const },
]);

export function defineNativeTool<S extends Schema>(
  name: string,
  label: string,
  description: string,
  parameters: S,
  execute: AgentTool<S>["execute"],
  policy?: NativeToolPolicy
): AgentTool<S> {
  const validator = compile(parameters);
  return {
    name,
    label,
    description,
    parameters,
    ...(policy
      ? {
          [NATIVE_TOOL_POLICY]: Object.freeze({
            kind: policy.kind,
            skillAuthoring: policy.skillAuthoring ?? false,
          }),
        }
      : {}),
    // 只读类允许复用依赖的并发调度，其余默认顺序，避免写操作无意并行。https://github.com/ItsDalk-Lane/Scribe/issues/70
    executionMode:
      policy?.executionMode ??
      (policy && ["read", "search", "fetch"].includes(policy.kind) ? "parallel" : "sequential"),
    async execute(toolCallId, args, signal, onUpdate) {
      signal?.throwIfAborted();
      // 字段级错误让模型修正具体参数，保留原校验约束而不回显用户正文。https://github.com/ItsDalk-Lane/Scribe/issues/70
      if (!validator.check(args))
        throw new Error(
          `Invalid arguments for ${name}:\n${validator
            .errors(args)
            .map((error) => `${error.path || "/"}: ${error.message}`)
            .join("\n")}`
        );
      return execute(toolCallId, args, signal, onUpdate);
    },
  };
}
