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
4. **Historical and compatibility names** (upstream product, retired backends,
   issue-link comments) are listed in the exceptions table and stay as-is.

## Settings page labels (verified against the UI code)

| Level      | zh (shown)                                              | en key                                                                              |
| ---------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Top tab    | 通用                                                    | Common                                                                              |
| Top tab    | 快捷操作                                                | Quick actions                                                                       |
| Top tab    | 代理                                                    | Agents                                                                              |
| Top tab    | 命令                                                    | Commands                                                                            |
| Top tab    | 技能                                                    | Skills                                                                              |
| Top tab    | 子代理                                                  | Subagents                                                                           |
| 通用 →     | 常规 / 自定义说明 / 聊天保存 / 其他 / 调试与支持 / 关于 | General / Custom instructions / Saving chats / Others / Debugging & support / About |
| 快捷操作 → | 模型 / 工具配置 / 我的指令                              | Models / Tool configuration / My commands                                           |
| Button     | 反馈问题                                                | Report an issue                                                                     |

Note: the commands list is configured in **我的指令** (Quick actions), while the
top-level **命令** tab manages the same files' lifecycle — two pages, one store.

## Concept families

### 1. Product identity

| Concept          | zh                        | en               | Notes                                         |
| ---------------- | ------------------------- | ---------------- | --------------------------------------------- |
| The product      | Scribe                    | Scribe           | Never "Scribe V4"; versioning starts at 1.0.0 |
| Upstream project | 上游 Copilot for Obsidian | Obsidian Copilot | History/credit context only                   |

### 2. Runtime / backend / built-in / external

| Concept                 | zh         | en                                      | Notes                                                                        |
| ----------------------- | ---------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| In-process agent        | 原生代理   | native agent                            | The only backend; runs inside Obsidian, desktop-only                         |
| Backend                 | 后端       | backend                                 | Internal term only; never surfaces in UI copy or docs — docs say 代理/Scribe |
| Retired external agents | 旧外部代理 | external agent (OpenCode / Claude Code) | Historical; never imported or continued                                      |

Single-backend leftovers kept as shared infrastructure: the one-item agent tab
list and the "Select your agent" row render one real option — accurate, just
vestigial; simplifying them is a code-budget decision, not a copy fix.

### 3. Agent / session / chat / tab

| Concept            | zh       | en                | Notes                                    |
| ------------------ | -------- | ----------------- | ---------------------------------------- |
| The chat surface   | 代理聊天 | Agent Chat        | Docs anchor name                         |
| Session (internal) | 会话     | session           | Code-level; the UI says 聊天/chat        |
| Tab                | 标签页   | tab               | Per-tab sessions with rename and menus   |
| Fork               | 分叉     | Fork conversation | Starts an independent chat below a reply |

### 4. Project / workspace / scope / vault

| Concept          | zh     | en      | Notes                                                       |
| ---------------- | ------ | ------- | ----------------------------------------------------------- |
| Project          | 项目   | Project | Own instructions, context, history under `scribe/projects/` |
| Vault            | 资料库 | vault   | Obsidian's concept, always "vault" in English               |
| Scope (internal) | 范围   | scope   | Extension visibility: global vs per-project                 |

### 5. Model / provider / credential / config

| Concept                | zh                | en                                      | Notes                                                                                 |
| ---------------------- | ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| Provider               | 供应商            | provider                                | BYOK rows under 快捷操作 → 模型                                                       |
| Credential storage     | 设备钥匙串        | Obsidian Keychain                       | Per-device; never synced with the vault                                               |
| Model catalog          | 模型目录          | provider catalog                        | Directory access ≠ chat verification                                                  |
| Local model            | 本机模型          | local model (Ollama / LM Studio)        |                                                                                       |
| OpenCode model service | OpenCode 模型服务 | OpenCode / OpenCode Zen (`opencode.ai`) | An active BYOK provider — a different concept from the retired external agent backend |

### 6. Tools / skills / commands / prompts / extensions

| Concept              | zh         | en                  | Notes                                            |
| -------------------- | ---------- | ------------------- | ------------------------------------------------ |
| Skill                | 技能       | Skill               | Managed under 技能; per-agent enablement         |
| Custom command       | 自定义指令 | Scribe command      | UI page 我的指令; shared files with the 命令 tab |
| Vault instructions   | 库说明     | vault `AGENTS.md`   | Read when a response starts                      |
| Project instructions | 项目说明   | project `AGENTS.md` | Both files reach the model; no guaranteed winner |
| Extensions           | 扩展       | extensions          | Umbrella for skills, commands, subagents pages   |
| Subagent             | 子代理     | subagent            | Built-in delegation; label fixed from "子Agent"  |

### 7. Permissions / modes / plan / auto

| Concept        | zh           | en                        | Notes                                                        |
| -------------- | ------------ | ------------------------- | ------------------------------------------------------------ |
| Default mode   | 默认         | Default                   | Edits/commands usually need approval                         |
| Plan mode      | 计划         | Plan                      | Blocks edits and commands until approved                     |
| Auto mode      | 自动         | Auto                      | Vault-note edits auto-allowed; config dir and commands never |
| Saved decision | 已保存的决定 | saved permission decision | Same chat + requester + action; outranks Auto                |

### 8. Context / attachments / memory / compaction

| Concept             | zh           | en                      | Notes                                              |
| ------------------- | ------------ | ----------------------- | -------------------------------------------------- |
| One-turn attachment | 一次性附件   | attachment/mention      | Cleared after the next ordinary message            |
| Project source list | 项目来源清单 | initial Project sources | First ordinary message only; capped at 100 entries |
| Compaction          | 压缩         | /compact                | Model summarizes; carries no source list           |

### 9. History / snapshots / notes / index

| Concept           | zh       | en                          | Notes                                                                  |
| ----------------- | -------- | --------------------------- | ---------------------------------------------------------------------- |
| Chat history      | 聊天历史 | Chat history / Recent chats | Search, rename, fork, save as note, copy link, bookmark, delete        |
| Conversation note | 会话笔记 | saved chat note             | Under `scribe-conversations/`; deleting a chat also removes its note   |
| Snapshot          | 快照     | snapshot                    | `agent-chat-snapshots/`, UUID-named, deleted with the chat             |
| Session index     | 会话索引 | agent-chat-index.json       | Entries + tombstones; merged with markdown notes for history           |
| Deep link         | 聊天链接 | `obsidian://scribe-chat`    | Saves the note first, then links; accepts native ids and legacy epochs |

### 10. Install / update / sign-in / version

| Concept                | zh         | en                                     | Notes                                                                        |
| ---------------------- | ---------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| Install                | 安装       | install                                | The Scribe plugin itself only (manual copy or BRAT); never an external agent |
| Sign-in / subscription | —          | —                                      | Does not exist for the native backend; docs say so in eight places           |
| No-model state         | 无可用模型 | error + "configure a chat model first" | Localized since https://github.com/ItsDalk-Lane/Scribe/issues/28             |
| Plugin version         | 插件版本   | Plugin version                         | 通用 → 关于; the settings copy lives there, not at the page top              |

Kept-but-unreachable: the shared install/auth state machine (`absent`, `checking`,
`incompatible`, sign-in cards) exists for the backend contract; the native
descriptor only ever reports `ready` or the no-model error.

### 11. Errors / interruption / recovery / stop

| Concept       | zh       | en              | Notes                                                                |
| ------------- | -------- | --------------- | -------------------------------------------------------------------- |
| Stop          | 停止     | Stop            | Ends the main reply; unanswered prompts auto-deny on abort           |
| Stop task     | 停止任务 | Stop task       | Stops one background task; others keep running                       |
| Interrupted   | 已中断   | Interrupted     | Task state after a restart; never auto-resumes                       |
| Stopped early | 提前停止 | Stopped early:  | Refusal, output limit, step limit, connection error each shown       |
| Restore       | 恢复历史 | restore history | Rebuilds display only; never reruns tools                            |
| Compaction    | 压缩     | /compact        | Five visible states: running, done, failed, cancelled, nothing-to-do |

### 12. Entries / quick ask / commands

| Concept         | zh       | en              | Notes                                              |
| --------------- | -------- | --------------- | -------------------------------------------------- |
| Quick Ask       | 快捷提问 | Quick Ask       | Inline panel; Live Preview only; Quick tools model |
| Quick Command   | 快捷指令 | Quick Command   | Same model default as Quick Ask                    |
| Command palette | 命令面板 | command palette | Obsidian-owned surface                             |

## Exceptions — names kept for history or compatibility

| Name                                                                 | Where                                                                      | Why kept                                                                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| "Copilot for Obsidian"                                               | README credits, issue links, vendored skill headers                        | Upstream attribution and pinned upstream revision                                                                                |
| `scribe-v…` keychain ids, `copilot` internal ids                     | keychainService, app paths                                                 | Persisted external contract; renaming breaks stored data                                                                         |
| OpenCode / Claude in issue-linked comments                           | `src/**` comments with issue URLs                                          | They document why historical code paths exist                                                                                    |
| OpenCode in transport copy                                           | `"OpenCode credentials are missing."` (`providerTransport.ts`)             | Live error for the active OpenCode model service above — the service shares the name with, but is not, the retired agent backend |
| Shared install/auth state-machine branches and their keys            | `AgentModeStatus.tsx`, `installStatus.tsx`, `agentSelectModel.ts`, locales | Backend-contract infrastructure; unreachable for native, never renders                                                           |
| Extension-install copy ("Could not install plugin.", "Installing…"…) | `ExtensionDialogs.tsx`, locales                                            | MCP/plugin extension installs are a real native capability                                                                       |
| "Sign in before enabling this item."                                 | `extensionAvailability.ts`                                                 | MCP-server OAuth prompt, unrelated to agent sign-in                                                                              |
| "Personally installed skills"                                        | `SkillsSettings.tsx`                                                       | User skills vs built-in skills; accurate                                                                                         |
| English control tables in docs/settings.md                           | settings.md tables                                                         | Keys match i18n sources verbatim; translating them is tracked separately                                                         |

## Maintenance

When a label or concept name changes, update this file in the same change and
keep the live label, the locales entry, and the docs reference in one commit.
A name that appears in only one layer is a defect.
