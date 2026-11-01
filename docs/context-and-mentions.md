# Context and Mentions

Context is the material Scribe gives an AI with your request. Choose the shortest lifetime that fits the job:

Clicking a PDF page citation in a chat opens the target page at its top while keeping your current zoom. Citations to selected text, annotations, or an explicit position keep their original destination.

| Context type                     | How long it lasts                                 |
| -------------------------------- | ------------------------------------------------- |
| Agent Chat attachment or mention | The next message                                  |
| Project context                  | Every new chat started in that Project            |
| Vault or Project `AGENTS.md`     | Every Agent Chat started in that vault or Project |

## Add context to Agent Chat

Select **+** beside the Agent Chat composer to open **Add context**. Depending on what is open, you can add the **Active Note**, other **Notes**, **Folders**, the **Active Web Tab**, other **Web tabs**, or **Images**. Web tabs come from Scribe's desktop Web Viewer.

You can also select the Scribe icon in a note's header. Agent Chat opens with that specific note attached to the current draft. The attachment stays with the draft if you switch notes before sending.

You can also add context while typing:

- Type `[[` and select a note, PDF, or canvas to insert `[[Note title]]`.
- Type `@` to browse the available context categories.
- Choose a folder to insert its path as `{Folder/path}`.
- Paste or drag an image into the composer. The selected model must support images.

Context badges above the composer show what will be sent with the next message. Select the **x** on a badge to remove it. After the message is sent, one-turn attachments are cleared.

A note mention gives the agent the note's vault path so it can read the current file when needed. A folder mention points to a folder to inspect. It does not paste every file in that folder into the prompt.

### Active note and selected text

A new Agent Chat starts with an **Active Note** badge unless **Auto-attach active note** is off in settings. The badge stays attached to every message. Each message tells the agent which note is active when you send it, so switching notes mid-chat points the agent at the new note. The agent gets the note's path and opens the note only when it needs the contents. If you remove the badge, no active note is attached to later messages in that chat until you add the **Active Note** again from **Add context** or with `@`.

### Active web tab

When a page is open in the desktop Web Viewer, Agent Chat attaches it as an **Active Web Tab** badge on every message, so the agent sees the page you are reading, including pages you are signed in to. The page's full content is sent the first time. While it stays the same, later messages do not send it again, because the agent already has it earlier in the chat. If you go to another page, or the content changes, the new content is sent in full. If you remove the badge, no web page is attached to later messages in that chat, even after you open another page, until you add the **Active Web Tab** again from **Add context** or with `@`.

Active Note and selected text are separate attachments in Agent Chat. You can include either one or both, even when the excerpt comes from the active note. Removing one badge leaves the other attached. Selection badges show the start of the selected text. Hover over a badge to see the full excerpt and its source.

To attach an excerpt from a note:

1. Select the text.
2. Run **Add selection to chat context** from the command palette.
3. Review the removable selection badge before sending.

The manual selection command is available from the command palette or an assigned hotkey. The editor's Scribe menu contains Quick Ask, quick commands, and custom commands.

For text selected in the Web Viewer, run **Add web selection to chat context**. Scribe sends the selected excerpt together with the active web tab it came from.

Selected text in notes is automatically added to chat context as you select it in Reading or Edit view, and stays attached when you move to chat. Reading view selections show the note path without line numbers. On desktop, this also works with Web Viewer selections. Shapes selected in an Excalidraw drawing are attached the same way. Review or remove the selection badge before sending.

## Reuse context with Projects

For material that should be prepared for more than one chat, create a [Project](projects.md). Add saved context from the **Context** section or tab:

- drag in a vault file or folder;
- add a web page or YouTube URL; or
- select **Manage context** to add links, tags, properties, folders, files, and ignored files.

Project context is prepared for every new chat in that Project. If preparation is still running when you send a message, Scribe queues the message and starts it when the context is ready.

Saved context is a focus aid, not a permission boundary. The agent can still inspect other files available through its tools. **Ignore files** excludes files from prepared Project context but does not block an agent from reading them.

One-turn attachments remain one-turn attachments inside a Project. Start a new Project chat after changing saved context or Project instructions when you want the latest version applied.

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Projects](projects.md)
- [Instructions for Agent Chat](system-prompts.md)
