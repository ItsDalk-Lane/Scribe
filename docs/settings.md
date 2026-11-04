# Scribe Settings

Open **Settings → Scribe** to configure Scribe. Settings normally save as soon as you change them. Controls labeled **应用** or **保存** are the exceptions.

Scribe includes [Agent Chat](agent-mode-and-tools.md). Quick Ask and Quick Command remain available for inline questions and edits on desktop and mobile. Agent Chat, its 代理 settings, and Skills require desktop Obsidian.

> **Choose your data route deliberately.** Your selected model provider receives the context needed for a request; enabled network tools can contact their target services. Use local models and local tools when that work should stay on your computer, and review the agent's available network tools.

The **通用 → 关于** section has two controls:

| Control            | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **插件版本**       | Shows the installed Scribe version.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Reset settings** | Restores non-credential preferences to their defaults after confirmation. It keeps API keys, credential-bearing provider rows and their models, and the history of Scribe folders. Keyless provider rows, including local ones, and their models are reset. The 代理 page's model enablement is also reset, so you may need to enable models again there. Reset does not delete `AGENTS.md`, saved chats, commands, or skills. To erase credentials, use **通用 → 其他 → API key storage → Delete All Keys**. |

## 通用

**通用** 合并原来的基本设置与高级设置，包含 **常规、自定义说明、聊天保存、其他、调试与支持、关于** 六个子标签。切换子标签不会更改已保存的配置。Scribe 代理的模型启用、默认选择与权限设置位于独立的 **代理** 页。

### 常规

| Control               | Default    | What it does                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **插件打开位置**      | **侧边栏** | Chooses whether Scribe opens in a sidebar leaf or an editor tab. Options are **侧边栏** and **编辑区**.                                                                                                                                                                                                                                                                        |
| **发送快捷键**        | **Enter**  | Chooses **Enter** or **Shift + Enter** to send. If the shortcut does not work, check **Obsidian → Hotkeys** for a conflict.                                                                                                                                                                                                                                                    |
| **自动附加当前笔记**  | On         | Attaches the active note to each new Agent Chat. Turn it off to add the **当前笔记** yourself from **添加参考内容** or with `@`.                                                                                                                                                                                                                                               |
| **Scribe 文件夹位置** | `scribe`   | Sets the root for conversations, custom prompts, skills, and projects. Press Enter or select **应用** to validate and confirm the change. Folder names can't start with a dot, because Obsidian hides those folders. If your folder was hidden, such as `.scribe`, Scribe moves it to the same name without the dot when it starts. The folder button reveals the active root. |

Changing the Scribe folder does not move existing files. The old root remains treated as Scribe data, and a new root that already contains notes becomes excluded from Scribe search. Move files yourself after the change. Scribe applies the new root to its own search results immediately.

### 自定义说明

| Control            | Default           | What it does                                                                                                                                                                                                      |
| ------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **库的自定义说明** | Blank `AGENTS.md` | Edits the root `AGENTS.md` used by Agent Chat. Text saves automatically after a short delay. **打开 AGENTS.md** closes settings and opens the file as a note. Start a new Agent Chat after changing instructions. |

Empty instruction fields show a fixed example until you type.

See [`AGENTS.md` examples](agents-md-examples.md) and [Projects](projects.md) for project-specific instructions.

### 聊天保存

| Control                       | Default                    | What it does                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **自动将聊天保存为 Markdown** | On                         | Writes a Markdown conversation note after each user message and response under `<Scribe folder>/scribe-conversations/`. Turning it off skips the note until you save the chat or select **复制聊天链接**. Agent Chat sessions still appear in **最近聊天**.                                                                           |
| **聊天笔记名称模板**          | `{$topic}@{$date}_{$time}` | Expand the disclosure, edit the template, then select **应用**. It controls automatic and manual conversation-note names. The template must contain `{$topic}`, `{$date}`, and `{$time}` and cannot add backslashes, slashes, colons, asterisks, question marks, quotes, angle brackets, or vertical bars outside those placeholders. |

### 其他

在 **通用 → 其他** 中查看和管理密钥存储。

| Control          | Default                                         | What it does                                                                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **API 密钥存储** | **Obsidian 钥匙串** on Obsidian 1.11.4 or newer | Reports whether secure storage is available and whether this device appears to have keys. Each device has a separate Keychain, so vault sync does not copy credentials. Older Obsidian builds cannot load, save, or delete Keychain entries.                 |
| **删除所有密钥** | Not applicable                                  | After confirmation, removes Scribe API keys from the Obsidian Keychain, `data.json`, and in-memory settings. You must enter them again. Credential backup files created during an earlier migration are left in place for you to review and delete manually. |

### 调试与支持

在 **通用 → 调试与支持** 中查看诊断与反馈选项。

One place to report a problem, plus the switches for the two logs a report can carry.

| Control                      | Default        | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **反馈问题**                 | Not applicable | Desktop-only, in two pages. First, describe what went wrong and tick which attachments to include; then review what was actually packed into a single zip and upload it. Scribe uploads that zip privately and opens a prefilled GitHub issue carrying only the report ID. Nothing leaves this device until you choose to upload, and nothing on the issue itself can download the bundle.                                                              |
| **在代理聊天中提供反馈报告** | On             | When Scribe itself fails in Agent Chat, such as a Scribe tool erroring or a needed tool missing, the agent can draft a bug report as a card in the chat. The agent's own mistakes and answers don't get a card. A reply that fails with an error gets the same card. **查看并反馈** opens **反馈问题** with the draft filled in; nothing is sent unless you upload it. Turn this off, or press **不再提示** on a card, to stop the agent from offering. |
| **调试模式**                 | Off            | Logs Quick tools activity to **View → Toggle Developer Tools**. Turn it on and reproduce the problem before you report an issue, so the Scribe log a report collects actually contains it. It does not control the Agent Mode activity log below.                                                                                                                                                                                                       |
| **代理活动日志**             | On             | Enables the activity-log attachment when a log is available; it does not guarantee the current native agent writes recent activity to that log. An existing log may contain prompts, note contents, and tool inputs or outputs. It is plain text on this device outside the vault. **打开** shows the log file and **清空** deletes it; both are desktop-only. Review any log before sharing it.                                                        |

The Scribe log can still be saved by hand whenever you want it: run **Scribe: Open Scribe log file** from the command palette to write it into your vault as a note and open it.

See [Troubleshooting and FAQ](troubleshooting-and-faq.md) before sharing logs or filing an issue.

## 快捷操作

**快捷操作** 把日常最常用的配置集中在一个标签页，包含 **模型、工具配置、我的指令** 三个子标签。原顶级的 **模型** 标签页，以及原 **通用** 中的 **快捷工具** 子标签，都已移动到这里；**快捷工具** 更名为 **工具配置**，其中与“我的指令”相关的配置独立为 **我的指令** 子标签。

### 模型

**模型** 子标签管理自备密钥（BYOK）的模型。Bring Your Own Key connects Scribe directly to a model provider, compatible gateway, Ollama, LM Studio, or another OpenAI-compatible endpoint. Cloud-provider billing and data handling belong to that provider.

#### Add a provider

1. Select **添加服务商**.
2. Search or choose from **推荐** providers, **Self-host** templates for Ollama and LM Studio, the dynamic **更多服务商** catalog, or **添加自定义服务商**.
3. Complete the configuration and select at least one model.
4. Select **保存**. New chat models are enabled for Quick tools automatically; curate the list later under **快捷操作 → 工具配置**.

The configuration dialog contains:

| Control                             | Default                                           | What it does                                                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **显示名称**                        | Provider name                                     | Changes the label shown throughout Scribe.                                                                                                                                                                                       |
| **API 密钥**                        | Blank; required or optional according to provider | Enter the credential used by this connection. In edit mode, **清空** stages key removal until you select **保存**. Required-key providers cannot be saved without a key.                                                         |
| **获取模型列表** / **测试聊天连接** | Available when connection details allow           | Fetching reads the provider's model directory; testing sends a short message to a selected model and may use quota. A successful directory fetch does not prove chat works.                                                      |
| **基础地址**                        | Provider's standard endpoint when known           | Overrides where Scribe sends requests. A custom OpenAI-compatible provider must have a Base URL. Ollama defaults to `http://localhost:11434/v1`; LM Studio defaults to `http://localhost:1234/v1`.                               |
| **启用 CORS**                       | On for a new provider; saved choice retained      | Uses the compatibility connection for Agent Chat and Quick tools. Responses normally arrive after completion instead of word by word; stopping locally cannot cancel a request already sent to the server.                       |
| **Model ID → Add**                  | Blank                                             | Adds an exact model ID manually. Use this when an endpoint cannot list models. A typed ID can be removed from the candidate list with its remove button.                                                                         |
| **Search available models**         | Blank                                             | Filters discovered, previously configured, and manually added models. Check each model you want to save. Model rows can show context size, release date, and capabilities when known.                                            |
| **Save / Cancel**                   | Save disabled until the setup is usable           | Save requires at least one model, a required key when applicable, and a routable custom endpoint. A conclusive invalid-key result blocks saving; a temporary network failure does not prevent an offline setup from being saved. |

#### Manage providers and models

| Control                     | What it does                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Search providers**        | Filters by provider name, model name, or model ID.                                                                               |
| **Provider card**           | Expand it to see configured models. The status reads **运行中** for keyless local providers, **API key set**, or **未设置密钥**. |
| **More actions → Edit key** | Reopens the full configuration dialog, where you can change the name, key, Base URL, CORS behavior, and selected models.         |
| **More actions → Remove**   | Removes the provider and all of its models from every model picker after confirmation.                                           |
| **移除模型**                | The remove button on an expanded model row removes that model from the provider and all model pickers after confirmation.        |

### 工具配置

**工具配置** 子标签是原 **快捷工具** 移入并更名后的页面，管理 Quick Ask、Quick Command 和已保存编辑器指令使用的模型。

| Control                                         | Default                                                  | What it does                                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **快捷指令默认模型**                            | **选择模型** until an enabled, usable model is available | Shared by Quick Ask, Quick Command, and saved commands set to **默认模型**.                                                                           |
| **Search quick-tool models and model switches** | New BYOK chat models are enabled automatically           | Controls the models available to Quick Ask, Quick Command, and saved editor commands. Add or remove providers in **模型**, then curate the list here. |

The same default is also available under **快捷操作 → 我的指令**. Popup model changes apply only to that run. See [Quick Ask and Quick Command](custom-commands.md#quick-ask).

### 我的指令

**我的指令** 子标签管理保存在当前资料库的自定义指令，与 **命令** 页共享同一份列表。原这些配置位于 **快捷工具** 中，现已独立成子标签。新建、编辑、复制、排序、默认模型和删除等操作的完整说明见下文 [命令](#命令)。

## 代理

在 **代理 → Scribe** 配置原生聊天模型、默认推理强度、权限模式、每轮最多执行步数及任务提示声音。Agent Chat 沿用你已有的供应商、密钥和连接地址；没有外部代理安装、登录或订阅设置。

代理开关控制能否开始新任务。关闭不会删除笔记、模型设置或历史记录。模型清单可分别决定 Agent Chat 和快捷工具中显示哪些模型。

## 技能

**技能** 页管理 Scribe 自己的技能，保留新建、编辑、启停、属性、查看和删除入口。原生代理只使用已为 Scribe 启用的条目。

- 共享技能可供各项目复用，项目技能只在对应项目中出现。
- 允许模型调用的技能可由模型选择；仅手动调用的技能需要你从 `/` 菜单选择。
- 不允许手动调用的技能不会出现在 `/` 菜单；模型调用是否允许另行判断。
- 读取或保存失败会保留具体原因。**让代理修复** 只准备聊天草稿，由你决定是否发送。
- 内置 Obsidian 技能和普通技能沿用原有管理界面；依赖其他 Obsidian 功能的技能会显示实际条件。

更多说明见 [Skills](agent-mode-and-tools.md#skills)。

## 代理扩展

当前提供 **Skills、Commands、Subagents** 三类原生入口。列表显示实际注册的技能、已有 Scribe 命令和内置子代理委派能力。

**刷新并检查** 核对当前可用状态，不发送聊天消息，也不执行工具。命令可新建、编辑、启停和删除；子代理页提供内置能力的说明与详情。修改后的状态会同步到相应聊天，任务尚未结束时保留等待提示。

本版本不提供旧外部代理的插件市场、插件安装、Hook 或 MCP 配置入口，也不读取或转换原有插件包。原有外部文件保留。

## 命令

**命令** 页使用 Scribe 现有的命令存储，支持新建、编辑、启停和删除。命令保存在当前资料库，供原输入区的 `/` 菜单和已支持的快捷入口使用。**快捷操作 → 我的指令** 保留原有的复制、排序、模型选择、变量及菜单显示选项。

### Command-wide controls

| Control              | Default        | What it does                                                                                                                                                                                         |
| -------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **快捷指令默认模型** | **选择模型**   | Shared by Quick Ask, Quick Command, and saved commands set to **默认模型**. Choose from enabled Quick tools models. If a saved command has no usable model, configure it here and rerun the command. |
| **指令变量替换**     | On             | Resolves variables such as active note, folder, tag, and selected text. Turn it off when prompt braces should remain literal.                                                                        |
| **指令排序**         | **最近使用**   | **最近使用** sorts by last use, **按名称** sorts by name, and **手动排序** uses the saved drag order.                                                                                                |
| **生成默认指令**     | Not applicable | After confirmation, adds Scribe's starter command files to the custom-prompts folder. It does not replace the folder setting because that folder derives from the Scribe root.                       |
| **添加指令**         | Not applicable | Opens the command editor with a blank command.                                                                                                                                                       |

### Command list and editor

| Control              | Default                 | What it does                                                                                                                                            |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **已启用**           | On                      | 控制整条指令是否可调用。关闭后不能从右键、命令面板、快捷键或聊天 `/` 调用；两个菜单显示偏好仍保留，重新开启后恢复原样。                                 |
| **Drag handle**      | Saved order             | Reorders commands. Choose **手动排序** if you want drag order to control the slash menu.                                                                |
| **Right-click**      | On for a new command    | Shows the command in the editor right-click menu.                                                                                                       |
| **斜杠菜单**         | On for a new command    | Shows the command after `/` in Agent Chat. Sending resolves the command name to its saved prompt.                                                       |
| **编辑**             | Not applicable          | Opens the command editor.                                                                                                                               |
| **创建副本**         | Not applicable          | Creates a uniquely named copy beside the original.                                                                                                      |
| **删除**             | Not applicable          | After confirmation, moves the shared command file to Obsidian's configured trash location. It disappears from the shared list and its shortcut entries. |
| **Name**             | Blank for a new command | Required unique command name.                                                                                                                           |
| **Prompt**           | Blank for a new command | Required prompt body. With templating on, the syntax helper shows the supported note variables.                                                         |
| **模型（可选）**     | **默认模型**            | Selects an enabled quick-tool model for editor and command-palette runs. An Agent Chat slash run uses the current Agent Chat model.                     |
| **在右键菜单中显示** | On                      | Same setting as **Right-click** in the list.                                                                                                            |
| **在斜杠菜单中显示** | On                      | Same setting as **斜杠菜单** in the list.                                                                                                               |
| **Save / Cancel**    | Not applicable          | Save validates and writes the command file.                                                                                                             |

See [Scribe Commands and Quick Ask](custom-commands.md) for prompt variables, invocation, and Quick Ask.
