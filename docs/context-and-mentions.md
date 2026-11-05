# Context and Mentions

Context is the material Scribe gives an AI with your request. Choose the shortest lifetime that fits the job:

Clicking a PDF page citation in a chat opens the target page at its top while keeping your current zoom. Citations to selected text, annotations, or an explicit position keep their original destination.

| Context type                   | How long it lasts                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| One-turn attachment or mention | The next ordinary message                                                                      |
| Project context                | Listed on the first ordinary message of a new Project chat; changes can trigger a later notice |
| Vault or Project `AGENTS.md`   | Read when starting a response in an Agent Chat in that vault or Project                        |

## Add context to Agent Chat

Select **+** beside the Agent Chat composer to open **添加参考内容**. Depending on what is open, you can add the **当前笔记**, other **Notes**, **Folders**, the **当前网页标签页**, other **网页标签页**, or **Images**. Web tabs come from Scribe's desktop Web Viewer.

You can also select the Scribe icon in a note's header. Agent Chat opens with that specific note attached to the current draft. The attachment stays with the draft if you switch notes before sending.

You can also add context while typing:

- Type `[[` and select a note, PDF, or canvas to insert `[[Note title]]`.
- Type `@` to browse the available context categories.
- Choose a folder to insert its path as `{Folder/path}`.
- Paste or drag an image into the composer. The selected model must support images.

Context badges above the composer show what will be sent with the next message. Select the **x** on a badge to remove it. After the message is sent, one-turn attachments are cleared.

A note mention gives the agent the note's vault path so it can read the current file when needed. A folder mention points to a folder to inspect. It does not paste every file in that folder into the prompt.

### Active note and selected text

A new Agent Chat starts with an **当前笔记** badge unless **自动附加当前笔记** is off in settings. The badge stays attached to every message. Each message tells the agent which note is active when you send it, so switching notes mid-chat points the agent at the new note. The agent gets the note's path and opens the note only when it needs the contents. If you remove the badge, no active note is attached to later messages in that chat until you add the **当前笔记** again from **添加参考内容** or with `@`.

### Active web tab

When a page is open in the desktop Web Viewer, Agent Chat attaches it as an **当前网页标签页** badge on messages. Scribe tries to extract the page's readable content; for YouTube it handles video details and transcripts separately. Extraction can fail if the page is closed, not ready, or takes too long, so it does not guarantee the entire page is available. Content extracted from pages you are signed in to may be sent to the selected model: review the badge before sending. An unchanged extracted context is not sent again in the same chat; a changed page or result can be sent again. If you remove the badge, it stays off for later messages in that chat until you add it again from **添加参考内容** or with `@`.

Active Note and selected text are separate attachments in Agent Chat. You can include either one or both, even when the excerpt comes from the active note. Removing one badge leaves the other attached. Selection badges show the start of the selected text. Hover over a badge to see the full excerpt and its source.

To attach an excerpt from a note:

1. Select the text.
2. Run **将选中文字添加为聊天参考内容** from the command palette.
3. Review the removable selection badge before sending.

The manual selection command is available from the command palette or an assigned hotkey. The editor's Scribe menu contains Quick Ask, quick commands, and custom commands.

For text selected in the Web Viewer, run **将网页选中文字添加为聊天参考内容**. The selected excerpt includes its source title and URL; selecting text alone does not attach the whole page. A separately included web-tab context may send page content, and the active tab at send time may differ from the selection's source.

Selected text in notes is automatically added to chat context as you select it in Reading or Edit view, and stays attached when you move to chat. Reading view selections show the note path without line numbers. On desktop, this also works with Web Viewer selections. Shapes selected in an Excalidraw drawing are attached the same way. Review or remove the selection badge before sending.

## Reuse context with Projects

For material that should be prepared for more than one chat, create a [Project](projects.md). Add saved context from the **上下文** (**Context** in English) section or tab:

- drag in a vault file or folder;
- add a web page or YouTube URL; or
- select **管理参考内容** to add links, tags, properties, folders, files, and ignored files.

Scribe supplies an initial list of Project sources with the first ordinary message of a new chat. That list has a limit and does not automatically include the contents of every source; see [Projects](projects.md) for details.

Saved context is a focus aid, not a permission boundary. **忽略文件** filters some matching entries in the source list; it does not necessarily remove explicitly included notes or folders. The agent can still inspect files available through its tools.

One-turn attachments remain one-turn attachments inside a Project. Instructions are read again when a response starts. Start a new Project chat when you need a fresh list of saved context.

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Projects](projects.md)
- [Instructions for Agent Chat](system-prompts.md)
