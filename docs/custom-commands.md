# Scribe Commands and Quick Ask

Scribe commands are prompts you save once and reuse. They are best for repeatable jobs such as fixing grammar, summarizing a note, or rewriting selected text.

For a fast question or rewrite while you are editing, use **Quick Ask** instead.

## Commands or skills?

Enabled commands and skills that allow manual invocation appear when you type `/` in Agent Chat. You can also run saved commands from the editor or command palette.

| Use                | Best for                                                                     | Managed in                                       |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| **Scribe command** | A short, repeatable prompt with optional note variables                      | [**Settings → Scribe → 命令**](settings.md#命令) |
| **Skill**          | A reusable agent workflow that can include instructions and supporting files | [**Settings → Scribe → 技能**](settings.md#技能) |

Skills can be enabled for Scribe Agent Chat. Commands stay inside Scribe and also work from the editor and Obsidian command palette.

An isolated test found that if an available skill and an enabled command share a name, the slash menu shows the skill, but sending can expand the command instead. Until this is fixed, avoid invoking a shared name in Agent Chat.

隔离测试发现，当可用技能和已启用指令同名时，斜杠菜单显示技能，但发送后可能展开指令。修复前请不要在代理聊天中调用名称重复的技能或指令。

## Create a command

1. On desktop, open [**Settings → Scribe → 命令**](settings.md#命令). On desktop or mobile, you can also open **Settings → Scribe → 我的指令**.
2. Click **新建代理命令** on **命令**, or **添加指令** on **我的指令**.
3. Enter a **名称** and the command text, labeled **内容** on **命令** or **提示词** on **我的指令**. The **命令** editor also offers an optional **说明**. Click **保存**.
4. To adjust the model and menu preferences, use **我的指令**.

Choose **默认模型** to use the first available chat model configured under **Settings → Scribe → 模型**. A command-specific model applies to editor and command-palette runs. A slash run uses the model selected for that Agent Chat.

If a saved command’s explicit model is unavailable, edit it under **Settings → Scribe → 我的指令** or repair its connection under **模型**, then rerun the command. A command with an explicit model does not silently switch to another one. Changing the popup picker does not retry the original saved-command run. Quick Ask and Quick Command keep your unsent input while you choose a model.

**命令** 页列出 Scribe 已注册的命令，支持新建、编辑、启停和删除。独立的 **我的指令** 页提供复制、拖动排序、单条模型选择、变量填充和菜单偏好。变量填充、排序和默认指令生成直接显示在列表上方，不再有“指令选项”折叠标题。

每条 Scribe 指令都有独立的启用开关。关闭后不能从右键菜单、命令面板、快捷键或聊天 `/` 调用。**在右键菜单中显示** 和 **在斜杠菜单中显示** 的偏好会保留，重新启用时恢复原样；仅隐藏某个菜单并不会停用整条指令。

Use **生成默认指令** for a starter set. You can edit, duplicate, delete, or drag commands to reorder them. **指令排序** controls their order in the slash menu.

### Add note context to a prompt

For editor and command-palette runs with **指令变量替换** enabled, these variables add vault context:

| Variable           | Adds                                                       |
| ------------------ | ---------------------------------------------------------- |
| `{}`               | Selected text, or the active note when nothing is selected |
| `{activeNote}`     | The active note                                            |
| `{[[Note Title]]}` | A specific note                                            |
| `{Folder/Path}`    | Notes in a folder path                                     |
| `{#tag1, #tag2}`   | Notes with any listed property tag                         |

For example:

```text
Rewrite {} as a concise project update. Match the style of {[[Writing Guide]]}.
```

Tags must be in note properties, not only written inline in the note body.

In Agent Chat, command expansion inserts selected text for `{}` when available and otherwise uses a link to the active note, if one is available. Note links, folder paths, and tags are sent as references rather than automatically expanded into note contents, regardless of the **指令变量替换** switch. The agent may use available tools to inspect them, but this is not guaranteed. Separately attached context can include note contents; see [Context and Mentions](context-and-mentions.md).

## Run a command

- **From the editor:** select text if needed, then right-click and choose **Scribe → _command name_**. The command must have **在右键菜单中显示** enabled.
- **From the command palette:** run **应用自定义指令**, then choose an enabled command. Each enabled command is also registered by name in the palette.
- **From Agent Chat:** type `/`, choose a command, add any extra instruction, and send. Choosing an item inserts it without sending, so you can review it first.

Editor and command-palette runs open a result panel. You can refine the result, copy it, insert it at the cursor, or replace the original selection.

## Quick Ask

**Quick Ask** is the fastest inline flow for a question, explanation, or rewrite.

1. Select text, or place the cursor where you are working.
2. Run **快捷提问** from the command palette, or choose **Scribe → 快捷提问** from the editor menu. You can assign a hotkey under **Obsidian Settings → Hotkeys**.
3. Ask your question. Use the model picker if needed, and enable **笔记** (**Note** in English) to include the full active note.
4. Use **复制到剪贴板**, **在光标处插入**, or **替换选中文字** on the answer. You can continue with follow-up questions in the same panel.

Quick Ask is an inline panel with its own model choice. Configure providers and chat models under [模型](settings.md#模型). It starts with the first available configured chat model, shared with **运行快捷指令** and saved commands set to **默认模型**. Model changes in either popup apply only to that popup; there is no separate shared default setting. The **笔记** choice is remembered and shared.

Quick Ask is unavailable in Source mode. **替换选中文字** appears only when text was selected and stays available only while Scribe can safely identify the original text in the same note and editor pane.

## Quick Command

Run **运行快捷指令** when you want a one-off instruction for selected text without saving a command. A selection is required. The panel starts with the same default model and **笔记** preference as Quick Ask and offers the same copy, insert, and replace actions.

Quick Command is also unavailable in Source mode.

## Where commands are stored

Each command is a Markdown file in `<Scribe folder>/scribe-custom-prompts/`. The filename is the command name, and **命令** 页与 **我的指令** 共用同一份命令文件. Deleting a command in either place removes it from the shared list and its shortcuts, and sends its file to the location configured by Obsidian for deleted files. Change the root under [**Settings → Scribe → Agent 配置 → Scribe 文件夹位置**](settings.md#agent-配置).

Isolated tests found that changing a command's enabled state or recording its use can alter high-precision numbers in additional properties in its file. Back up your files first and disable Scribe until this and the other [file safety issues](troubleshooting-and-faq.md) are fixed; pending saves may finish during shutdown.

隔离测试发现，切换指令的启用状态或记录使用情况时，指令文件中额外属性的高精度数字可能被改写。请先备份现有文件，再暂时停用 Scribe，直到此问题及其他[文件安全问题](troubleshooting-and-faq.md)修复；关闭时程序可能完成之前排队的保存。

When upgrading from older command settings, Scribe migrates supported commands to these files. If a name cannot be migrated, Scribe keeps it under the `unsupported/` subfolder and shows a startup notice.

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [Getting Started](getting-started.md)
