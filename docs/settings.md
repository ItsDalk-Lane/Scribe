# Scribe Settings

Open **Settings → Scribe** to configure Scribe. Settings normally save as soon as you change them. Controls labeled **应用** or **保存** are the exceptions.

Scribe includes [Agent Chat](agent-mode-and-tools.md). Quick Ask and Quick Command remain available for inline questions and edits on desktop and mobile. Agent Chat, Skills, Commands and Subagents require desktop Obsidian. **模型** and **我的指令** are also available on mobile.

> **Choose your data route deliberately.** Your selected model provider receives the context needed for a request; enabled network tools can contact their target services. Use local models and local tools when that work should stay on your computer, and review the agent's available network tools.

## Agent 配置

**Agent 配置** 是独立设置标签页：常用设置与库的自定义说明连续排列，不再显示 **常规** 和 **自定义说明** 分组标题，也不使用分组边框。Scribe 的其余设置分布在 **关于**、**模型**、**我的指令**、**命令**、**技能** 和 **子代理** 标签页。

| Control                  | Default    | What it does                                                                                                                                                                |
| ------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **插件打开位置**         | **侧边栏** | Chooses whether Scribe opens in a sidebar leaf or an editor tab. Options are **侧边栏** and **编辑区**.                                                                     |
| **发送快捷键**           | **Enter**  | Chooses **Enter** or **Shift + Enter** to send. If the shortcut does not work, check **Obsidian → Hotkeys** for a conflict.                                                 |
| **自动附加当前笔记**     | On         | Attaches the active note to each new Agent Chat. Turn it off to add the **当前笔记** yourself from **添加参考内容** or with `@`.                                            |
| **每轮最多执行步数**     | **无限制** | 默认不限制步数。选择 **限制步数** 后填写正整数，达到上限会停止工具操作，并由模型总结已完成的工作。旧设置中明确保存的数值（包括 50）继续生效；切换到 **无限制** 才移除上限。 |
| **上下文占比（百分比）** | 2          | 模型可见技能列表以模型上下文窗口的该比例封顶。技能页只显示预算状态提示；数值在此调整。                                                                                      |
| **绝对 token 上限**      | 10000      | 即使上下文窗口很大，技能目录也不超过该 token 数。                                                                                                                           |

Scribe uses the vault-root `.scribe` folder for all plugin material. The location is fixed. Only explicit configuration, lightweight preferences, storage metadata, and recovery identifiers remain in the plugin’s `data.json`. Vault and project `AGENTS.md` files stay at their respective workspace roots. Old locations are not imported, read, moved, or cleaned.

插件资料统一保存在当前库根目录的 `.scribe`，位置不可修改；配置和轻量偏好等保存在插件的 `data.json`。库说明和项目说明保留原位置。旧位置的资料不导入、不迁移、不清理。

| Control            | Default           | What it does                                                                                                                                                                                                                  |
| ------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **库的自定义说明** | Blank `AGENTS.md` | Edits the root `AGENTS.md` used by Agent Chat. Text saves automatically after a short delay. **打开 AGENTS.md** closes settings and opens the file as a note. Check that the file has saved before sending your next message. |

Empty instruction fields show a fixed example until you type.

See [`AGENTS.md` examples](agents-md-examples.md) and [Projects](projects.md) for project-specific instructions.

## 关于

**关于** 是独立设置标签页，内容从上到下依次为通知、调试与支持、重置设置和插件版本。各配置项连续排列，不再显示分组标题，也不使用分组边框。

### 通知

通知声音设置管理聊天结束时的提示声音。开关与声音选择沿用原有保存结果；开启后可选择声音并试听。

聊天历史自动保留。设置中不再提供将聊天保存成笔记的选项，聊天和历史列表也不再提供该按钮；此前生成的笔记会保留。

### 调试与支持

在 **关于** 页中开启或关闭调试模式，将聊天和快捷工具运行信息记录到开发者控制台。旧版代理活动日志及其开关、打开和清空操作已移除；当前原生聊天不写入该旧日志。日志可能含笔记内容和工具输入输出，分享前请检查。

内置反馈入口、聊天反馈卡和报告上传功能已移除。

The Scribe log can still be saved by hand whenever you want it: run **打开 Scribe 日志文件** from the command palette to save it inside `.scribe` and open it with your system application.

See [Troubleshooting and FAQ](troubleshooting-and-faq.md) before sharing logs or filing an issue.

### 密钥与重置

密钥采用固定的主密码加密方式，不再提供存储方式设置或钥匙串管理按钮。首次保存密钥时设置主密码，每次打开库后首次主动使用密钥时解锁。密码不会保存；忘记密码需要在解锁窗口确认重置并重新填写服务商密钥。

已保存的密钥不回填到编辑框，留空表示保留；填写新值表示替换，**清空** 后保存表示移除。只有向对应服务商发请求时才解密，查看设置和模型列表不解密。旧钥匙串不读取，原有服务商需要重新填写密钥。

**重置设置** 恢复普通偏好，保留有密钥引用的服务商及其模型、存储标识和首页选项；不删除密钥文件或其他资料。无需密钥的服务商及其模型会被重置。插件版本显示在页面末尾。

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

| Control                                      | Default                                           | What it does                                                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **显示名称**                                 | Provider name                                     | Changes the label shown throughout Scribe.                                                                                                                                                                                                         |
| **API 密钥**                                 | Blank; required or optional according to provider | Enter the credential used by this connection. Saved keys are not filled back into the form. Leave blank to keep one, enter a value to replace it, or use **清空** and save to remove it. Required-key providers need a saved or newly entered key. |
| **获取模型列表** / **测试聊天连接**          | Available when connection details allow           | Fetching reads the provider's model directory; testing sends a short message to a selected model and may use quota. A successful directory fetch does not prove chat works.                                                                        |
| **基础地址**                                 | Provider's standard endpoint when known           | Overrides where Scribe sends requests. A custom OpenAI-compatible provider must have a Base URL. Ollama defaults to `http://localhost:11434/v1`; LM Studio defaults to `http://localhost:1234/v1`.                                                 |
| **启用 CORS**                                | On for a new provider; saved choice retained      | Uses the compatibility connection for Agent Chat and Quick tools. Responses normally arrive after completion instead of word by word; stopping locally cannot cancel a request already sent to the server.                                         |
| **模型 ID → 添加** (Model ID → Add)          | Blank                                             | Adds an exact model ID manually. Use this when an endpoint cannot list models. A typed ID can be removed from the candidate list with its remove button.                                                                                           |
| **搜索可用模型…** (Search available models…) | Blank                                             | Filters discovered, previously configured, and manually added models. Check each model you want to save. Model rows can show context size, release date, and capabilities when known.                                                              |
| **保存 / 取消** (Save / Cancel)              | Save disabled until the setup is usable           | Save requires at least one model, required keys and connection fields, and no address-parsing error. Failed connection checks do not themselves prevent saving; saving does not prove that the provider is reachable or the key works.             |

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

**技能** 页统一管理当前库 `.scribe/skills` 内的技能，聊天菜单与设置页使用同一份资料。页首一行包含搜索框、**恢复内置技能** 和 **添加技能**；技能列表在窗口重新聚焦和每次修改后自动刷新。通过“添加技能”选择 **Agent 创建、系统搜索、本地导入**，没有空白新建入口。Agent 创建会打开自动引用内置 skill-creator 技能的聊天（已停用时先询问启用）；Agent 草稿须检查全文并点击保存后才安装；本地导入可在弹窗中直接拖放文件夹或 ZIP，也可点击选择，系统搜索支持逐项及批量复制，均不改动原始来源。

每行提供 **立即使用、启用开关、三点菜单（仅卸载）**。点击名称或说明在设置页内打开详情；顶部显示名称、版本、来源、全局启用及立即使用，左侧是“源文件”树，右侧预览或编辑所选文件。个人技能直接编辑完整描述文件和可读支持文件，名称、说明、作者、版本、标签和调用方式等配置均在原文中保留；内置技能仅预览。详情编辑自动保存，切换文件或返回前完成保存；保存冲突保留当前草稿，可重试或重新载入。切换到 Obsidian 的其他设置后再打开同一技能，可继续未保存的修改；重启插件前请等到“已保存”。Agent 创建确认仍须点击保存。已有额外属性会保留，遇到外部修改时拒绝用旧内容覆盖。格式有误的个人技能可让 Agent 修复。

首次使用会安装七个只读内置技能，默认启用。可以停用、卸载或通过“恢复内置技能”恢复；卸载状态在重启和升级后保留。升级不会覆盖同名个人技能；内置文件在应用外改过时，保留原件并由用户选择是否重置。安装技能不会自动安装其所需的外部程序。

- 只有启用的技能进入聊天的可调用清单；允许模型调用的技能可由模型选择。
- 不允许手动调用的技能不会出现在 `/` 菜单，“立即使用”也不可用。
- 导入是独立副本；同一来源重新导入时需确认替换，包括库内的个人修改。跨来源同名不能覆盖。
- 没有来源标识的现有技能按“本地”展示，继续可用。外部修改在刷新或重新打开设置后读取。
- 不自动扫描项目工作目录，不创建技能链接，不读取或清理旧位置资料。系统搜索仅在用户打开或刷新时读取列明的电脑技能位置。

更多说明见 [Skills](agent-mode-and-tools.md#skills)。

## 代理扩展

在 **Agent 配置** 可调整子代理的共享执行名额、等待数量和每项任务的模型调用次数，默认分别为 3、20 和 100。等待批准或输入的子代理仍占执行名额；调用次数包含主对话、全部子代理、重试和上下文整理。达到上限保留进度，继续需要明确操作，不会被当成已完成。

**子代理聊天打开位置** 决定从子代理列表点击某个子代理时聊天界面的位置：右侧边栏（默认）、左侧边栏或悬浮面板。悬浮面板可拖拽和调整大小，不遮挡主聊天。

当前提供 **Skills、Commands、Subagents** 三类原生入口。列表显示实际注册的技能、已有 Scribe 命令和自定义子代理，通用子代理委派能力继续保留。

命令页的 **刷新并检查** 核对当前可用状态；技能页在聚焦和修改后自动刷新，子代理页的 **刷新** 重新读取定义。这些操作均不发送聊天消息，也不执行工具。命令和子代理均可新建、编辑、启停和删除。子代理可以分别设置名称、用途说明和自定义指令，定义独立保存在当前库 `.scribe/subagents/<稳定标识>.json` 中；刷新或重新打开页面会重新读取外部修改。主代理能发现已启用的子代理，并按其指令真实委派任务。子代理沿用当前聊天的模型和操作权限，不单独配置密钥。修改影响后续委派，已运行任务继续使用启动时的设置；删除子代理保留已有聊天和任务结果。

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

命令编辑器从上到下依次为名称、模型、在右键菜单中显示、指令变量替换和提示词。斜杠菜单显示选项已移除，因为自定义命令不再出现在 Agent Chat 的 `/` 菜单中。

| Control                         | Default                 | What it does                                                                                                                                       |
| ------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **已启用**                      | On                      | 控制整条指令是否可调用。关闭后不能从右键、命令面板或快捷键调用；右键菜单显示偏好仍保留，重新开启后恢复原样。                                       |
| **Drag handle**                 | Saved order             | Reorders commands in the list.                                                                                                                     |
| **Right-click**                 | On for a new command    | Shows the command in the editor right-click menu.                                                                                                  |
| **编辑**                        | Not applicable          | Opens the command editor.                                                                                                                          |
| **创建副本**                    | Not applicable          | Creates a uniquely named copy beside the original.                                                                                                 |
| **删除**                        | Not applicable          | After confirmation, moves the shared command file to Scribe’s trash inside `.scribe`. It disappears from the shared list and its shortcut entries. |
| **名称**                        | Blank for a new command | Required unique command name.                                                                                                                      |
| **内容** / **提示词**           | Blank for a new command | Required command text, labeled **内容** under **命令** and **提示词** under **我的指令**. The latter editor shows the supported note variables.    |
| **模型（可选）**                | **默认模型**            | Selects a configured chat model for editor and command-palette runs.                                                                               |
| **在右键菜单中显示**            | On                      | Same setting as **Right-click** in the list.                                                                                                       |
| **保存 / 取消** (Save / Cancel) | Not applicable          | Save validates and writes the command file.                                                                                                        |

See [Scribe Commands and Quick Ask](custom-commands.md) for prompt variables, invocation, and Quick Ask.
