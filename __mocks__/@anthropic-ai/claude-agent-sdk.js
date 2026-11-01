function query() {
  const iter = (async function* () {})();
  return Object.assign(iter, {
    interrupt: async () => {},
    setModel: async () => {},
    setPermissionMode: async () => {},
    setMaxThinkingTokens: async () => {},
    applyFlagSettings: async () => {},
    initializationResult: async () => ({}),
    supportedCommands: async () => [],
    supportedModels: async () => [],
    supportedAgents: async () => [],
    mcpServerStatus: async () => [],
    getContextUsage: async () => ({}),
    readFile: async () => null,
    reloadPlugins: async () => ({}),
    accountInfo: async () => ({}),
  });
}

function createSdkMcpServer(options) {
  return { type: "sdk", instance: { name: options?.name ?? "mock", tools: options?.tools ?? [] } };
}

function tool(name, description, inputSchema, handler) {
  return { name, description, inputSchema, handler };
}

class AbortError extends Error {}

module.exports = {
  HOOK_EVENTS: [
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PostToolBatch",
    "Notification",
    "UserPromptSubmit",
    "UserPromptExpansion",
    "SessionStart",
    "SessionEnd",
    "Stop",
    "StopFailure",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
    "PostCompact",
    "PreModelSwitch",
    "PostModelSwitch",
    "PermissionRequest",
    "PermissionDenied",
    "Setup",
    "TeammateIdle",
    "TaskCreated",
    "TaskCompleted",
    "Elicitation",
    "ElicitationResult",
    "ConfigChange",
    "WorktreeCreate",
    "WorktreeRemove",
    "InstructionsLoaded",
    "CwdChanged",
    "FileChanged",
    "DirectoryAdded",
    "MessageDisplay",
  ],
  query,
  createSdkMcpServer,
  tool,
  AbortError,
};
