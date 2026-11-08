import type { SubagentDefinition } from "@/agentMode/subagents/SubagentManager";

export interface SubagentCommandMatch {
  definition: SubagentDefinition;
  prompt: string;
}

const SUBAGENT_COMMAND_PATTERN = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/;

// 名称含空白或斜杠时芯片文本必须仍是单个斜杠命令词，因此回退到格式受控的 id。https://github.com/ItsDalk-Lane/Scribe/issues/54
export function subagentCommandToken(definition: SubagentDefinition): string {
  return /^[^\s/]+$/.test(definition.name) ? definition.name : definition.id;
}

// 光杆 /token 没有可委派的任务文本，必须落回普通对话而不是启动空任务。https://github.com/ItsDalk-Lane/Scribe/issues/54
export function parseSubagentCommand(
  text: string,
  definitions: readonly SubagentDefinition[]
): SubagentCommandMatch | undefined {
  const match = text.trim().match(SUBAGENT_COMMAND_PATTERN);
  if (!match) return undefined;
  const prompt = match[2]?.trim() ?? "";
  if (!prompt) return undefined;
  const definition = definitions.find(
    (entry) => entry.enabled && subagentCommandToken(entry) === match[1]
  );
  return definition ? { definition, prompt } : undefined;
}
