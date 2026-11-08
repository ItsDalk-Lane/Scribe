# Scribe Commands and Quick Ask

Scribe commands are prompts you save once and reuse. They are best for repeatable jobs such as fixing grammar, summarizing a note, or rewriting selected text.

For a fast question or rewrite while you are editing, use **Quick Ask** instead.

## Commands or skills?

The `/` menu in Agent Chat is grouped into **commands, skills, and subagents**. Skills that allow manual invocation appear under **Skills**, enabled subagents under **Subagents** (selecting one delegates your task text to it), and the built-in `/compact` plus custom Agent commands under **Commands**. Saved commands are not part of the `/` menu; run them from the editor or command palette.

| Use                | Best for                                                                     | Managed in                                               |
| ------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Scribe command** | A short, repeatable prompt with optional note variables                      | [**Settings → Scribe → 命令**](settings.md#命令)         |
| **Skill**          | A reusable agent workflow that can include instructions and supporting files | [**Settings → Scribe → 技能**](settings.md#技能)         |
| **Subagent**       | Delegating a task to a dedicated agent with its own instructions             | [**Settings → Scribe → 代理扩展**](settings.md#代理扩展) |

Skills can be enabled for Scribe Agent Chat. Commands stay inside Scribe and also work from the editor and Obsidian command palette.

## Create a command

1. Open **Settings → Scribe → 我的指令**.
2. Click **添加指令**.
3. Enter a **名称** and the **提示词**. Click **保存**.
4. To adjust the model and the context-menu preference, edit the command from the same list.

Choose **默认模型** to use the first available chat model configured under **Settings → Scribe → 模型**. A command-specific model applies to editor and command-palette runs.

If a saved command’s explicit model is unavailable, edit it under **Settings → Scribe → 我的指令** or repair its connection under **模型**, then rerun the command. A command with an explicit model does not silently switch to another one. Changing the popup picker does not retry the original saved-command run. Quick Ask and Quick Command keep your unsent input while you choose a model.

**我的指令** 页提供新建、复制、拖动排序、单条模型选择、变量填充和菜单偏好。变量填充和默认指令生成直接显示在列表上方，不再有“指令选项”折叠标题。代理配置中的 **命令** 页只列出 Agent 内建的命令条目及其可用性，自定义指令的创建和编辑都在 **我的指令** 完成。

每条 Scribe 指令都有独立的启用开关。关闭后不能从右键菜单、命令面板或快捷键调用。**在右键菜单中显示** 的偏好会保留，重新启用时恢复原样；隐藏右键菜单并不会停用整条指令。

Use **生成默认指令** for a starter set. You can edit, duplicate, delete, or drag commands to reorder them. The drag order is the order shown in **我的指令**.

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

## Run a command

- **From the editor:** select text if needed, then right-click and choose **Scribe → _command name_**. The command must have **在右键菜单中显示** enabled.
- **From the command palette:** run **应用自定义指令**, then choose an enabled command. Each enabled command is also registered by name in the palette.

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

Each command is a Markdown file in the fixed vault-root `.scribe/scribe-custom-prompts/` folder. The filename is the command name, and **命令** and **我的指令** share the same files. Deleting a command removes it from the list and shortcuts and moves its file to Scribe’s trash inside `.scribe`.

Isolated tests found that changing a command's enabled state or recording its use can alter high-precision numbers in additional properties in its file. Back up your files first and disable Scribe until this and the other [file safety issues](troubleshooting-and-faq.md) are fixed; pending saves may finish during shutdown.

隔离测试发现，切换指令的启用状态或记录使用情况时，指令文件中额外属性的高精度数字可能被改写。请先备份现有文件，再暂时停用 Scribe，直到此问题及其他[文件安全问题](troubleshooting-and-faq.md)修复；关闭时程序可能完成之前排队的保存。

Old command settings and files in previous locations are not imported or modified. Create or save commands in the new location to use them.

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [Getting Started](getting-started.md)
