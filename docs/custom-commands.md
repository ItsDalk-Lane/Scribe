# Scribe Commands and Quick Ask

Scribe commands are prompts you save once and reuse. They are best for repeatable jobs such as fixing grammar, summarizing a note, or rewriting selected text.

For a fast question or rewrite while you are editing, use **Quick Ask** instead.

## Commands or skills?

Commands appear when you type `/` in Agent Chat. Skills appear only in the Agent Chat `/` menu. You can also run saved commands from the editor or command palette.

| Use                | Best for                                                                     | Managed in                                       |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| **Scribe command** | A short, repeatable prompt with optional note variables                      | [**Settings → Scribe → 命令**](settings.md#命令) |
| **Skill**          | A reusable agent workflow that can include instructions and supporting files | [**Settings → Scribe → 技能**](settings.md#技能) |

Skills can be enabled for Scribe Agent Chat. Commands stay inside Scribe and also work from the editor and Obsidian command palette. If a command and skill have the same name, the skill takes the slash-menu spot.

## Create a command

1. Open [**Settings → Scribe → 命令**](settings.md#命令).
2. Click **新建**.
3. Enter a **Name** and **Prompt**, then click **保存**.
4. To adjust the model and menu preferences, use **快捷操作 → 我的指令**.

Choose **默认模型** to use **快捷指令默认模型** from **Settings → Scribe → 快捷操作 → 工具配置** (also shown under **我的指令**). A command-specific model applies to editor and command-palette runs. A slash run uses the model selected for that Agent Chat.

If a saved command’s selected model or the shared default is unavailable, configure it in **Settings → Scribe → 快捷操作**, then rerun the command. Scribe does not substitute your chat model or another enabled model, and changing the popup picker does not retry the original command. Quick Ask and Quick Command keep your unsent input while you choose a model.

**命令** 页列出 Scribe 已注册的命令，支持新建、编辑、启停和删除。**快捷操作 → 我的指令** 继续提供复制、拖动排序、模型选择、变量填充和菜单偏好。模型、变量填充、排序和默认指令生成收在列表下方的“指令选项”中。

每条 Scribe 指令都有独立的启用开关。关闭后不能从右键菜单、命令面板、快捷键或聊天 `/` 调用。**在右键菜单中显示** 和 **在斜杠菜单中显示** 的偏好会保留，重新启用时恢复原样；仅隐藏某个菜单并不会停用整条指令。

Use **生成默认指令** for a starter set. You can edit, duplicate, delete, or drag commands to reorder them. **指令排序** controls their order in the slash menu.

### Add note context to a prompt

With **指令变量替换** enabled, these variables add vault context:

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

Tags must be in note properties, not only written inline in the note body. When you run a command from Agent Chat, the active agent resolves note, folder, and tag references with its vault tools.

## Run a command

- **From the editor:** select text if needed, then right-click and choose **Scribe → _command name_**. The command must have **在右键菜单中显示** enabled.
- **From the command palette:** run **应用自定义指令**, then choose any command. Each saved command is also registered by name in the palette.
- **From Agent Chat:** type `/`, choose a command, add any extra instruction, and send. Choosing an item inserts it without sending, so you can review it first.

Editor and command-palette runs open a result panel. You can refine the result, copy it, insert it at the cursor, or replace the original selection.

## Quick Ask

**Quick Ask** is the fastest inline flow for a question, explanation, or rewrite.

1. Select text, or place the cursor where you are working.
2. Run **快捷提问** from the command palette, or choose **Scribe → 快捷提问** from the editor menu. You can assign a hotkey under **Obsidian Settings → Hotkeys**.
3. Ask your question. Use the model picker if needed, and enable **Note** to include the full active note.
4. Use **复制到剪贴板**, **在光标处插入**, or **替换选中文字** on the answer. You can continue with follow-up questions in the same panel.

Quick Ask is an inline panel, not an Agent Chat session. It uses an enabled [BYOK](settings.md#模型) model from **快捷操作 → 工具配置**, not the model selected in Agent Chat. It starts with **快捷指令默认模型**, shared with **运行快捷指令** and saved commands set to **默认模型**. Model changes in either popup apply only to that run; change the shared default in **Settings → Scribe → 快捷操作 → 工具配置**. The **Note** choice is remembered and shared.

Quick Ask is unavailable in Source mode. **替换选中文字** appears only when text was selected and stays available only while Scribe can safely identify the original text in the same note and editor pane.

## Quick Command

Run **运行快捷指令** when you want a one-off instruction for selected text without saving a command. A selection is required. The panel starts with the same default model and **Note** preference as Quick Ask and offers the same copy, insert, and replace actions.

Quick Command is also unavailable in Source mode.

## Where commands are stored

Each command is a Markdown file in `<Scribe folder>/scribe-custom-prompts/`. The filename is the command name, and **命令** 页与 **快捷操作 → 我的指令** 共用同一份命令文件. Deleting a command in either place removes it from the shared list and its shortcuts, and sends its file to the location configured by Obsidian for deleted files. Change the root under [**Settings → Scribe → 通用 → 常规 → Scribe folder location**](settings.md#通用).

When upgrading from older command settings, Scribe migrates supported commands to these files. If a name cannot be migrated, Scribe keeps it under the `unsupported/` subfolder and shows a startup notice.

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [Getting Started](getting-started.md)
