# Agent Chat

Agent Chat is the default Scribe experience on desktop. It gives an AI agent a working view of your vault so it can answer questions, use tools, and make permissioned changes while you follow the work in chat.

Agent Chat follows a growing response until you scroll up to read earlier messages. Select the round down-arrow near the bottom of the chat, or scroll to the end, to follow new output again.

Quick Ask and Quick Command remain available for inline questions and edits on desktop and mobile. For multi-step work, Projects, Skills, or file changes, start with Agent Chat.

Your sent messages display Markdown formatting, including headings, lists, code blocks, links, and image embeds. Copy and Edit keep the original Markdown text. Links and image embeds in saved chats resolve from the conversation note, even when another note is open.

Selecting a note in Agent Chat, such as a file on a tool card, a drawing on a Scribe card, a link in a reply, or **Open note** in a change review, switches to the tab where that note is already open, including one in a popout window. A new tab opens only when the note isn't open. To open another tab anyway, Cmd-click (Ctrl-click on Windows and Linux) or middle-click it.

## Set up Claude

Open [**Settings → Scribe → 代理**](settings.md#agents) and configure Claude. It is the only agent used for new chats.

Previously saved chat records are not deleted. Agent conversations now run through Claude; the previous agent's running state is not restored.

### Claude

Opening **Configure** checks the local Claude Code installation without restarting an unchanged agent or clearing its current status. If the check finds an unavailable or unsupported installation, Scribe reports that result.

打开 Claude 的“配置”时会检查本机安装情况。安装状态没有变化时，不会重启代理或让界面反复切换；若发现安装不可用或版本不受支持，仍会正常显示问题。

The Claude backend runs through Claude Code on your computer:

1. Open **代理 → Claude Code → Configure**.
2. Select **Auto-detect**, or enter the absolute path to the `claude` executable.
3. Select **Sign in** if Claude Code is not already authenticated, then finish in your browser. If the page does not open, select **Open sign-in page**. You can cancel and try again.
4. Enable the models you want and choose a default.

Claude Code stores the credentials on your computer. Scribe checks its sign-in status when the login finishes. To run the login command yourself, use **Sign in using a terminal instead**.

Claude models and billing come from your Claude Code account. Models added under **模型** do not join the Claude model list.

For Windows-specific installation help, see [Windows setup for Agent Chat](agent-mode-windows-setup.md).

### Start a chat

Select the **Agent Chat** ribbon icon or run **Open Scribe Agent Chat window** from the command palette. From an open note, select the Scribe icon beside the note's view controls to open Agent Chat with that note attached to your next message. If Agent Chat is already open, the icon brings it into view; otherwise, it opens in the right sidebar. If Claude is missing, its custom binary is outdated or unusable, or it is not signed in, Scribe shows the reason and a **Configure** action. If Claude is still starting, wait for that launch to finish. **Configure** remains available while you wait. If you already have a chat open, Scribe keeps the conversation and your unsent draft visible and shows a warning above the chat.

An empty Agent Chat shows a fixed hint: "Ask anything • @ to add context • / for commands".

Agent Chat groups consecutive tool calls and reasoning into a compact activity row. Activities open by default while a reply is running and automatically close when it finishes, including details you opened while it was running. You can reopen them after completion. Each completed reply keeps its own **Worked for** duration at the start of its first activity row, followed by the tool commands, distinct files read or edited, and recorded reasoning time. A reply without activities shows its duration above the text. The send time remains below the reply. While an answer is being generated, the animated timer continues to update. Older replies without a recorded duration remain undated for elapsed time.

**Insert / Replace at cursor** uses the note you focused before entering Agent Chat, including when the chat occupies an editor tab. A selection in that note is replaced; otherwise the reply is inserted at its cursor. The note must still be open. If it has been closed, or there was no previous note, Scribe opens a blank tab without writing the reply into another note.

You can see the installed Scribe version at the top of **Settings → Scribe**.

## Models, effort, and permissions

Agent Chat uses the models reported by Claude Code. BYOK models belong to Quick tools.

- 在 [**Settings → Scribe → 代理**](settings.md#agents) 中选择可用模型；模型来自 Claude Code，列表中的第一个已启用模型是默认项。推理强度沿用代理默认，也可在聊天中调整。
- Use the controls beside the composer to change the model or effort for the current chat.
- **Effort** appears only when the selected agent and model support it. Higher effort can improve difficult reasoning but may take longer and use more of your account allowance.
- Models with effort controls always use a concrete effort. A supported saved effort is kept; otherwise Scribe chooses the lowest supported effort and updates the saved default. Models without effort controls omit effort. **Agent default** clears the saved model preference; the new session shows the agent's model and its resolved effort.
- Reloading an agent keeps each open chat's model and effort. If that model is no longer enabled for the agent, or is still waiting for its API key, the chat falls back to your saved default, or to one of your enabled models.

The permission picker shows only choices supported by the current agent:

| Choice   | What it does                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------- |
| **Safe** | Allows edits under the agent's approval rules                                                        |
| **Plan** | Drafts a plan and waits for your approval before editing when the current agent supports this choice |
| **Auto** | Reduces approval prompts according to the current agent's automatic permission rule                  |

Claude supports **Safe**, **Plan**, and **Auto**. Its **Auto mode permissions** setting controls how much Auto may approve.

When an action needs approval, Agent Chat displays a **Permission required** card with the proposed change or tool input. Choose one of the temporary or persistent allow or deny options offered by that agent. The one-time allow is highlighted. Hover an "always" option to see what it covers and how long it lasts: Claude names its rule and the settings file it saves to. Claude offers "Allow always" only when it has a rule to save. **Stop** cancels the agent's unanswered requests. A running subagent's requests stay open.

When Claude asks a set of questions, answer the current tab and select **Next**. On the final tab, **Submit** becomes available after every question has an answer. You can use the tabs to review or skip ahead. **Cancel** dismisses the entire request.

Permission and question cards stay in a scrolling action area above the message box until you answer them, even while the response continues streaming.

Your vault or project is the agent's working directory, not a security sandbox. Auto or bypass permissions can reach other files and services available to the agent or your account. Use **Safe** for unfamiliar work and review persistent permissions carefully.

## Context and history

Agent Chat keeps each conversation separate:

- Select **+** for another session. Each tab keeps its own history, draft, attachments, and queued follow-ups.
- Select **New chat** to reset the current tab.
- Select **Stop** to cancel the current turn. Messages the agent has not read yet return to the message box, with their notes, web pages and images, so you can edit or resend them. They come before the current draft, and custom commands return as their expanded text. Subagents and background commands keep running; stop each one from the running-tasks list.
- Use **Recent chats** from the Agent Chat home screen, or **Chat history** inside a conversation, to resume saved work. The **Recent chats** list can be scrolled or searched.
- Hover a chat in **Recent chats** and select **Pin chat** to keep it at the top of the list, above a divider. The most recently pinned chat comes first, and pinned chats keep their order when you use them or change how history is sorted. Select **Unpin chat** to return it to its usual place. The pin is saved in the chat's Markdown note, so it lasts across restarts and appears in both the global and the Project list. Pinning a chat that has no note yet saves it as a note first, even when autosave is off. **Chat history** inside a conversation ignores pins.
- The bar above the composer holds **New chat**, **Save chat as note** (when autosave is off), **Chat history**, and **More actions** (⋯), and starts with a task count when the chat has tasks. Completed tasks stay available in that menu. **More actions** has **Copy chat link**, **Add to bookmarks**, and **Report an issue**. **Copy chat link** and **Add to bookmarks** stay dimmed until you send the chat's first message.
- To bookmark the open chat in Obsidian's **Bookmarks** pane, select **More actions** above the composer and choose **Add to bookmarks**. To bookmark a chat without opening it, hover it in **Recent chats**, select **More actions** (or right-click the row), and choose **Add to bookmarks**. The bookmark uses the chat's title, and clicking it opens the chat in Agent Chat. A chat that has no note yet is saved as one first, even when autosave is off. Choose **Remove from bookmarks** to remove it. Deleting the chat from **Recent chats** also removes its bookmark, while renaming the chat keeps the bookmark's title. While the **Bookmarks** core plugin is turned off, **Add to bookmarks** is dimmed, with an info icon explaining why. Selecting it opens **Settings → Core plugins** filtered to **Bookmarks** so you can turn it on.
- Select **More actions** above the composer and choose **Report an issue** to report a problem with the current chat, with its screenshot and agent details ready. See [Reporting from Agent Chat](troubleshooting-and-faq.md#reporting-from-agent-chat).
- Select **More actions** above the composer and choose **Copy chat link** to copy an `obsidian://` link to the current conversation. Paste it into another note to reopen the chat in the same vault. The link points to the conversation's Markdown note, so Scribe saves the note first if it does not exist yet, including when autosave is off. The link keeps working after the note is renamed. To copy a link without opening the chat, hover it in **Recent chats**, select **More actions**, and choose **Copy chat link**. A chat that has no note yet is saved as one first.
- Properties you add to an Agent chat note stay when Scribe saves the chat again. Scribe updates only the properties it manages: the agent, session, project, token usage, and tags.
- A spinner marks a chat while its agent is responding or one of its background tasks runs. Closing a chat's tab keeps it running. When the response stops but the session remains live, a small blue dot appears on the bottom-right corner of the chat icon. Hover the row and select **Close chat** to release that session. Saved history stays available to reopen, and other chats keep running. If the agent does not support closing individual sessions or release fails, the chat stays marked live with an error.
- Deleting an Agent chat removes Scribe's chat note and its entry in Scribe's chat history. Claude Code may keep its own copy of the conversation on your computer. Scribe does not delete or change those files, so you can still resume the chat in that agent's own tool. The confirmation and the notice after the delete both say this. Deleting an open chat closes it and stops any reply in progress.
- Add the active note, selected text, other notes, folders, a Scribe Web Viewer tab, or supported images. You can also mention a note with `[[Note title]]`.
- Hover the context ring beside the send controls to see how much of the model's context window is in use. The ring stays empty until the agent reports usage, and a stopped response keeps the last reported reading. If the connected account reports usage limits, the same panel shows the available limit and reset time.

You can send an image without adding text, for example when the agent asks for a screenshot. Choose a model that supports images.

Attachments apply to the next message. For instructions and context that should be reused, create a [Project](projects.md) or add rules to [`AGENTS.md`](system-prompts.md). See [Context and Mentions](context-and-mentions.md) for every context option.

Uploaded images are embedded in saved conversation notes. Scribe stores the image files under `<Scribe folder>/scribe-conversations/attachments/`, not in your vault attachment folder, and saves each unique image once per conversation. Identical images in the same conversation reuse the saved attachment, including when it has been deleted. Later saves preserve attachment links updated by Obsidian or an attachment organizer; deleting a saved attachment leaves a missing image instead of recreating the file.

Type `/` to insert an enabled Skill or [Scribe command](custom-commands.md). For a quick question or rewrite beside the current selection, use [Quick Ask](custom-commands.md#quick-ask).

### Fork a conversation

Select **Fork conversation** beside the insert button below any finished assistant reply. Scribe opens a new chat containing the complete visible conversation up to that reply, including images, attached-note references, selected text and tool activity. The new chat uses the same agent, project, model and effort. The original conversation and its running tasks stay unchanged.

The new branch gets its own saved identity, so saving it does not overwrite the source chat. Its first new message sends the inherited conversation as context without silently trimming it. Missing attachments, unsupported images or a model's context limit produce an error instead of dropping content. Image inheritance supports PNG, JPEG, GIF and WebP. Tool activity is retained for reference; running tasks are not duplicated, and project files stay at their current versions.

Task details, reply durations and branch history are also saved locally for this vault on this computer, even when saving Markdown conversation notes is turned off. These supplementary records preserve image content and can take additional disk space. They are not included when you share only the Markdown note. Existing records cannot recover details that were never saved. A save failure is shown explicitly.

### Compact a long chat

When a conversation grows long, choose **/compact** at the start of an empty message to have the agent summarize it and free up room in its context window. The `/` menu offers **/compact** only at the start of a message, and it replaces any Skill or command named exactly `compact`. Anything you type after `/compact` is sent with it, so an agent that accepts compaction instructions, such as Claude, can use them.

- Attached notes, web pages, images, and agent mentions are not sent with `/compact`. Project context waits for your next regular message.
- A queued `/compact` runs as its own turn instead of joining other queued messages. If you stop the current turn, the other queued messages return to the message box without it.

Agents also compact on their own when the context window fills up. Either way, the chat shows the progress in line with the conversation:

| Status                                                       | Meaning                                                                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Compacting conversation…**                                 | The agent is summarizing the chat after **/compact**                                                 |
| **Context is full, compacting…**                             | The agent started compacting on its own                                                              |
| **Context compacted** or **Context compacted automatically** | The summary is done. When the agent reports them, the token counts before and after follow the label |
| **Couldn't compact**                                         | Compaction failed. The reason appears with the row or below it                                       |
| **Compaction cancelled**                                     | You stopped the turn before compaction finished                                                      |
| **Nothing to compact yet**                                   | The chat is too short to summarize                                                                   |

When a finished compaction reports its new size, the context ring drops to that size instead of keeping the reading from before it.

### When a reply stops early

A model can only write so much in one reply. When a reply runs out of room partway through a step, such as writing a long note, that step never runs. Its row shows as failed instead of spinning, and Scribe asks the agent once, in the same reply, to continue in smaller steps. Scribe never continues a turn you stopped or one the model refused, and it continues only once per message.

If the reply still stops early, it ends with a **Stopped early** notice that names the cause: the model hit its output limit, the agent hit its step limit, or the model's safety system stopped it. The last step may not have run. Send another message to continue.

A step cut short by **Stop** shows as stopped. Any other step the agent left unfinished when its turn ended shows as failed, including in chats you reopen from history.

## While the agent works

### Send a message

You can type and send while the agent works. The button beside the message box is **Stop** while the agent's reply runs and the box is empty. Otherwise it is **Send**. With Claude, the message waits above the message box under **The agent reads these at its next step**, then moves into the chat when the agent reads it. Select **Withdraw queued message** to take it back into the message box, or **Send now** to stop the agent's current reply so it reads every waiting message right away. Background subagents and commands keep running.

### Background subagents and commands

Claude runs subagents and long commands in the background unless it needs to wait on one, so you can keep chatting. A task appears as soon as Claude starts launching it. When one finishes, Claude replies with its result on its own. The chat's spinner stays on until every subagent has finished and Claude has replied about it.

- Open the task count above the composer to see **Running** and **Completed** groups, newest first. Failed, stopped and interrupted tasks remain in the completed group with their actual status.
- Select a task, or its card in the chat, to open a floating dialog inside Obsidian showing a subagent's steps or a command's output. The chat, scroll position and draft stay in place underneath it. Opening the same task again brings its existing dialog forward. Closing the dialog does not stop the task.
- Completed details remain available after restarting and reopening the chat. Command output retains the last 256 KB and indicates when earlier output is omitted. Work that cannot be confirmed running after reopening is marked **Interrupted** and is not automatically restarted.
- Select **Stop task** on a task to end only that task. It turns on once the task starts.

## Review what a turn changed

When a turn finishes after the agent has edited your vault, a **Files changed** card closes that turn. It lists one row per note, with the number of added and removed lines, and a **new** or **deleted** badge for notes the agent created or removed. The card totals the changes in its header and scrolls when a turn touched many files. A subagent's edits show on a card in that subagent's view instead.

Select a row to open that note's before and after in a floating dialog inside Obsidian, leaving the main chat in place. Removed text is struck through, added text is highlighted, and everything else reads as the note normally does, including the blank lines between paragraphs, so you can see the exact wording the agent changed without leaving Obsidian. The comparison is read-only and never writes to your vault; use **Open note** in its header to open the note itself and edit it there. Files that are not notes, such as canvases, are shown as a plain line-by-line comparison.

In a long note, a narrow strip along the left edge of the comparison shows where the changes are. The strip stands for the whole note, with one mark for each change at its position in the note: green where text was added, red where it was removed, and blue where both happened. Select a mark to jump to that change.

The header shows which change you are at, such as "1 of 6". Use the up and down arrows beside it to move to the previous or next change; moving past the last change returns to the first. The **Go to next change in file diff** and **Go to previous change in file diff** commands do the same, so you can assign them hotkeys in Obsidian's settings.

Selecting the same row again brings its existing comparison dialog forward. Press Escape to close the top dialog. New file-change cards are saved with the chat's local supplementary records and can be reopened after a restart. Older chats without saved change records cannot reconstruct the earlier file versions.

The card covers the notes an agent changed with its editing tools. Changes an agent makes by running a shell command, such as deleting a note with `rm`, are not listed. Treat the card as a review aid rather than a complete audit of the turn.

## Skills with Claude

技能把一套可重复使用的说明交给 Claude。打开 [**Settings → Scribe → Skills**](settings.md#skills)，先选本地用户、当前资料库或项目，再新建、编辑或启停个人技能。

Scribe 内置的 Obsidian 技能始终启用且只读，旧的关闭选项不会继续生效。插件技能也只能查看，调整它们应到 **Plugins** 页管理父插件。尚未安装 Claude、命令行功能未开启或存在文件冲突时，页面会如实说明；配置启用不等于已加载。

`obsidian-cli` 仍要求在 Obsidian 的 **Settings → General** 开启 **Command line interface**。自建技能和附加文件请放在自己的技能目录中，避免写入由 Scribe 维护的内置目录。

可以在 Agent Chat 输入 `/` 选择允许手动调用的技能，也可以描述任务，让 Claude 选择可自动调用的技能。被标为“仅手动调用”的技能需要明确请求；隐藏于 `/` 菜单的技能仍可能由 Claude 自动使用。

## Check extensions without sending a message

打开 **Plugins、Skills、Commands、Hooks、MCP、子Agent** 任一配置页或切换来源时，会自动检查所选范围内的实际可用性；也可选择 **Refresh and check** 重新检查。不需要发送聊天消息，也不会创建聊天标签。

六页的列表分成两类：能通过开关启用或停用的条目显示开关，开启表示检查确认可用，关闭表示确认不可用；不能单独控制的条目没有开关，检查确认可用时正常显示，未启用时在名称右侧显示红点，悬停或查看详情可了解原因。检查中、结果未知或等待已有任务结束时，开关灰化并附小图标。受安装位置、登录、加载失败或父插件等条件限制的事项不显示开关而显示红点。列表按**已安装**、**内置**分组，插件附属事项按所属插件单独分组；所属插件未启用时，其附属事项不出现在各页面。已有聊天在当前任务及后台任务结束后应用更改。

插件详情显示介绍、版本、安装记录及插件包含的五类事项。详情页不显示开关，各事项不可用时以红点说明原因。插件加载成功与内部各事项可用性分别判断。

这项检查不会逐个执行工具。正常启动 Claude 仍可能连接扩展服务并触发已配置的启动钩子；钩子已注册不代表它已经执行成功。完整操作说明见 [Agent extensions](settings.md#agent-extensions)。

## Excalidraw drawings

While the Excalidraw plugin (2.29 or later) is enabled, Claude Code reads, draws, and edits Excalidraw drawings through Scribe's Excalidraw tools. The Excalidraw plugin builds each drawing, so labels stay inside their shapes and arrows stay attached when you move a shape. There is no skill to turn on.

- Ask for a diagram, flowchart or chart, for example "Draw a diagram of the steps in [[Release process]]". The agent draws it in Excalidraw and embeds it in the note it belongs to. Ask for a Mermaid diagram or a canvas to get that instead. Creating a drawing never overwrites an existing file.
- Select shapes in an open drawing to point the agent at them, for example "make these red". The selection is attached to your next message, like selected text. Clicking empty canvas removes it.
- When the agent edits a drawing, Obsidian opens it in a tab and saves each change.
- After drawing or editing, the agent looks at a picture of the result and fixes overlaps before it answers.
- In the chat, a Scribe card marks each drawing the agent draws, edits or reads. Click the drawing's name to open it.

## Applying a settings change

Agents read their configuration when they start: API keys, enabled models, instructions, and skills. A change you make while a chat is open does not reach the agent already running. Agent Chat says so with a **settings changed** notice and a **Reload** action, and the chat keeps working in the meantime.

The notice identifies Claude when it needs to reload. Settings an agent can apply without restarting do not need a reload notice.

Choose **Reload** when you want the change to take effect. The agent restarts and reopens every chat using that agent, keeping each chat’s history and anything you had typed but not sent. During a running turn the reload waits for that turn to finish. If the agent cannot reopen a conversation, that tab starts a fresh chat and the old one remains under Recent chats. If a chat failed to start, correct its settings and choose **Retry** to apply them.

## Related

- [Getting Started](getting-started.md)
- [Models, Effort, and Permissions](models-and-parameters.md)
- [Projects](projects.md)
- [Instructions for Agent Chat](system-prompts.md)
- [Scribe Commands and Quick Ask](custom-commands.md)

### Updating Claude Code

If Scribe reports that Claude Code is too old, open **Configure** in **代理 → Claude Code**, update Claude Code with the installation command shown there, and run **Auto-detect** again. For a custom installation, update the saved binary or clear the override to use an auto-detected one.

Image-only messages appear as "Image attachment" in the queue. Sessions with only images use the same fallback title in tabs and Recent chats until a text or agent-generated title is available.
