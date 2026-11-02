# Scribe Settings

Open **Settings → Scribe** to configure Scribe V4. Settings normally save as soon as you change them. Controls labeled **Apply** or **Save** are the exceptions.

Scribe V4 starts with [Agent Chat](agent-mode-and-tools.md). Quick Ask and Quick Command remain available for inline questions and edits on desktop and mobile. Agent Chat, its backend settings, and Skills require desktop Obsidian.

> **Choose your data route deliberately.** Your selected cloud provider, Claude Code account, and custom Skills can receive the context needed for a request. Use local models and local tools when that work should stay on your computer, and review the agent's available network tools.

The top of the settings page has two controls that apply across every tab:

| Control               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Installed version** | Shows the installed Scribe version.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Reset settings**    | Restores non-credential preferences to their defaults after confirmation. It keeps API keys, credential-bearing provider rows and their models, and the history of Scribe folders. Keyless provider rows, including local ones, and their models are reset. Backend model enablement is also reset, so you may need to enable models again under **代理**. Reset does not delete `AGENTS.md`, saved chats, commands, or skills. To erase credentials, use **通用 → 其他 → API key storage → Delete All Keys**. |

## General

**通用** 合并原来的基本设置与高级设置，包含 **常规、自定义说明、聊天保存、其他、调试与支持、关于** 六个子标签。切换子标签不会更改已保存的配置。Claude 的安装、登录和代理开关位于独立的 **代理** 页。

### 常规

| Control                     | Default          | What it does                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open plugin in**          | **Sidebar view** | Chooses whether Scribe opens in a sidebar leaf or an editor tab. Options are **Sidebar view** and **Editor**.                                                                                                                                                                                                                                                                   |
| **Send shortcut**           | **Enter**        | Chooses **Enter** or **Shift + Enter** to send. If the shortcut does not work, check **Obsidian → Hotkeys** for a conflict.                                                                                                                                                                                                                                                     |
| **Auto-attach active note** | On               | Attaches the active note to each new Agent Chat. Turn it off to add the **Active Note** yourself from **Add context** or with `@`.                                                                                                                                                                                                                                              |
| **Scribe folder location**  | `scribe`         | Sets the root for conversations, custom prompts, skills, and projects. Press Enter or select **Apply** to validate and confirm the change. Folder names can't start with a dot, because Obsidian hides those folders. If your folder was hidden, such as `.scribe`, Scribe moves it to the same name without the dot when it starts. The folder button reveals the active root. |

Changing the Scribe folder does not move existing files. The old root remains treated as Scribe data, and a new root that already contains notes becomes excluded from Scribe search. Move files yourself after the change. Scribe applies the new root to its own search results immediately.

### 自定义说明

| Control                       | Default           | What it does                                                                                                                                                                                                      |
| ----------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Custom vault instructions** | Blank `AGENTS.md` | Edits the root `AGENTS.md` used by Agent Chat. Text saves automatically after a short delay. **Open AGENTS.md** closes settings and opens the file as a note. Start a new Agent Chat after changing instructions. |

Empty instruction fields show a fixed example until you type.

See [`AGENTS.md` examples](agents-md-examples.md) and [Projects](projects.md) for project-specific instructions.

### 聊天保存

| Control                        | Default                    | What it does                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Autosave chats as Markdown** | On                         | Writes a Markdown conversation note after each user message and response under `<Scribe folder>/scribe-conversations/`. Turning it off skips the note until you save the chat or select **Copy chat link**. Agent Chat sessions still appear in **Recent chats**.                                                                      |
| **Chat note name template**    | `{$topic}@{$date}_{$time}` | Expand the disclosure, edit the template, then select **Apply**. It controls automatic and manual conversation-note names. The template must contain `{$topic}`, `{$date}`, and `{$time}` and cannot add backslashes, slashes, colons, asterisks, question marks, quotes, angle brackets, or vertical bars outside those placeholders. |

### Others

在 **通用 → 其他** 中查看和管理密钥存储。

| Control             | Default                                           | What it does                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API key storage** | **Obsidian Keychain** on Obsidian 1.11.4 or newer | Reports whether secure storage is available and whether this device appears to have keys. Each device has a separate Keychain, so vault sync does not copy credentials. Older Obsidian builds cannot load, save, or delete Keychain entries.         |
| **Delete All Keys** | Not applicable                                    | After confirmation, removes Scribe API keys from the Obsidian Keychain, `data.json`, and in-memory settings. You must enter them again. Credential backup files created during a V4 upgrade are left in place for you to review and delete manually. |

### Debugging & support

在 **通用 → 调试与支持** 中查看诊断与反馈选项。

One place to report a problem, plus the switches for the two logs a report can carry.

| Control                                  | Default        | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Report an issue**                      | Not applicable | Desktop-only, in two pages. First, describe what went wrong and tick which attachments to include; then review what was actually packed into a single zip and upload it. Scribe uploads that zip privately and opens a prefilled GitHub issue carrying only the report ID. Nothing leaves this device until you choose to upload, and nothing on the issue itself can download the bundle.                                                                                   |
| **Offer feedback reports in Agent Chat** | On             | When Scribe itself fails in Agent Chat, such as a Scribe tool erroring or a needed tool missing, the agent can draft a bug report as a card in the chat. The agent's own mistakes and answers don't get a card. A reply that fails with an error gets the same card. **Review & report** opens **Report an issue** with the draft filled in; nothing is sent unless you upload it. Turn this off, or press **Don't offer again** on a card, to stop the agent from offering. |
| **Debug mode**                           | Off            | Logs Quick tools activity to **View → Toggle Developer Tools**. Turn it on and reproduce the problem before you report an issue, so the Scribe log a report collects actually contains it. It does not control the Agent Mode activity log below.                                                                                                                                                                                                                            |
| **Agent activity log**                   | On             | Records the messages between Scribe and the agent, so a report always has recent activity to attach. The log is plain text, lives on this device outside your vault, and can contain your prompts, note contents, and tool inputs or outputs. Turn it off to stop further logging. On the same row, **Open** shows the log file on disk and **Clear** deletes it; both are desktop-only.                                                                                     |

The Scribe log can still be saved by hand whenever you want it: run **Scribe: Open Scribe log file** from the command palette to write it into your vault as a note and open it.

See [Troubleshooting and FAQ](troubleshooting-and-faq.md) before sharing logs or filing an issue.

## Quick actions

**快捷操作** 把日常最常用的配置集中在一个标签页，包含 **模型、工具配置、我的指令** 三个子标签。原顶级的 **模型** 标签页，以及原 **通用** 中的 **快捷工具** 子标签，都已移动到这里；**快捷工具** 更名为 **工具配置**，其中与“我的指令”相关的配置独立为 **我的指令** 子标签。

### Models

**模型** 子标签管理自备密钥（BYOK）的模型。Bring Your Own Key connects Scribe directly to a model provider, compatible gateway, Ollama, LM Studio, or another OpenAI-compatible endpoint. Cloud-provider billing and data handling belong to that provider.

#### Add a provider

1. Select **Add a provider**.
2. Search or choose from **Recommended** providers, **Self-host** templates for Ollama and LM Studio, the dynamic **More providers** catalog, or **Add a custom provider**.
3. Complete the configuration and select at least one model.
4. Select **Save**. New chat models are enabled for Quick tools automatically; curate the list later under **快捷操作 → 工具配置**.

The configuration dialog contains:

| Control                     | Default                                           | What it does                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Display name**            | Provider name                                     | Changes the label shown throughout Scribe.                                                                                                                                                                                                       |
| **API key**                 | Blank; required or optional according to provider | **Test** verifies the current key and refreshes model discovery. In edit mode, **Clear** stages key removal until you select **Save**. Required-key providers cannot be saved without a key. Keys are stored in this device's Obsidian Keychain. |
| **Base URL**                | Provider's standard endpoint when known           | Overrides where Scribe sends requests. A custom OpenAI-compatible provider must have a Base URL. Ollama defaults to `http://localhost:11434/v1`; LM Studio defaults to `http://localhost:1234/v1`.                                               |
| **Enable CORS**             | Off                                               | Compatibility option for Quick tools endpoints that reject browser-style requests. When enabled, responses arrive only after completion instead of streaming token by token.                                                                     |
| **Model ID → Add**          | Blank                                             | Adds an exact model ID manually. Use this when an endpoint cannot list models. A typed ID can be removed from the candidate list with its remove button.                                                                                         |
| **Search available models** | Blank                                             | Filters discovered, previously configured, and manually added models. Check each model you want to save. Model rows can show context size, release date, and capabilities when known.                                                            |
| **Save / Cancel**           | Save disabled until the setup is usable           | Save requires at least one model, a required key when applicable, and a routable custom endpoint. A conclusive invalid-key result blocks saving; a temporary network failure does not prevent an offline setup from being saved.                 |

#### Manage providers and models

| Control                     | What it does                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Search providers**        | Filters by provider name, model name, or model ID.                                                                            |
| **Provider card**           | Expand it to see configured models. The status reads **Running** for keyless local providers, **API key set**, or **No key**. |
| **More actions → Edit key** | Reopens the full configuration dialog, where you can change the name, key, Base URL, CORS behavior, and selected models.      |
| **More actions → Remove**   | Removes the provider and all of its models from every model picker after confirmation.                                        |
| **Remove model**            | The remove button on an expanded model row removes that model from the provider and all model pickers after confirmation.     |

### Tool configuration

**工具配置** 子标签是原 **快捷工具** 移入并更名后的页面，管理 Quick Ask、Quick Command 和已保存编辑器指令使用的模型。

| Control                                         | Default                                                      | What it does                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Default quick command model**                 | **Select model** until an enabled, usable model is available | Shared by Quick Ask, Quick Command, and saved commands set to **Default model**.                                                                      |
| **Search quick-tool models and model switches** | New BYOK chat models are enabled automatically               | Controls the models available to Quick Ask, Quick Command, and saved editor commands. Add or remove providers in **模型**, then curate the list here. |

The same default is available under **Command**. Popup model changes apply only to that run. See [Quick Ask and Quick Command](custom-commands.md#quick-ask).

### My commands

**我的指令** 子标签管理保存在当前资料库的自定义指令，与 **Commands** 页共享同一份列表。原这些配置位于 **快捷工具** 中，现已独立成子标签。新建、编辑、复制、排序、默认模型和删除等操作的完整说明见下文 [Command](#command)。

## Agents

打开 **Settings → Scribe → 代理** 管理 Claude Code。目前只提供 Claude Code；已有聊天记录和配置会保留。

- **代理开关**控制 Claude 是否可用。关闭后不能新建代理聊天、发送新任务或检查扩展。正在运行的回复和后台任务会先完成，再停止 Claude；重新开启后可继续使用保留的会话。
- **Configure** 用于检查安装、指定 Claude 的位置及登录账号。未安装、未登录或版本不兼容时，会显示实际问题，开启开关不会自动解决这些问题。
- 展开 **Visible models** 可搜索模型并控制它们是否出现在代理聊天中。模型来自 Claude Code 实际报告的列表；第一个已启用模型作为默认项，推理强度沿用代理默认。要开始新聊天，至少保留一个模型启用。
- **模型** 中添加的模型供 **快捷操作 → 工具配置** 中的快捷功能使用，不会因为加入 BYOK 就变成 Claude 的代理模型。Claude Code 的账号、费用和限制仍由 Claude Code 管理。
- 自动批准方式、思考内容显示、环境变量及通知声音也在此页。环境变量可改变 Claude 读取的账号或设置位置。

关闭代理不会删除登录信息、模型选择、扩展配置或历史记录。

## Skills

**Skills** 页按所选来源管理技能。页面顶端先显示 Claude Code，再提供来源选择和搜索。来源可以是**本地用户**、**当前资料库**或已有**项目**；保存、启停和删除只作用于当前所选来源。

- **个人安装**包含你创建或安装的技能。可新建、编辑说明和正文、启用、停用或删除。新建和编辑使用弹窗；保存失败时保留输入，便于修正。
- **Scribe 内置**技能始终启用，只能查看，不能改名、编辑、停用或删除。以前保存的内置技能关闭选项会被清除。Claude 尚未安装、Obsidian 的命令行功能未开启、文件冲突或读取失败时，仍会显示实际问题；“始终启用”不代表已经成功加载。
- **插件提供**的技能只读，并标明所属插件。需要调整时，到 **Plugins** 页管理父插件，不单独修改插件的技能文件。

当前资料库的共享技能继续由 Scribe 管理。原有的属性、显示位置、迁移确认和删除确认保留；在隐藏的 Claude 文件夹中发现的技能也会显示。新建不会覆盖已有的同名技能，编辑会保留不认识的额外配置。

从其他位置链接进来的技能也会列出；不由 Scribe 管理的链接项只能查看，需要到原始来源修改。如果技能文件已经保存，但同步到 Claude 失败，会明确提示“已保存，但同步失败”；修复后重新打开技能页即可重试，无需再次新建。

如果某个技能无法读取，页面保留具体错误和修复入口。**Fix with agent** 只准备一份可审阅的聊天草稿，不会自动发送。修好文件后刷新即可重新检查。

`obsidian-cli` 仍要求 Obsidian 的 **Settings → General → Command line interface** 已开启。名称冲突时保留你的原文件，不用内置版本覆盖它。

在 Windows 上，启用共享技能可能需要系统的 **Developer Mode**。同步服务也可能破坏文件链接；遇到这种情况，按页面提示修复或重新启用个人技能。

See [Skills with Claude](agent-mode-and-tools.md#skills-with-claude).

## Agent extensions

扩展配置已拆为 **Plugins、Skills、Commands、Hooks、MCP、子Agent** 六个独立页面，不再挤在一个“Agent extensions”页中。各页使用相同的 Claude Code、来源、搜索和刷新检查操作。

| 页面         | 可以做什么                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Plugins**  | 浏览插件市场、按名称或市场地址安装，也可添加本地插件目录；可启停、更新或卸载。插件提供的组件显示所属关系；卸载本地插件不会删除它的原目录。 |
| **Skills**   | 管理个人技能，查看只读的 Scribe 内置技能和插件技能。                                                                                       |
| **Commands** | 同页显示共享的“我的指令”、所选来源的 Claude 指令及只读的插件指令；支持新建、编辑、复制、启停或删除可管理的条目。                           |
| **Hooks**    | 新建命令钩子；编辑已有钩子时保留其命令、提示词、代理或 HTTP 类型，并显示对应字段。保存不会立即执行钩子。插件提供的 Hook 只能查看。         |
| **MCP**      | 新建 HTTP、SSE 或本地命令连接，编辑请求头或环境变量，导入配置；可在保存前测试连接，测试不会替你保存。                                      |
| **子Agent**  | 新建和编辑专门代理的说明、模型及可用工具，也可启停和删除；插件提供的专门代理只读。                                                         |

进入任一页面或切换来源时，Scribe 会先比对保存的检查结果与当前配置：配置没变就直接显示上次的结果，不再启动检查；配置变了才自动启动一次不发送聊天消息的检查，选择 **Refresh and check** 则强制重新检查。检查不会新建聊天标签；离开页面或切换来源会清理临时检查。各范围严格隔离：每个来源只显示写在该范围里的条目，**本机用户**不显示当前库或项目里的条目，**当前库**与项目也不显示全局或其他范围的条目。插件同样遵循此规则：当前库与项目只列出安装在该范围里的插件；全局安装的插件只在 **本机用户** 中管理，项目设置里手写的插件启停覆盖仍会在该项目中显示为可切换的条目。

每个列表把条目分成两类：能通过开关启用或停用的条目显示开关，开关表示所选范围内的实际可用性，不再把配置中的开启值直接当成可用；不能单独控制的条目不显示开关，未启用时在名称右侧显示一个红点，悬停可查看原因。检查会核对插件实际加载、技能和命令及子 Agent 是否被识别、MCP 是否提供可调用工具，以及钩子是否注册并允许触发。

- 开关开启表示检查确认可用，关闭表示确认不可用。
- 检查中、检查失败、信息不足或等待已有任务结束时，开关灰化并附小图标。悬停或打开详情可查看原因。
- 远程 MCP 服务器建立连接需要几秒：先显示橙色闪烁圆点（正在连接…），连上后自动变为开关；等待超过约 15 秒仍连不上则转为红点。
- 缺少安装文件、需要登录、仅安装在其他项目，或加载失败等情况，不显示开关而显示红点与原因。
- 不能单独控制的条目包括内置事项、插件附属事项和通过链接安装的只读事项；检查确认可用但由别处管理的条目显示灰色圆点，悬停说明管理位置（如由所属插件管理、内置提供或只读请在来源处管理）。

列表按来源分组：**已安装**、**内置**，插件附属事项按所属插件单独分组。所属插件未启用时，它包含的技能、命令、钩子、MCP 和子 Agent 不会出现在各自的页面；插件启用后按所属插件分组显示，且一律没有开关。

修改后会重新检查实际结果。已有聊天不会被打断，待当前任务和后台任务结束后应用；等待状态在六个页面之间保持一致。

插件按独立插件计数，多条安装记录合并在同一详情中。详情显示介绍、版本、安装地址、各记录所属范围，以及插件包含的技能、命令、钩子、MCP 和子 Agent。详情页不再显示开关：条目可用时正常显示，不可用时显示红点并说明原因，插件附属事项同样如此。插件的启用和停用在列表的开关中操作。

检查不会逐个执行工具、运行子 Agent 或人为触发业务钩子。正常启动 Claude 仍可能连接扩展服务并运行已配置的启动钩子；确认可用不保证每次实际任务都成功。读取不到的结果保持未知，不会冒充成功或失败。

插件清单会读取默认位置和清单声明的附加位置；插件组件不能独立编辑或删除。子 Agent 的模型留空时保留代理默认规则，填写 `inherit` 才会明确跟随主代理。

这些代理配置页面需要桌面版 Obsidian。界面会保留读取失败与不支持的操作信息，不把“没有读到”当成“没有配置”。

## Command

**Commands** 页中的“我的指令”继续使用 Scribe 原有的管理方式，所有来源共享同一份列表，并保存在当前资料库中。编辑、复制、拖动排序、模型选择、变量填充和两个菜单显示偏好都保留。所选来源的 Claude 指令和插件指令另行分组，插件指令只能查看。

### Command-wide controls

| Control                         | Default          | What it does                                                                                                                                                                                              |
| ------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Default quick command model** | **Select model** | Shared by Quick Ask, Quick Command, and saved commands set to **Default model**. Choose from enabled Quick tools models. If a saved command has no usable model, configure it here and rerun the command. |
| **Command templating**          | On               | Resolves variables such as active note, folder, tag, and selected text. Turn it off when prompt braces should remain literal.                                                                             |
| **Command sort order**          | **Recency**      | **Recency** sorts by last use, **Alphabetical** sorts by name, and **Manual** uses the saved drag order.                                                                                                  |
| **Generate defaults**           | Not applicable   | After confirmation, adds Scribe's starter command files to the custom-prompts folder. It does not replace the folder setting because that folder derives from the Scribe root.                            |
| **Add command**                 | Not applicable   | Opens the command editor with a blank command.                                                                                                                                                            |

### Command list and editor

| Control                  | Default                 | What it does                                                                                                                        |
| ------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Enabled**              | On                      | 控制整条指令是否可调用。关闭后不能从右键、命令面板、快捷键或聊天 `/` 调用；两个菜单显示偏好仍保留，重新开启后恢复原样。             |
| **Drag handle**          | Saved order             | Reorders commands. Choose **Manual** if you want drag order to control the slash menu.                                              |
| **Right-click**          | On for a new command    | Shows the command in the editor right-click menu.                                                                                   |
| **Slash menu**           | On for a new command    | Shows the command after `/` in Agent Chat. Sending resolves the command name to its saved prompt.                                   |
| **Edit**                 | Not applicable          | Opens the command editor.                                                                                                           |
| **Duplicate**            | Not applicable          | Creates a uniquely named copy beside the original.                                                                                  |
| **Delete**               | Not applicable          | Permanently removes the command's Markdown file after confirmation.                                                                 |
| **Name**                 | Blank for a new command | Required unique command name.                                                                                                       |
| **Prompt**               | Blank for a new command | Required prompt body. With templating on, the syntax helper shows the supported note variables.                                     |
| **Model (optional)**     | **Default model**       | Selects an enabled quick-tool model for editor and command-palette runs. An Agent Chat slash run uses the current Agent Chat model. |
| **Show in context menu** | On                      | Same setting as **Right-click** in the list.                                                                                        |
| **Show in slash menu**   | On                      | Same setting as **Slash menu** in the list.                                                                                         |
| **Save / Cancel**        | Not applicable          | Save validates and writes the command file.                                                                                         |

See [Scribe Commands and Quick Ask](custom-commands.md) for prompt variables, invocation, and Quick Ask.
