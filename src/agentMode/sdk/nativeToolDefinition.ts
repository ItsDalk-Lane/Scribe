import type { AgentTool } from "@earendil-works/pi-agent-core";
import { compile, type Schema } from "@earendil-works/pi-schema";

export const NATIVE_PERMISSION_OPTIONS = Object.freeze([
  { optionId: "allow_once", name: "Allow once", kind: "allow_once" as const },
  { optionId: "reject_once", name: "Deny", kind: "reject_once" as const },
]);

export function defineNativeTool<S extends Schema>(
  name: string,
  label: string,
  description: string,
  parameters: S,
  execute: AgentTool<S>["execute"]
): AgentTool<S> {
  const validator = compile(parameters);
  return {
    name,
    label,
    description,
    parameters,
    async execute(toolCallId, args, signal, onUpdate) {
      signal?.throwIfAborted();
      if (!validator.check(args)) throw new Error(`Invalid arguments for ${name}.`);
      return execute(toolCallId, args, signal, onUpdate);
    },
  };
}
