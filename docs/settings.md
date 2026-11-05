# Scribe Settings

Open **Settings → Scribe** to configure Scribe. Settings normally save as soon as you change them. Controls labeled **应用** or **保存** are the exceptions.

Scribe includes [Agent Chat](agent-mode-and-tools.md). Quick Ask and Quick Command remain available for inline questions and edits on desktop and mobile. Agent Chat, Skills, Commands and Subagents require desktop Obsidian. **模型** and **我的指令** are also available on mobile.

> **Choose your data route deliberately.** Your selected model provider receives the context needed for a request; enabled network tools can contact their target services. Use local models and local tools when that work should stay on your computer, and review the agent's available network tools.

## Agent 配置

**Agent 配置** 是独立设置标签页，包含 **常规** 和 **自定义说明** 两部分，两者一起显示，不再设子标签。Scribe 的其余设置分布在 **关于**、**模型**、**我的指令**、**命令**、**技能** 和 **子代理** 标签页。

### 常规

| Control               | Default    | What it does                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **插件打开位置**      | **侧边栏** | Chooses whether Scribe opens in a sidebar leaf or an editor tab. Options are **侧边栏** and **编辑区**.                                                                                                                                                                                                                                                                              |
| **发送快捷键**        | **Enter**  | Chooses **Enter** or **Shift + Enter** to send. If the shortcut does not work, check **Obsidian → Hotkeys** for a conflict.                                                                                                                                                                                                                                                          |
| **自动附加当前笔记**  | On         | Attaches the active note to each new Agent Chat. Turn it off to add the **当前笔记** yourself from **添加参考内容** or with `@`.                                                                                                                                                                                                                                                     |
| **Scribe 文件夹位置** | `scribe`   | Sets the root for conversations, custom prompts, skills, and projects. Press Enter or select **应用** to validate and confirm the change. Folder names can't start with a dot, because Obsidian hides those folders. A previously selected hidden folder is changed to a visible name in settings; its files are not moved automatically. The folder button reveals the active root. |
| **每轮最多执行步数**  | **无限制** | 默认不限制步数。选择 **限制步数** 后填写正整数，达到上限会停止工具操作，并由模型总结已完成的工作。旧设置中明确保存的数值（包括 50）继续生效；切换到 **无限制** 才移除上限。                                                                                                                                                                                                          |

Changing the Scribe folder does not move existing files. The old root remains treated as Scribe data, and a new root that already contains notes becomes excluded from Scribe search. Move files yourself after the change. Scribe applies the new root to its own search results immediately.

### 自定义说明

| Control            | Default           | What it does                                                                                                                                                                                                                  |
| ------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **库的自定义说明** | Blank `AGENTS.md` | Edits the root `AGENTS.md` used by Agent Chat. Text saves automatically after a short delay. **打开 AGENTS.md** closes settings and opens the file as a note. Check that the file has saved before sending your next message. |

Empty instruction fields show a fixed example until you type.

See [`AGENTS.md` examples](agents-md-examples.md) and [Projects](projects.md) for project-specific instructions.

## 关于

**关于** 是独立设置标签页，包含版本信息、重置设置、通知、API 密钥存储与调试与支持。

| Control      | What it does                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **插件版本** | Shows the installed Scribe version.                                                                                                                                                                                                                                                                                                                                                                           |
| **重置设置** | Restores non-credential preferences to their defaults after confirmation. It keeps API keys, credential-bearing provider rows and their models, and the history of Scribe folders. Keyless provider rows, including local ones, and their models are reset. Configured chat models are available directly without separate enable switches. To erase credentials, use **关于 → API 密钥存储 → 删除所有密钥**. |

### 通知

**关于 → 通知** 管理聊天结束时的提示声音。开关与声音选择沿用原有保存结果；开启后可选择声音并试听。

聊天历史自动保留。设置中不再提供将聊天保存成笔记的选项，聊天和历史列表也不再提供该按钮；此前生成的笔记会保留。

### API 密钥存储

在 **关于 → API 密钥存储** 中查看和管理密钥存储。

| Control          | Default             | What it does                                                                                                                                                                                                                                     |
| ---------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **API 密钥存储** | **Obsidian 钥匙串** | Describes the storage method and whether its interface is available; it does not verify whether keys exist. Each device has a separate Keychain. Check or change a particular key under **模型与供应商**.                                        |
| **删除所有密钥** | Not applicable      | After confirmation, attempts to remove Scribe API keys from the Obsidian Keychain, `data.json`, and in-memory settings. You may need to enter them again. Existing credential backups may remain; review them separately. See the warning below. |

When two vaults on one device share a Scribe key-storage identifier, an isolated test found that deleting all keys in one can also remove the other's keys. Until this is fixed, do not use **删除所有密钥**. The test used a simulated host, not a real device's credentials.

隔离测试发现，如果同一设备上的两个资料库共用 Scribe 密钥存储标识，在一个库中删除全部密钥也可能移除另一个库的密钥。修复前不要使用 **删除所有密钥**。测试使用的是替身宿主，没有操作真实设备密钥。

### 调试与支持

在 **关于 → 调试与支持** 中管理调试模式和代理活动日志。调试模式记录快捷工具运行信息；代理活动日志提供本机日志的打开与清空操作。日志可能含笔记内容和工具输入输出，分享前请检查。

内置反馈入口、聊天反馈卡和报告上传功能已移除。

The Scribe log can still be saved by hand whenever you want it: run **打开 Scribe 日志文件** from the command palette to write it into your vault as a note and open it.

See [Troubleshooting and FAQ](troubleshooting-and-faq.md) before sharing logs or filing an issue.

## 模型

**模型** 是独立设置标签页，直接管理云端供应商、兼容网关和本机模型服务，不再设子标签页。需要密钥的服务使用你自己的密钥；Ollama、LM Studio 等本机服务可能无需密钥。云端费用及数据处理由对应供应商负责。

模型配置保存后，直接供聊天与快捷工具选择，不再分别启用。新聊天沿用最近一次成功选择的模型、推理强度和权限模式；首次使用时采用配置顺序中第一个凭据可用的聊天模型，权限为 **自动模式**。原有选择继续保留。历史聊天仍使用其自己的选择。

Quick Ask、Quick Command 及未指定模型的编辑器指令，默认使用配置顺序中第一个可用聊天模型。弹窗中的临时选择仅对当前弹窗生效，单条指令指定的模型继续优先生效。

#### Add a provider

1. Select **添加供应商**.
2. Search or choose from **推荐** providers, **Self-host** templates for Ollama and LM Studio, the dynamic **更多供应商** catalog, or **添加自定义供应商**.
3. Complete the configuration and select at least one model.
4. Select **保存**. Configured chat models are immediately available to Agent Chat and Quick tools.

The configuration dialog contains:

| Control                                      | Default                                           | What it does                                                                                                                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **显示名称**                                 | Provider name                                     | Changes the label shown throughout Scribe.                                                                                                                                                                                             |
| **API 密钥**                                 | Blank; required or optional according to provider | Enter the credential used by this connection. In edit mode, **清空** stages key removal until you select **保存**. Required-key providers cannot be saved without a key.                                                               |
| **获取模型列表** / **测试聊天连接**          | Available when connection details allow           | Fetching reads the provider's model directory; testing sends a short message to a selected model and may use quota. A successful directory fetch does not prove chat works.                                                            |
| **基础地址**                                 | Provider's standard endpoint when known           | Overrides where Scribe sends requests. A custom OpenAI-compatible provider must have a Base URL. Ollama defaults to `http://localhost:11434/v1`; LM Studio defaults to `http://localhost:1234/v1`.                                     |
| **启用 CORS**                                | On for a new provider; saved choice retained      | Uses the compatibility connection for Agent Chat and Quick tools. Responses normally arrive after completion instead of word by word; stopping locally cannot cancel a request already sent to the server.                             |
| **模型 ID → 添加** (Model ID → Add)          | Blank                                             | Adds an exact model ID manually. Use this when an endpoint cannot list models. A typed ID can be removed from the candidate list with its remove button.                                                                               |
| **搜索可用模型…** (Search available models…) | Blank                                             | Filters discovered, previously configured, and manually added models. Check each model you want to save. Model rows can show context size, release date, and capabilities when known.                                                  |
| **保存 / 取消** (Save / Cancel)              | Save disabled until the setup is usable           | Save requires at least one model, required keys and connection fields, and no address-parsing error. Failed connection checks do not themselves prevent saving; saving does not prove that the provider is reachable or the key works. |

#### Manage providers and models

| Control                     | What it does                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Search providers**        | Filters by provider name, model name, or model ID.                                                                                                                                   |
| **Provider card**           | Expand it to see configured models. A provider that needs no key says **无需 API 密钥**; a separate badge shows the connection check result, such as **接口可访问** or **检查失败**. |
| **More actions → Edit key** | Reopens the full configuration dialog, where you can change the name, key, Base URL, CORS behavior, and selected models.                                                             |
| **More actions → Remove**   | Removes the provider and all of its models from every model picker after confirmation.                                                                                               |
| **移除模型**                | The remove button on an expanded model row removes that model from the provider and all model pickers after confirmation.                                                            |

## 我的指令

**我的指令** 是独立设置标签页，管理保存在当前资料库的自定义指令。指令变量、排序等选项直接显示，不再通过 **指令选项** 折叠。指令与 **命令** 页共享同一份列表，提供新建、编辑、复制、排序、启停和删除。

每条指令可指定自己的模型；选择 **默认模型** 时使用配置的第一个可用模型。这里不再提供全局默认模型设置。完整操作说明见 [命令](#命令)。

## 技能

**技能** 页管理你的个人和项目技能，保留新建、编辑、启停、属性、查看和删除入口。原生代理只使用已为 Scribe 启用的条目。技能、命令和子代理页直接显示内容，不再设 Scribe 子标签。

隔离测试发现，保存技能描述或启用状态时，文件中额外属性的高精度数字可能被改写；真实技能设置界面尚未核验。请先备份现有文件，再暂时停用 Scribe，直到文件安全问题修复；关闭时程序可能完成之前排队的保存。

Isolated tests found that saving a skill's description or enabled state can alter high-precision numbers in additional file properties. The real skill settings interface has not yet been verified. Back up your files first, then disable Scribe until the file safety issues are fixed; pending saves may finish during shutdown.

- 共享技能可供各项目复用。已发现的项目技能只在对应项目中出现；当前版本可能无法自动发现项目目录中的技能。
- 允许模型调用的技能可由模型选择；仅手动调用的技能需要你从 `/` 菜单选择。
- 不允许手动调用的技能不会出现在 `/` 菜单；模型调用是否允许另行判断。
- 读取或保存失败会保留具体原因。**让代理修复** 只准备聊天草稿，由你决定是否发送。
- Scribe 不再随插件附带、自动安装或更新技能。此前已经保存在磁盘上的技能及其附加文件会保留，和其他个人或项目技能一样管理。

隔离测试发现，可用技能和已启用指令同名时，菜单显示技能，但发送后可能展开指令。修复前请不要在代理聊天中调用名称重复的技能或指令；详见[指令说明](custom-commands.md#commands-or-skills)。

An isolated test found that a same-named enabled command may be expanded when a skill is selected. Until this is fixed, avoid invoking a shared name in Agent Chat; see [Commands or skills?](custom-commands.md#commands-or-skills).

更多说明见 [Skills](agent-mode-and-tools.md#skills)。

## 代理扩展

当前提供 **Skills、Commands、Subagents** 三类原生入口。列表显示实际注册的技能、已有 Scribe 命令和内置子代理委派能力。

**刷新并检查** 核对当前可用状态，不发送聊天消息，也不执行工具。命令可新建、编辑、启停和删除；子代理页提供内置能力的说明与详情。修改后的状态会同步到相应聊天，任务尚未结束时保留等待提示。

本版本不提供旧外部代理的插件市场、插件安装、Hook 或 MCP 配置入口，也不读取或转换原有插件包。原有外部文件保留。

## 命令

**命令** 页使用 Scribe 现有的命令存储，支持新建、编辑、启停和删除。命令保存在当前资料库，供原输入区的 `/` 菜单和已支持的快捷入口使用。**我的指令** 保留原有的复制、排序、单条模型选择、变量及菜单显示选项。

### Command-wide controls

| Control          | Default        | What it does                                                                                                                                                                                                                       |
| ---------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **指令变量替换** | On             | Controls note-variable expansion for editor and command-palette runs. In Agent Chat, command variables still become selected text or references when this is off; see [Commands](custom-commands.md#add-note-context-to-a-prompt). |
| **指令排序**     | **最近使用**   | **最近使用** sorts by last use, **按名称** sorts by name, and **手动排序** uses the saved drag order.                                                                                                                              |
| **生成默认指令** | Not applicable | After confirmation, adds Scribe's starter command files to the custom-prompts folder. It does not replace the folder setting because that folder derives from the Scribe root.                                                     |
| **新建代理命令** | Not applicable | Opens the command editor from **命令** for the current vault.                                                                                                                                                                      |
| **添加指令**     | Not applicable | Opens the command editor from **我的指令**.                                                                                                                                                                                        |

### Command list and editor

| Control                         | Default                 | What it does                                                                                                                                            |
| ------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **已启用**                      | On                      | 控制整条指令是否可调用。关闭后不能从右键、命令面板、快捷键或聊天 `/` 调用；两个菜单显示偏好仍保留，重新开启后恢复原样。                                 |
| **Drag handle**                 | Saved order             | Reorders commands. Choose **手动排序** if you want drag order to control the slash menu.                                                                |
| **Right-click**                 | On for a new command    | Shows the command in the editor right-click menu.                                                                                                       |
| **斜杠菜单**                    | On for a new command    | Shows the command after `/` in Agent Chat. Sending resolves the command name to its saved prompt.                                                       |
| **编辑**                        | Not applicable          | Opens the command editor.                                                                                                                               |
| **创建副本**                    | Not applicable          | Creates a uniquely named copy beside the original.                                                                                                      |
| **删除**                        | Not applicable          | After confirmation, moves the shared command file to Obsidian's configured trash location. It disappears from the shared list and its shortcut entries. |
| **名称**                        | Blank for a new command | Required unique command name.                                                                                                                           |
| **内容** / **提示词**           | Blank for a new command | Required command text, labeled **内容** under **命令** and **提示词** under **我的指令**. The latter editor shows the supported note variables.         |
| **模型（可选）**                | **默认模型**            | Selects a configured chat model for editor and command-palette runs. An Agent Chat slash run uses the current Agent Chat model.                         |
| **在右键菜单中显示**            | On                      | Same setting as **Right-click** in the list.                                                                                                            |
| **在斜杠菜单中显示**            | On                      | Same setting as **斜杠菜单** in the list.                                                                                                               |
| **保存 / 取消** (Save / Cancel) | Not applicable          | Save validates and writes the command file.                                                                                                             |

See [Scribe Commands and Quick Ask](custom-commands.md) for prompt variables, invocation, and Quick Ask.
