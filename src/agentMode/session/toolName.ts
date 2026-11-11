const NATIVE_PRESENTATION_NAMES: Readonly<Record<string, string>> = Object.freeze({
  read_note: "Read",
  list_directory: "LS",
  find_paths: "Glob",
  search_content: "Grep",
  write_note: "Write",
  edit_note: "Edit",
  run_command: "Bash",
  delegate_task: "Agent",
  ask_user: "AskUserQuestion",
  propose_plan: "ExitPlanMode",
  update_todos: "TodoWrite",
  web_search: "WebSearch",
  fetch_url: "WebFetch",
  invoke_skill: "Skill",
  tool_search: "ToolSearch",
});

export function toolPresentationName(name: string): string {
  return NATIVE_PRESENTATION_NAMES[name] ?? name;
}

export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? { server: m[1], tool: m[2] } : null;
}

export function resolveToolName(name: string): { tool: string; mcpServer?: string } {
  const mcp = parseMcpToolName(name);
  return mcp ? { tool: mcp.tool, mcpServer: mcp.server } : { tool: name };
}
