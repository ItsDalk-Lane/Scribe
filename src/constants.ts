import { type ScribeSettings } from "@/settings/model";

export const BREVILABS_API_BASE_URL = "https://api.brevilabs.com/v1";
export const CHAT_AGENT_VIEWTYPE = "scribe-agent-chat-view";
export const AGENT_CHAT_MODE = "agent";
export const PLAN_PREVIEW_VIEW_TYPE = "scribe-plan-preview-view";
export const TURN_DIFF_VIEW_TYPE = "scribe-turn-diff-view";
export const SHARED_VIEW_TYPES = Object.freeze([]);
export const DESKTOP_VIEW_TYPES = [
  ...SHARED_VIEW_TYPES,
  CHAT_AGENT_VIEWTYPE,
  PLAN_PREVIEW_VIEW_TYPE,
] as const;

export const SCRIBE_AGENT_ICON_ID = "scribe-agent";

export const SCRIBE_AGENT_ICON_TRANSFORM = "translate(0 0)";
export const SCRIBE_AGENT_ICON_PATH =
  "M72 10a8 8 0 0 1 11.3 0l6.7 6.7a8 8 0 0 1 0 11.3L39 79 17 84l5-22L72 10zm-3 14L29 64l-2 10 10-2 40-40-8-8zM13 90h74v6H13z";

export const SCRIBE_AGENT_ICON_SVG = `<g transform="${SCRIBE_AGENT_ICON_TRANSFORM}"><path fill="currentColor" d="${SCRIBE_AGENT_ICON_PATH}"/></g>`;

export const USER_SENDER = "user";
export const AI_SENDER = "ai";

export const SCRIBE_FOLDER_ROOT = "scribe";
export const DEFAULT_SCRIBE_FOLDER = SCRIBE_FOLDER_ROOT;
const DEFAULT_CUSTOM_PROMPTS_FOLDER = `${SCRIBE_FOLDER_ROOT}/scribe-custom-prompts`;
const DEFAULT_MEMORY_FOLDER = `${SCRIBE_FOLDER_ROOT}/memory`;
const DEFAULT_PROJECTS_FOLDER = `${SCRIBE_FOLDER_ROOT}/projects`;
export const DEFAULT_SKILLS_FOLDER = `${SCRIBE_FOLDER_ROOT}/skills`;
export const DEFAULT_QA_EXCLUSIONS_SETTING = SCRIBE_FOLDER_ROOT;
export const NOTE_CONTEXT_PROMPT_TAG = "note_context";
export const SELECTED_TEXT_TAG = "selected_text";
export const WEB_SELECTED_TEXT_TAG = "web_selected_text";
export const VARIABLE_TAG = "variable";
export const VARIABLE_NOTE_TAG = "variable_note";
export const WEB_TAB_CONTEXT_TAG = "web_tab_context";
export const ACTIVE_WEB_TAB_CONTEXT_TAG = "active_web_tab";
export const YOUTUBE_VIDEO_CONTEXT_TAG = "youtube_video_context";
export const ACTIVE_WEB_TAB_MARKER = "{activeWebTab}";

export enum ReasoningEffort {
  MINIMAL = "minimal",
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  XHIGH = "xhigh",
}

export const DEFAULT_MAX_OUTPUT_TOKENS = 20_000;

export enum ChatModelProviders {
  OPENROUTERAI = "openrouterai",
  OPENAI = "openai",
  OPENAI_FORMAT = "3rd party (openai-format)",
  ANTHROPIC = "anthropic",
  GOOGLE = "google",
  XAI = "xai",
  GROQ = "groq",
  OLLAMA = "ollama",
  LM_STUDIO = "lm-studio",
  MISTRAL = "mistralai",
  DEEPSEEK = "deepseek",
  COHEREAI = "cohereai",
  SILICONFLOW = "siliconflow",
}

export enum ModelCapability {
  REASONING = "reasoning",
  VISION = "vision",
}

export type Provider = ChatModelProviders;

export type SettingKeyProviders = Exclude<
  ChatModelProviders,
  ChatModelProviders.OPENAI_FORMAT | ChatModelProviders.LM_STUDIO | ChatModelProviders.OLLAMA
>;

export interface ProviderMetadata {
  label: string;
  host: string;
  curlBaseURL: string;
  keyManagementURL: string;
}

export const ProviderInfo: Record<Provider, ProviderMetadata> = {
  [ChatModelProviders.OPENROUTERAI]: {
    label: "OpenRouter",
    host: "https://openrouter.ai/api/v1/",
    curlBaseURL: "https://openrouter.ai/api/v1",
    keyManagementURL: "https://openrouter.ai/keys",
  },
  [ChatModelProviders.GOOGLE]: {
    label: "Gemini",
    host: "https://generativelanguage.googleapis.com",
    curlBaseURL: "https://generativelanguage.googleapis.com/v1beta",
    keyManagementURL: "https://makersuite.google.com/app/apikey",
  },
  [ChatModelProviders.ANTHROPIC]: {
    label: "Anthropic",
    host: "https://api.anthropic.com/",
    curlBaseURL: "https://api.anthropic.com",
    keyManagementURL: "https://console.anthropic.com/settings/keys",
  },
  [ChatModelProviders.OPENAI]: {
    label: "OpenAI",
    host: "https://api.openai.com",
    curlBaseURL: "https://api.openai.com/v1",
    keyManagementURL: "https://platform.openai.com/api-keys",
  },
  [ChatModelProviders.XAI]: {
    label: "XAI",
    host: "https://api.x.ai/v1",
    curlBaseURL: "https://api.x.ai/v1",
    keyManagementURL: "https://console.x.ai",
  },
  [ChatModelProviders.GROQ]: {
    label: "Groq",
    host: "https://api.groq.com/openai",
    curlBaseURL: "https://api.groq.com/openai/v1",
    keyManagementURL: "https://console.groq.com/keys",
  },
  [ChatModelProviders.COHEREAI]: {
    label: "Cohere",
    host: "https://api.cohere.ai/compatibility/v1",
    curlBaseURL: "https://api.cohere.ai/compatibility/v1",
    keyManagementURL: "https://dashboard.cohere.ai/api-keys",
  },
  [ChatModelProviders.SILICONFLOW]: {
    label: "SiliconFlow",
    host: "https://api.siliconflow.com/v1",
    curlBaseURL: "https://api.siliconflow.com/v1",
    keyManagementURL: "https://cloud.siliconflow.com/me/account/ak",
  },
  [ChatModelProviders.OLLAMA]: {
    label: "Ollama",
    host: "http://localhost:11434/v1/",
    curlBaseURL: "http://localhost:11434",
    keyManagementURL: "",
  },
  [ChatModelProviders.LM_STUDIO]: {
    label: "LM Studio",
    host: "http://localhost:1234/v1",
    curlBaseURL: "http://localhost:1234/v1",
    keyManagementURL: "",
  },
  [ChatModelProviders.OPENAI_FORMAT]: {
    label: "OpenAI Format",
    host: "https://api.example.com/v1",
    curlBaseURL: "https://api.example.com/v1",
    keyManagementURL: "",
  },
  [ChatModelProviders.MISTRAL]: {
    label: "Mistral",
    host: "https://api.mistral.ai/v1",
    curlBaseURL: "https://api.mistral.ai/v1",
    keyManagementURL: "https://console.mistral.ai/api-keys",
  },
  [ChatModelProviders.DEEPSEEK]: {
    label: "DeepSeek",
    host: "https://api.deepseek.com/",
    curlBaseURL: "https://api.deepseek.com",
    keyManagementURL: "https://platform.deepseek.com/api-keys",
  },
};

export const ProviderSettingsKeyMap: Record<SettingKeyProviders, keyof ScribeSettings> = {
  anthropic: "anthropicApiKey",
  openai: "openAIApiKey",
  google: "googleApiKey",
  groq: "groqApiKey",
  openrouterai: "openRouterAiApiKey",
  cohereai: "cohereApiKey",
  xai: "xaiApiKey",
  mistralai: "mistralApiKey",
  deepseek: "deepseekApiKey",
  siliconflow: "siliconflowApiKey",
};

export enum DEFAULT_OPEN_AREA {
  EDITOR = "editor",
  VIEW = "view",
}

export enum SEND_SHORTCUT {
  ENTER = "enter",
  SHIFT_ENTER = "shift+enter",
}

export const COMMAND_IDS = {
  TRIGGER_QUICK_COMMAND: "trigger-quick-command",
  CLEAR_SCRIBE_CACHE: "clear-scribe-cache",
  COUNT_WORD_AND_TOKENS_SELECTION: "count-word-and-tokens-selection",
  COUNT_TOTAL_VAULT_TOKENS: "count-total-vault-tokens",
  NEW_AGENT_CHAT: "new-agent-chat",
  OPEN_AGENT_CHAT_WINDOW: "agent-chat-open-window",
  TOGGLE_AGENT_CHAT_WINDOW: "agent-chat-toggle-window",
  ADD_SELECTION_TO_CHAT_CONTEXT: "add-selection-to-chat-context",
  ADD_WEB_SELECTION_TO_CHAT_CONTEXT: "add-web-selection-to-chat-context",
  ADD_CUSTOM_COMMAND: "add-custom-command",
  APPLY_CUSTOM_COMMAND: "apply-custom-command",
  OPEN_LOG_FILE: "open-log-file",
  CLEAR_LOG_FILE: "clear-log-file",
  TRIGGER_QUICK_ASK: "trigger-quick-ask",
  NEXT_DIFF_CHANGE: "turn-diff-next-change",
  PREVIOUS_DIFF_CHANGE: "turn-diff-previous-change",
} as const;

export const COMMAND_NAMES: Record<CommandId, string> = {
  [COMMAND_IDS.TRIGGER_QUICK_COMMAND]: "Trigger quick command",
  [COMMAND_IDS.CLEAR_SCRIBE_CACHE]: "Clear Scribe cache",
  [COMMAND_IDS.COUNT_TOTAL_VAULT_TOKENS]: "Count total tokens in your vault",
  [COMMAND_IDS.COUNT_WORD_AND_TOKENS_SELECTION]: "Count words and tokens in selection",
  [COMMAND_IDS.NEW_AGENT_CHAT]: "New Scribe Agent Chat",
  [COMMAND_IDS.OPEN_AGENT_CHAT_WINDOW]: "Open Scribe Agent Chat window",
  [COMMAND_IDS.TOGGLE_AGENT_CHAT_WINDOW]: "Toggle Scribe Agent Chat window",
  [COMMAND_IDS.ADD_SELECTION_TO_CHAT_CONTEXT]: "Add selection to chat context",
  [COMMAND_IDS.ADD_WEB_SELECTION_TO_CHAT_CONTEXT]: "Add web selection to chat context",
  [COMMAND_IDS.ADD_CUSTOM_COMMAND]: "Add new custom command",
  [COMMAND_IDS.APPLY_CUSTOM_COMMAND]: "Apply custom command",
  [COMMAND_IDS.OPEN_LOG_FILE]: "Open Scribe log file",
  [COMMAND_IDS.CLEAR_LOG_FILE]: "Clear Scribe log file",
  [COMMAND_IDS.TRIGGER_QUICK_ASK]: "Quick Ask",
  [COMMAND_IDS.NEXT_DIFF_CHANGE]: "Go to next change in file diff",
  [COMMAND_IDS.PREVIOUS_DIFF_CHANGE]: "Go to previous change in file diff",
};

export type CommandId = (typeof COMMAND_IDS)[keyof typeof COMMAND_IDS];

export const COMMAND_ICONS: Partial<Record<CommandId, string>> = {
  [COMMAND_IDS.NEW_AGENT_CHAT]: SCRIBE_AGENT_ICON_ID,
  [COMMAND_IDS.OPEN_AGENT_CHAT_WINDOW]: SCRIBE_AGENT_ICON_ID,
  [COMMAND_IDS.TOGGLE_AGENT_CHAT_WINDOW]: SCRIBE_AGENT_ICON_ID,
  [COMMAND_IDS.TRIGGER_QUICK_COMMAND]: "terminal-square",
  [COMMAND_IDS.TRIGGER_QUICK_ASK]: "sparkles",
  [COMMAND_IDS.ADD_SELECTION_TO_CHAT_CONTEXT]: "text-cursor-input",
  [COMMAND_IDS.ADD_WEB_SELECTION_TO_CHAT_CONTEXT]: "globe",
  [COMMAND_IDS.ADD_CUSTOM_COMMAND]: "plus-circle",
  [COMMAND_IDS.APPLY_CUSTOM_COMMAND]: "play-circle",
  [COMMAND_IDS.CLEAR_SCRIBE_CACHE]: "eraser",
  [COMMAND_IDS.COUNT_TOTAL_VAULT_TOKENS]: "calculator",
  [COMMAND_IDS.COUNT_WORD_AND_TOKENS_SELECTION]: "hash",
  [COMMAND_IDS.OPEN_LOG_FILE]: "file-text",
  [COMMAND_IDS.CLEAR_LOG_FILE]: "file-x",
};

export const TEXT_READABLE_EXTENSIONS = ["md", "canvas", "base"];

export const ALLOWED_NOTE_CONTEXT_EXTENSIONS = [...TEXT_READABLE_EXTENSIONS, "pdf"];

export const DEFAULT_SETTINGS: ScribeSettings = {
  openAIApiKey: "",
  openAIOrgId: "",
  huggingfaceApiKey: "",
  cohereApiKey: "",
  anthropicApiKey: "",
  googleApiKey: "",
  openRouterAiApiKey: "",
  xaiApiKey: "",
  mistralApiKey: "",
  deepseekApiKey: "",
  siliconflowApiKey: "",
  defaultModelKey: "",
  userSystemPrompt: "",
  openAIProxyBaseUrl: "",
  scribeFolder: DEFAULT_SCRIBE_FOLDER,
  scribeRootHistory: [],
  autoAttachActiveNote: true,
  defaultOpenArea: DEFAULT_OPEN_AREA.VIEW,
  defaultSendShortcut: SEND_SHORTCUT.ENTER,
  customPromptsFolder: DEFAULT_CUSTOM_PROMPTS_FOLDER,
  qaExclusions: DEFAULT_QA_EXCLUSIONS_SETTING,
  qaInclusions: "",
  debug: false,
  enableInlineCitations: true,
  groqApiKey: "",
  activeModels: [],
  promptUsageTimestamps: {},
  chatHistorySortStrategy: "recent",
  projectsFolder: DEFAULT_PROJECTS_FOLDER,
  inlineEditCommands: [],
  projectList: [],
  memoryFolderName: DEFAULT_MEMORY_FOLDER,
  quickCommandModelKey: undefined,
  quickCommandIncludeNoteContext: true,
  defaultSystemPromptTitle: "",
  agentMode: {
    byok: {},
    activeBackend: "native",
    backends: {},
    debugFullFrames: true,
    notificationSound: true,
    notificationSoundId: "piano",
    welcomeDismissed: false,
    skills: {
      folder: DEFAULT_SKILLS_FOLDER,
    },
  },
  providers: {},
  configuredModels: [],
  backends: {},
};

export const EVENT_NAMES = {
  CHAT_IS_VISIBLE: "chat-is-visible",
  ACTIVE_LEAF_CHANGE: "active-leaf-change",
  ABORT_STREAM: "abort-stream",
  INSERT_TEXT_TO_CHAT: "insert-text-to-chat",
};

export enum ABORT_REASON {
  USER_STOPPED = "user-stopped",
  NEW_CHAT = "new-chat",
  UNMOUNT = "component-unmount",
}
