# Agent Chat

Agent Chat 是 Scribe 的桌面聊天工作区。Scribe 直接在 Obsidian 内运行自己的代理，沿用你已配置的模型、密钥和连接地址。开始聊天不需要安装或登录外部代理程序。

Quick Ask、Quick Command 继续用于编辑器旁的简短提问和改写，也保留移动端入口。

## Set up Scribe

1. 打开 **Settings → Scribe → 快捷操作 → 模型与供应商**，添加供应商或本机模型，并填写它需要的连接信息。
2. 在 **代理 → Scribe** 中启用要用于聊天的模型，选择默认模型和权限模式。支持时，可在聊天输入框旁调整本次聊天的推理强度。
3. 点击 Agent Chat 图标，或运行 **打开 Scribe 代理聊天窗口**，输入任务。

没有可用模型时，请检查供应商连接并在代理设置中启用模型。已有连接可能需要重新检查，不同设备的密钥不会自动共享；Agent Chat 与快捷工具可以分别启用模型。Anthropic 也通过同一套模型与供应商设置接入。

隔离测试发现，即使代理模型全部停用，状态仍可能显示就绪；如果设置中的密钥引用在本机没有对应密钥，也可能显示可用但启动失败。在[文件安全问题](troubleshooting-and-faq.md)修复后，请分别检查 **代理 → Scribe** 中的模型开关和 **快捷操作 → 模型与供应商** 中的密钥。测试使用替身宿主，未验证真实桌面或设备密钥。

Isolated tests found that the agent may still appear ready when all its models are disabled, or appear available but fail to start when a saved key reference has no key on this device. After the [file-safety issues](troubleshooting-and-faq.md) are fixed, check the model switches under **代理 → Scribe** and the key under **快捷操作 → 模型与供应商**. The tests used a simulated host, not a real desktop or device credentials.

## Models, effort, and permissions

输入框旁的模型选择只影响当前聊天。推理强度按模型支持的选项显示；更改后在下一次请求中使用。具体支持情况和费用由你的模型服务决定。

| 模式        | 行为                                                                                 |
| ----------- | ------------------------------------------------------------------------------------ |
| **Default** | 可以读取和搜索笔记；写入笔记、修改绘图和执行系统命令通常需要批准。                   |
| **Plan**    | 保持计划模式时阻止编辑和系统命令；可以审阅、拒绝计划或附反馈退回修改。               |
| **Auto**    | 通常自动允许资料库内普通笔记及绘图编辑；资料库配置目录中的编辑和系统命令不自动放行。 |

权限卡显示具体操作、发起者、命令或文件信息。编辑和命令可选择在当前聊天中始终允许或始终拒绝相同操作；已保存的决定会先于 Auto 的自动放行规则生效，因此系统命令不一定每次都弹卡。其他请求以卡片实际提供的选项为准。**Stop** 取消当前回复及其尚未回答的请求。

批准计划后，当前聊天会切回 **Default**。你也可以手动切换模式，后续操作按所选模式和已保存的授权执行。手动在聊天中切换权限模式，还会更新之后打开聊天时使用的默认模式；批准计划后的自动切换不会更改这个默认值。

提问卡支持多题导航、选项和自行填写。提交后，答案回到提出这组问题的工具；取消会结束这次等待。

笔记工具原本限定在当前资料库内，但隔离测试发现：如果文件夹在检查后、写入前被替换，写入可能覆盖资料库外的文件；如果资料库内外的两个文件入口指向同一份文件，正常写入也会同时改动库外内容。系统拒绝写入时，原笔记也可能受损，或留下不完整的新文件。修复前，请暂时不要让代理写入或编辑笔记，包括使用 **Auto** 或已记住的授权；需要修改时，请先确认文件未与库外文件共用，再手动编辑，不确定时先另存为新笔记。经批准的系统命令使用你的电脑权限，可能访问资料库以外的文件或服务。

Note tools are intended to stay inside the current vault. Isolated tests found that replacing a folder after the check but before a write can overwrite an outside file. A normal write can also change an outside file when the vault entry and outside entry refer to the same file. If the system refuses a write, an existing note can be damaged or a new file left incomplete. Until this is fixed, do not ask the agent to write or edit notes, including through **Auto** or saved permissions. Before editing manually, confirm that the note does not share a file with an outside entry; if unsure, first save its contents as a new note. Approved system commands use your computer's permissions and may access files or services outside the vault.

## Context and history

打开的聊天分别保留自己的草稿、待发送附件和排队消息；切换聊天不会把另一条聊天的问题或草稿带进来。这些未发送内容只保存在运行中的内存里，不属于已保存的聊天记录。隐藏聊天标签不一定会立即结束聊天，但结束聊天或退出 Obsidian 后不能依靠历史记录找回这些内容；请先另存需要的文字，并保留附件原件。

隔离测试发现，停用代理最后一个可用模型时，当前聊天可能结束，未发送的草稿也会丢失。更改模型前请先另存草稿；测试未验证真实桌面上的全部恢复情况。

Isolated tests found that disabling the agent's last enabled model can close the current chat and discard its unsent draft. Save the draft elsewhere before changing models; recovery on a real desktop has not been fully verified.

- 通过原输入区添加笔记、编辑器选区、网页、图片和其他支持的附件；输入 `@` 或 `[[` 选择笔记。
- 项目保留自己的说明、上下文和聊天列表。共享技能可以复用；当前版本可能无法自动发现项目目录中的技能。
- **最近聊天** 和 **聊天历史** 保留查找、重命名、分叉、保存为笔记、复制链接、书签和删除入口。删除一条聊天会移除它的会话记录、快照和已保存的会话笔记；删除前请确认笔记中没有需要保留的内容。
- 消息下面可以复制正文、在编辑器光标处插入或替换，以及从该处建立新的聊天分支。
- 新的原生会话使用独立的记录。重新打开可恢复的聊天时，Scribe 会载入已保存的对话，以便继续提问；过往工具活动只回放显示，不会重跑终端或重新写文件。中断的任务不会自动重启，结果不明时请先检查实际文件和任务。旧外部代理的会话不导入、不接续；原有的会话笔记仍可作为资料库文件查看，但不能保证在当前 Agent Chat 中打开或继续。

回复支持显示 Markdown、代码块和供应商实际提供的可展示思考内容。是否逐步显示取决于连接方式；使用缓冲连接时，内容通常在响应完成后显示。向上滚动时不会强制跳回最新位置；使用原来的向下按钮可继续跟随。

上下文环显示模型实际返回的用量；没有数据时保持缺数状态。这里不再显示外部代理账户的订阅额度。

### Fork a conversation

在一条已完成的回复下选择 **分叉对话**，可从该位置建立独立的新聊天。原来的聊天和任务保留。保存的工具活动作为历史显示，分叉不会复制执行它们。

### Compact a long chat

在输入开头选择 **/compact**，可让当前模型总结较长的聊天。模型上下文窗口已知，且上一条助手回复报告的用量达到窗口的 80% 时，Scribe 会在发送下一条普通消息前尝试自动压缩；窗口未知时不会自动触发。聊天中分别显示进行、完成、失败、取消或无需压缩；完成后可继续追问。

Use **/compact** at the start of an input to ask the current model to summarize a long chat. Automatic compaction is attempted before the next ordinary message only when the model's context window is known and the previous assistant reply reported usage of at least 80% of that window. An unknown window does not trigger it automatically. The chat shows whether compaction is running, completed, failed, cancelled, or unnecessary.

### When a reply stops early

模型拒答、输出长度上限和每轮步数上限会显示提前停止提示；主动停止时不一定另有文字提示。连接等错误可能在已有部分回复时不显示，重新打开聊天后错误信息也可能缺失。如果回复不完整或操作结果不确定，请先检查实际文件和任务，再发送新消息继续。

## While the agent works

### Send a message

可以在代理工作时继续输入。排队消息在代理下一步读取后才进入对话；**撤回排队消息** 将尚未读取的内容及附件放回输入框。**立即发送** 会停止当前回复，再立即处理等待消息。

### Background subagents and commands

Scribe 可以委派真实子代理，也能执行前台或后台系统命令。每个任务有自己的身份、输出和状态。子代理在独立上下文中工作，将结果交回父聊天，并使用对应的权限请求。

打开输入区上方的任务入口，可以查看子代理详情、后台命令的真实输出尾部、截断提示及成功、失败或停止状态。关闭详情仅关闭视图。**停止任务** 停止指定任务；其他任务继续运行。主回复结束后，后台任务仍可单独保持运行。

## Review what a turn changed

工具活动保留原有的读取、搜索、编辑、命令、网页和技能卡片。展开后可查看真实参数、路径和结果，并从原入口打开笔记。

写入或编辑后，变更摘要显示实际文件数和修改前后的差异。拒绝执行的操作不会被列成已写入。绘图在已发生部分修改后失败时，也保留实际变更。

## Skills

在 **Settings → Scribe → 技能** 管理 Scribe 技能。可查看和编辑你管理的技能，调整是否允许模型调用或在 `/` 菜单中显示。

隔离测试发现，内置技能缺少文件时，启动、更改或重置设置、刷新技能时可能覆盖已修改的参考文件并删除新增文件；启用同名技能还可能删除已有目录并误报成功。请先备份现有文件，再暂时停用 Scribe，直到问题修复；关闭时程序可能完成之前排队的保存。

Isolated tests found that startup, changing or resetting settings, or refresh can overwrite edited support files and delete added files when a built-in skill is missing a file. Enabling a same-named skill can also delete an existing folder while reporting success. Back up your existing files first, then disable Scribe until these issues are fixed; pending saves may finish during shutdown.

隔离测试还发现，保存技能的描述或启用状态时，文件中额外属性的高精度数字可能被改写；真实技能设置界面尚未核验。

Isolated tests also found that saving a skill's description or enabled state can alter high-precision numbers in additional file properties. The real skill settings interface has not yet been verified.

在聊天中输入 `/` 选择允许手动调用的技能或已启用的 [Scribe 命令](custom-commands.md)。模型也可以调用已注册且允许自动调用的技能。已发现的项目技能仅供对应项目使用；当前版本可能无法自动发现项目目录中的技能。

隔离测试发现，若可用技能与已启用指令同名，菜单显示技能，但发送后可能展开指令。修复前请不要在代理聊天中调用名称重复的技能或指令；详见[指令说明](custom-commands.md#commands-or-skills)。

An isolated test found that a same-named enabled command may be expanded when a skill is selected. Until this is fixed, avoid invoking a shared name in Agent Chat; see [Commands or skills?](custom-commands.md#commands-or-skills).

Scribe 内置 Obsidian Markdown、Bases、Canvas 等说明技能。`obsidian-cli` 技能仍需要在 Obsidian 的 **Settings → General → Command line interface** 开启命令行功能。

## Check extensions without sending a message

**Skills、Commands、Subagents** 页面使用 Scribe 实际注册的条目。**刷新并检查** 核对其状态，不发送模型消息，也不为了检查而执行任务。

命令与 **快捷操作 → 我的指令** 共用同一份 Scribe 命令文件；新建、编辑、启停和删除会影响共享列表及相应快捷入口。删除会把命令文件移至 Obsidian 配置的回收位置，而不只是从当前页面移除。更完整的自定义指令选项位于 **我的指令**。子代理页显示内置委派能力及详情。

本版本不加载旧外部代理的插件市场、插件包、启动钩子或 MCP 配置，也不提供这些安装和导入入口。机器上原有的外部配置文件保留。

## Excalidraw drawings

启用支持的 Obsidian Excalidraw 插件后，Scribe 会注册原有绘图读取、图片预览和写入工具。模型可以按任务选择这些工具。

绘图仍由 Excalidraw 插件创建和保存；写入服从所选权限模式，聊天保留专用卡、打开绘图入口和实际文件差异。插件未启用或某项功能不受支持时，Scribe 显示对应原因。

## Feedback

模型可以起草 Scribe 问题报告；草稿只属于发起它的聊天。你可以审阅、编辑、取消或提交，模型起草本身不会发送报告。也可以从聊天的原菜单自行 **反馈问题**。

## Applying a settings change

已有聊天会按其当前任务状态应用配置更改，等待中的变更会显示状态。需要重新加载时，可以使用 **重新加载**；Scribe 会尝试恢复已保存的聊天和当前草稿。重新加载失败时不能保证草稿保留，请先另存需要的未发送内容。

## Related

- [Getting Started](getting-started.md)
- [Models, Effort, and Permissions](models-and-parameters.md)
- [Projects](projects.md)
- [Instructions for Agent Chat](system-prompts.md)
- [Scribe Commands and Quick Ask](custom-commands.md)
