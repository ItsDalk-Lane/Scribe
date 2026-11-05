# Concept Glossary — authoritative names across layers

Single source of truth for what each core concept is called in code, UI, and docs.
Every layer (source code, interface copy in `src/lib/locales/`, user docs in `docs/`)
must use the names below when referring to the same concept.

## Naming rules

1. **Obsidian-owned UI elements** keep their English names in docs (`Settings`,
   `Community plugins`, `Live Preview`), because they render in Obsidian's own UI.
2. **Scribe-owned UI labels** are referenced by their Chinese label in docs (the
   primary audience), with the English label recorded here. The live labels come
   from `SettingsMainV2.tsx`, `GeneralSettingsTabs.tsx`, `QuickActionsTabs.tsx`, and
   `src/lib/locales/`.
3. **Concept names** (modes, chats, context kinds) use one canonical zh/en pair;
   a label that no longer matches is a bug, fixed with an issue reference (e.g.
   the "Safe" → "Default" rename, https://github.com/ItsDalk-Lane/Scribe/issues/26).
4. **Historical and external names** describe their original objects only. Keep
   a name when an existing external contract requires it or when it identifies
   an explicitly historical source; do not infer automatic migration support.

## Settings page labels (verified against the UI code)

| Level      | zh (shown)                                              | en key                                                                              |
| ---------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Top tab    | 通用                                                    | Common                                                                              |
| Top tab    | 快捷操作                                                | Quick actions                                                                       |
| Top tab    | 代理                                                    | Agents                                                                              |
| Top tab    | 技能                                                    | Skills                                                                              |
| Top tab    | 命令                                                    | Commands                                                                            |
| Top tab    | 子代理                                                  | Subagents                                                                           |
| 通用 →     | 常规 / 自定义说明 / 聊天保存 / 其他 / 调试与支持 / 关于 | General / Custom instructions / Saving chats / Others / Debugging & support / About |
| 快捷操作 → | 模型与供应商 / 工具配置 / 我的指令                      | Models and providers / Tool configuration / My commands                             |
| Button     | 反馈问题                                                | Report an issue                                                                     |

Note: the commands list is configured in **我的指令** (Quick actions), while the
top-level **命令** tab manages the same files' lifecycle — two pages, one store.

## Concept families

Each definition gives the object, what it must not be confused with, its layer,
and its meaning or current limit for users. A definition describes the current
implementation; it is not evidence that every related entry point or failure
case has been verified. Known unfinished behavior is recorded in `BLOCKED.md`.

### 1. Product identity

| Concept (中文 / English)    | What it is and is not                                                       | Layer   | User meaning and current limit                                                                                 |
| --------------------------- | --------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| Scribe / Scribe             | This Obsidian plugin, not a model provider or the upstream project.         | Product | Scribe provides the interface and coordinates requests; models and their providers remain separate.            |
| 上游项目 / upstream project | The project from which Scribe was forked, not the current product identity. | History | The README records attribution and the followed upstream version; history does not establish current behavior. |

Evidence: [README](../README.md), [agent registry](../src/agentMode/backends/registry.ts).

### 2. Runtime / backend / built-in / external

| Concept (中文 / English)            | What it is and is not                                                                                              | Layer                      | User meaning and current limit                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 原生代理 / native agent             | Scribe's agent running in the Obsidian process, not an independently installed agent executable.                   | Runtime                    | The registered agent runs on desktop and uses configured chat models; it does not need a separate agent login.          |
| 后端 / backend                      | The internal interface through which Scribe creates and controls an agent, not a separate user account or service. | Runtime                    | The current registry has one native implementation; a shared interface alone does not establish other available agents. |
| 系统命令任务 / system command task  | A command launched by a tool as an operating-system process, not an external agent backend.                        | Runtime / operating system | A real command process may run when permitted; command tasks must not be treated as obsolete agent processes.           |
| 旧外部代理 / retired external agent | A former external agent integration, not a currently registered Scribe agent or a same-named model service.        | History                    | Old sessions are not evidence of an available agent or automatic continuation.                                          |

Evidence: [agent registry](../src/agentMode/backends/registry.ts), [native descriptor](../src/agentMode/backends/native/descriptor.ts), [command tasks](../src/agentMode/sdk/nativeCommandTasks.ts).

### 3. Agent / session / chat / tab

| Concept (中文 / English) | What it is and is not                                                                                       | Layer               | User meaning and current limit                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 代理 / agent             | Scribe's coordinator for a conversation and its tools, not the model service itself.                        | Runtime             | The model proposes responses and tool calls; Scribe manages the conversation and tool execution.                       |
| 代理聊天 / Agent Chat    | The user-facing conversation surface, not a model provider or a project.                                    | Interface           | A user can start conversations and associate them with a project.                                                      |
| 会话 / session           | Runtime and saved state for a conversation, not its tab or a saved note.                                    | Runtime / storage   | It tracks conversation state and can be represented in history; reopening a view is not a new model request by itself. |
| 标签页 / tab             | A container in the conversation interface, not the underlying session record.                               | Interface           | Tabs help users switch between conversations; closing or displaying a tab is distinct from deleting history.           |
| 分叉 / fork conversation | A new conversation based on an existing assistant reply, not a continuation that reruns earlier tool calls. | Interface / runtime | Later work can diverge while keeping the inherited displayed messages.                                                 |

Evidence: [session manager](../src/agentMode/session/AgentSessionManager.ts), [session snapshots](../src/agentMode/session/AgentSessionSnapshots.ts).

### 4. Project / workspace / scope / vault

| Concept (中文 / English)       | What it is and is not                                                                                             | Layer               | User meaning and current limit                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 资料库 / vault                 | The Obsidian collection of files, not one Scribe project.                                                         | Host / storage      | Projects and ordinary notes can coexist in the same vault.                                                        |
| 项目 / Project                 | A Scribe grouping with its own record, instructions, context choices, and associated chats, not a separate vault. | Storage / interface | It keeps related work together; the project folder is under the configured Scribe projects folder.                |
| 项目工作区 / Project workspace | The folder and focused working context of one project, not Obsidian's window workspace or a security boundary.    | Runtime / storage   | It gives the agent a working location; other accessible locations are not made inaccessible merely by this label. |
| 范围 / scope                   | The global or project association used when selecting some state and extensions, not a filesystem permission.     | Runtime / interface | Project views can differ; actual discovery of project skills is an unresolved limitation in `BLOCKED.md`.         |

Evidence: [Projects guide](../docs/projects.md), [project context builder](../src/context/manifestBuilder.ts), [native extensions](../src/agentMode/backends/native/nativeExtensions.ts).

### 5. Model / provider / credential / config

| Concept (中文 / English)                   | What it is and is not                                                                                  | Layer                     | User meaning and current limit                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 模型 / model                               | A selected model offered through a provider, not the Scribe agent that coordinates it.                 | Provider / runtime        | Its actual capabilities and availability depend on the selected model and connection.                                             |
| 供应商 / provider                          | A configured connection to a model service or endpoint, not the Scribe product.                        | Configuration / provider  | Different providers can expose different models, credentials, and destinations.                                                   |
| 模型目录 / model catalog                   | Shared provider and model metadata obtained from a catalog, not the user's saved or enabled models.    | Data / configuration      | It helps populate choices; appearing in the catalog does not prove access or successful chat.                                     |
| 供应商模型列表 / provider model list       | Models returned by a particular provider endpoint, not the shared catalog or a chat test.              | Provider / configuration  | A successful listing does not establish that a selected model can answer or use tools.                                            |
| 已配置模型 / configured model              | A saved model choice associated with a provider, not proof that the model is enabled or reachable.     | Configuration             | The user can save choices before using them; connection and provider errors may still occur.                                      |
| 已启用模型 / enabled model                 | A configured model selected for an applicable Scribe interface, not every model in the catalog.        | Configuration / interface | Availability depends on the relevant enabled list and other conditions; current readiness checks have known gaps in `BLOCKED.md`. |
| 凭据 / credential                          | A secret or other information used to access a provider, not the provider's display name or a model.   | Configuration / provider  | Some services require a key, while some endpoints do not.                                                                         |
| Obsidian 钥匙串 / Obsidian Keychain        | Obsidian's per-device store for configured secrets, not the shared model catalog or a vault note.      | Host / storage            | Scribe stores references to configured secrets; legacy backup and unknown-field handling still have limitations in `BLOCKED.md`.  |
| 自备密钥 / bring your own key (BYOK)       | The user supplies a provider key, not a name for all model and provider settings.                      | Provider / configuration  | Use the term when a user-supplied key is actually involved; some configured endpoints require no key.                             |
| 本机模型 / local model                     | A model served on the user's machine, not every endpoint that requires no API key.                     | Provider / network        | A remote provider may also accept requests without a key; the destination depends on its configured endpoint.                     |
| 推理强度 / reasoning effort                | The model's supported reasoning-effort selection, not the visible reasoning text or a permission mode. | Model / interface         | The model picker offers only supported choices; this name also applies to its abbreviated Effort label.                           |
| OpenCode 模型服务 / OpenCode model service | A current external model provider, not the retired agent backend that shares its name.                 | Provider                  | The model service remains a provider connection, not an agent installation.                                                       |

Evidence: [catalog download](../src/modelManagement/catalog/CatalogDownloadService.ts), [provider model listing](../src/modelManagement/providers/adapters/listProviderModels.ts), [native models](../src/agentMode/backends/native/nativeModels.ts), [keychain service](../src/services/keychainService.ts).

**模型供应商 / Model provider** is the provider-category label used when no
specific configured provider is identified. It names the model service provider,
not a settings page or a guarantee that a particular destination is known.

### 6. Tools / skills / commands / prompts / extensions

| Concept (中文 / English)         | What it is and is not                                                                                                                    | Layer                   | User meaning and current limit                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工具 / tool                      | An action callable by the agent, not an instruction document or a model response alone.                                                  | Runtime                 | The model proposes a call, Scribe applies its control rules, and the tool performs the action if allowed.                                                 |
| 技能 / skill                     | Reusable instructions and supporting files, not an action executed merely because the skill exists.                                      | Storage / runtime       | A skill can guide an agent or be invoked manually where supported; project discovery and built-in file protection have unresolved limits in `BLOCKED.md`. |
| 内置技能 / built-in skill        | A skill supplied with Scribe, not a guarantee that a user's existing directory is unedited.                                              | Product / storage       | Built-in updates must account for user files; safe repair and update cases remain under investigation in `BLOCKED.md`.                                    |
| 自定义指令 / Scribe command      | A user-managed reusable command stored in Scribe's command files, not an operating-system command.                                       | Storage / interface     | 我的指令 and the 命令 tab manage the same command store from different pages.                                                                             |
| 自定义说明 / custom instructions | User-supplied guidance sent with a request, not a tool or the model provider's system configuration.                                     | Configuration / runtime | It shapes responses without itself executing an action.                                                                                                   |
| 库说明 / vault instructions      | Instructions read from the vault-level `AGENTS.md`, not project-only instructions.                                                       | Storage / runtime       | They can be supplied to the model when an agent response starts.                                                                                          |
| 项目说明 / project instructions  | Project-specific guidance from the project record and working-directory `AGENTS.md`, distinct from vault-level instructions.             | Storage / runtime       | Both sources can reach the model; conflicting guidance has no guaranteed winner, and existing-file conversion is a known data risk in `BLOCKED.md`.       |
| 扩展 / extension                 | An internal grouping for supported items such as skills, commands, and subagents, not proof of a native plugin or MCP installation page. | Runtime / interface     | The native runtime's actual item types and available operations determine what users can manage.                                                          |
| 子代理 / subagent                | A delegated Scribe agent with its own task context, not an externally installed agent or a different provider account.                   | Runtime                 | The current delegated task uses the selected model and permission policy; its result is reported to the requesting agent.                                 |

Evidence: [native prompt assembly](../src/agentMode/backends/native/nativeSystemPrompt.ts), [native extensions](../src/agentMode/backends/native/nativeExtensions.ts), [native tools](../src/agentMode/sdk/nativeTools.ts), [instructions guide](../docs/system-prompts.md).

### 7. Permissions / modes / plan / auto

| Concept (中文 / English)                 | What it is and is not                                                                                                                                      | Layer               | User meaning and current limit                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 权限决定 / permission decision           | A decision on an action requested by a tool, not the model's own proposal.                                                                                 | Runtime / interface | Scribe evaluates the request and may ask the user before the tool carries it out.                                |
| 默认 / Default mode                      | The ordinary permission mode, not an instruction to execute every proposed action.                                                                         | Runtime / interface | Edits and commands can require a decision; an applicable saved decision may already exist.                       |
| 计划 / Plan mode                         | A mode that blocks file changes and commands while active, not a separate agent.                                                                           | Runtime / interface | The agent can propose a plan for approval; the user can also change modes. Read-only work is separate.           |
| 自动 / Auto mode                         | A mode that automatically allows qualifying relative-path edits outside the vault configuration directory, not blanket approval for every tool or command. | Runtime / interface | Other actions use their applicable decision path; this mode is not a filesystem security boundary.               |
| 已保存的决定 / saved permission decision | An allow or deny rule for a particular chat, requester, action kind, and input, not a global permission.                                                   | Runtime / storage   | A matching saved rule is checked before Auto's edit allowance; it can cover a previously approved exact command. |

Evidence: [native permission handling](../src/agentMode/sdk/NativeBackendProcess.ts), [native tools](../src/agentMode/sdk/nativeTools.ts), [mode picker tests](../src/components/ui/ModePicker.test.tsx).

### 8. Context / attachments / memory / compaction

Use **参考内容** for the material users add through Add context, mentions,
attachments, and project source controls. Use **对话上下文** for the conversation
and material available to the model, and **上下文窗口** for its capacity. Adding
reference material and measuring conversation capacity are distinct concepts.

| Concept (中文 / English)                    | What it is and is not                                                                                                       | Layer                 | User meaning and current limit                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 对话上下文 / conversation context           | Messages and supplied material used for a request, not an automatic long-term memory service.                               | Runtime / data flow   | What reaches the model depends on the chat, attachments, project sources, and selected model.                                    |
| 一次性附件 / one-turn attachment or mention | Material or a reference attached to the next ordinary message, not persistent project context.                              | Interface / data flow | It clears after sending; a note or folder mention can provide a path rather than the full contents.                              |
| 当前笔记 / active note                      | A context badge that can follow the active note across messages, not the same lifetime as a one-turn attachment.            | Interface / data flow | The user can remove it; the agent receives the note path and may open the contents as needed.                                    |
| 项目来源清单 / Project source list          | A list of saved project sources supplied with the first ordinary message, not an upload of every source's contents.         | Runtime / data flow   | The list is capped at 100 entries; later changes can produce a notice, and `/compact` does not consume the initial list.         |
| 记忆文件夹 / memory folder                  | A configured Scribe data folder, not proof of an automatic persistent memory capability.                                    | Storage               | The folder's existence alone does not establish that conversations are remembered across chats.                                  |
| 压缩 / compaction (`/compact`)              | A model-generated summary used to continue a conversation, not an archive of all original sources or a project source list. | Runtime / interface   | It has running, completed, failed, cancelled, and nothing-to-do outcomes; it does not by itself prove every detail was retained. |

Evidence: [context guide](../docs/context-and-mentions.md), [project context builder](../src/context/manifestBuilder.ts), [folder settings](../src/settings/scribeFolder.ts), [native process](../src/agentMode/sdk/NativeBackendProcess.ts).

### 9. History / snapshots / notes / index

| Concept (中文 / English)             | What it is and is not                                                                                  | Layer               | User meaning and current limit                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 聊天历史 / chat history              | The interface for finding and managing recorded conversations, not a single storage file.              | Interface / storage | History combines information from stored records and saved notes; available actions depend on the entry.                  |
| 会话笔记 / saved chat note           | A conversation saved as a note in the configured conversations folder, not the complete session index. | Storage             | It is a vault file; deleting a chat can also delete its associated saved note.                                            |
| 会话快照 / session snapshot          | A saved representation of conversation state, not a backup of the vault or its files.                  | Storage             | It helps restore a chat's display and state; deleting the chat removes associated snapshots when that operation succeeds. |
| 会话索引 / session index             | Metadata and deletion markers used to find conversations, not a transcript or conversation note.       | Storage             | It supports history lookup and merging, rather than containing every part of a chat.                                      |
| 原生会话记录 / native session record | The agent's saved session data in per-user application storage, not the optional saved note.           | Runtime / storage   | The record and a saved note serve different persistence paths.                                                            |
| 聊天链接 / chat deep link            | An Obsidian link identifying a saved conversation, not a full independent backup.                      | Interface / storage | The link points to a chat; continued availability depends on the referenced data.                                         |

Evidence: [session index](../src/agentMode/session/AgentSessionIndex.ts), [session snapshots](../src/agentMode/session/AgentSessionSnapshots.ts), [session manager](../src/agentMode/session/AgentSessionManager.ts), [chat links](../src/utils/chatDeepLink.ts).

### 10. Install / update / sign-in / version

| Concept (中文 / English)        | What it is and is not                                                                                            | Layer                     | User meaning and current limit                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 安装 / install                  | Adding the Scribe plugin to Obsidian, not installing a separate agent or model service.                          | Host / product            | Scribe can be installed manually or through BRAT; model setup is a separate step.                                                        |
| 更新 / update                   | Replacing the plugin with a newer build, not proof that all old settings, markers, or files are migrated.        | Host / product            | Current user data and old originals must be protected; known migration and file risks remain in `BLOCKED.md`.                            |
| 登录 / sign-in                  | Authentication to an external service when that service requires it, not a separate Scribe native-agent account. | Provider / host           | A provider may require credentials even though the native agent needs no separate agent login.                                           |
| 插件版本 / plugin version       | The installed Scribe release identifier, not the followed upstream version.                                      | Product / interface       | It is shown under 通用 → 关于; the README records upstream history separately.                                                           |
| 无可用模型 / no available model | A state where an applicable chat model is not usable, not a missing agent installation.                          | Configuration / interface | Configuring and enabling a model is the relevant next step; readiness and missing-credential checks currently have gaps in `BLOCKED.md`. |

Evidence: [README](../README.md), [native descriptor](../src/agentMode/backends/native/descriptor.ts), [native models](../src/agentMode/backends/native/nativeModels.ts), [Projects guide](../docs/projects.md).

### 11. Errors / interruption / recovery / stop

| Concept (中文 / English)   | What it is and is not                                                                                       | Layer               | User meaning and current limit                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 错误 / error               | A reported failure or limitation for a specific operation, not proof that the entire plugin is unavailable. | Runtime / interface | Its cause and a workable next step depend on the failed operation; unresolved misleading states are tracked in `BLOCKED.md`.                     |
| 停止 / Stop                | Cancellation of the current main response, not deletion of the conversation.                                | Interface / runtime | Pending main-agent prompts are withdrawn without approval; a separately running task has its own control.                                        |
| 停止任务 / Stop task       | Cancellation of an individual command task, not the same control as stopping the main response.             | Interface / runtime | Other independent tasks can continue.                                                                                                            |
| 已中断 / Interrupted       | A task state after interruption or restart, not a completed result.                                         | Runtime / interface | Interrupted tasks do not automatically resume after restart.                                                                                     |
| 提前停止 / Stopped early   | A response that ended before ordinary completion, not one uniform cause.                                    | Runtime / interface | The early-stop notice distinguishes refusal, output limits, and step limits; a connection error after partial text may not be shown or restored. |
| 恢复历史 / restore history | Reconstructing a conversation's recorded display and state, not rerunning its historical tool calls.        | Storage / interface | A user can inspect prior messages without replaying the actions shown in them.                                                                   |

Evidence: [session manager](../src/agentMode/session/AgentSessionManager.ts), [command tasks](../src/agentMode/sdk/nativeCommandTasks.ts), [chat message display](../src/agentMode/ui/AgentChatMessages.tsx).

### 12. Entries / quick ask / commands

| Concept (中文 / English)   | What it is and is not                                                                  | Layer            | User meaning and current limit                                                   |
| -------------------------- | -------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| 快捷提问 / Quick Ask       | An inline quick-action entry, not Agent Chat or a separate agent.                      | Interface        | It uses the quick-tools model and is unavailable in Source mode.                 |
| 快捷指令 / Quick Command   | A quick action applied from the editor, not an operating-system command.               | Interface        | It uses the quick-tools model; its availability depends on the editor context.   |
| 命令面板 / command palette | Obsidian's command selection surface, not the Scribe command store.                    | Host / interface | It can expose Scribe actions alongside commands from Obsidian and other plugins. |
| 斜杠菜单 / slash menu      | An in-chat list of eligible Scribe commands and skills, not a general system terminal. | Interface        | Whether an item appears depends on its settings and supported invocation.        |

Evidence: [context guide](../docs/context-and-mentions.md), [slash menu items](../src/components/chat-components/plugins/slashMenuItems.ts), [quick-action guide](../docs/custom-commands.md).

## Retained implementation terms and identifiers

These are observations with the stated scope, not a blanket allowance for other
names, files, or behavior. Unverified reachability is not treated as a feature.

| Name or state                                  | Specific location                                                                                                                                                                                           | Meaning and limit                                                                                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scribe-v…` keychain IDs                       | [keychain service](../src/services/keychainService.ts)                                                                                                                                                      | Current persisted credential references; changing an ID requires preserving access, and the old-key handling risk remains in `BLOCKED.md`.                                                                         |
| `origin.kind = "byok"` and `setup.byok`        | [persisted model types](../src/modelManagement/types/persisted.ts), [setup API](../src/modelManagement/setup/ByokSetupApi.ts)                                                                               | Stable storage and API identifiers for configured provider connections, including endpoints requiring no key. They do not name a user-facing BYOK settings page; that page is 模型与供应商 / Models and providers. |
| Retired persisted agent identifier             | [persisted model types](../src/modelManagement/types/persisted.ts), [agent registry](../src/agentMode/backends/registry.ts)                                                                                 | The saved-data type still permits a retired identifier; it does not register a second agent. Existing settings preservation has unresolved gaps in `BLOCKED.md`.                                                   |
| OpenCode transport message                     | [provider transport](../src/LLMProviders/providerTransport.ts)                                                                                                                                              | Refers to the external model service, not a native or retired agent account.                                                                                                                                       |
| Shared installation and authentication states  | [status view](../src/agentMode/ui/AgentModeStatus.tsx), [install status](../src/agentMode/backends/shared/installStatus.tsx), [selection](../src/agentMode/ui/agentSelectModel.ts)                          | Shared internal states do not establish that corresponding installation or sign-in flows are available for the native agent; individual reachability remains unverified.                                           |
| Extension installation and authentication copy | [extension dialogs](../src/agentMode/ui/ExtensionDialogs.tsx), [availability](../src/agentMode/session/extensionAvailability.ts), [native extensions](../src/agentMode/backends/native/nativeExtensions.ts) | Generic internal states exist; the current native runtime reports no MCP servers or plugins. Individual shared-view reachability remains unverified.                                                               |
| English control tables                         | [settings guide](../docs/settings.md)                                                                                                                                                                       | Some tables contain English source labels; equivalent meaning across all languages has not been established by this glossary alone.                                                                                |

## Maintenance

When a label or concept name changes, update this file in the same change and
keep the live label, the locales entry, and the docs reference in one commit.
A name that appears in only one layer is a defect.
