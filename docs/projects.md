# Projects

Projects are focused workspaces inside Agent Chat. Each Project keeps its own instructions, reusable context, and chat history, so ongoing work for a client, codebase, course, or research topic stays together.

A Project works with the Scribe agent. It uses the agent, model, effort, and permission setting selected for the current chat. It does not lock you to a separate model.

On the Agent Chat home screen, open **Projects** to browse your most recently used Projects. Scroll the list to see more, or use **Search projects** to find a Project by name or description. Search includes every Project, even those you have not scrolled to yet.

## Create a Project

1. Open **Agent Chat** from the ribbon or command palette.
2. From the Agent Chat home screen, open **Projects** and select **新建项目**.
3. Enter a name and select **创建**.

Scribe opens the new Project immediately. Creation asks only for a name. Use **编辑项目** to add a description, instructions, and saved context.

Each Project has a folder under `<Scribe folder>/projects/`. The default root is `scribe/projects/`. Its `project.md` file stores Project details and the context list. Its `AGENTS.md` file contains the instructions you own and edit.

## Add Project instructions

Open the Project info menu beside the name and select **AGENTS.md**. You can also choose **编辑项目** from the Projects list and edit **Project instructions**. Both open the same Project file.

Scribe provides both the vault-wide instructions and the Project `AGENTS.md` to the model for chats in that Project. Avoid conflicting rules: Scribe does not enforce a guaranteed winner when the files disagree.

Useful Project instructions include:

- the goal and intended audience;
- important source and output folders;
- the expected deliverable format;
- naming, style, or citation rules; and
- actions that should always require confirmation.

Keep stable rules in `AGENTS.md` and put one-off requests in chat. Save the file before sending the next request. See [Instructions for Agent Chat](system-prompts.md).

## Add reusable context

For a new Project, **Context** appears below the composer. After the Project has chats, it appears as a **Context** tab beside **最近聊天**.

You can:

- drag a vault file or folder into **Context**;
- select **URL** to add a web page or YouTube video; or
- select **管理** or **管理参考内容** to add **Links**, **Tags**, **Properties**, **Folders**, and **Files**, or to manage **忽略文件**.

Tags match tags stored in note properties. Properties can target notes by a frontmatter field, such as `Topics: Physics`.

With the first ordinary message in a new Project chat, Scribe gives the agent a list of saved sources: folders, notes, and files by their location, and web pages and YouTube videos as links. The list contains at most 100 entries; if more are available, it reports how many were omitted. Files are not downloaded or converted in advance. The agent can try to inspect the sources when needed, subject to its available tools and access.

For an existing Project chat, Scribe reads the current instruction files when starting each response. Later changes to saved context can trigger a notice asking the agent to re-check the Project sources, rather than replacing the original list. Start a new chat when you need a fresh list. The `/compact` command does not carry the initial list or update notice; these wait for an ordinary message.

### File and link support

The native agent can read Markdown, plain-text, and source files with its text tools. Files such as PDFs, Office documents, EPUBs, spreadsheets, and images are not automatically converted: a path in the list does not guarantee the agent can read the file. It may need another tool, a suitable Skill, or an approved system command. To send an image directly, attach it to a message and select a model that supports images.

The agent can try to open saved links with its web tool or an enabled custom Skill. Access can fail, and a page or video transcript may not be available. If needed, provide the text or transcript yourself.

> **Private Projects:** When a chat starts, Scribe does not upload a Project's files or fetch its links. The initial list of file paths and links goes to the selected model with the first ordinary message, subject to the entry limit. The agent can then request files or links with its tools. For work that stays on your device, use a local model, local tools, and review the agent's network access and enabled custom Skills.

**忽略文件** filters some matches when Scribe builds the source list. It does not necessarily remove notes or folders you explicitly included, and it is not a file permission setting. An agent can still find an ignored file through tools that can access it.

## Work with Project chats

Inside a Project:

- **最近聊天** and **聊天历史** show that Project's conversations.
- **新建聊天** starts a clean conversation with the latest Project instructions and context.
- **退出项目** returns to the Agent Chat home screen.

From the Projects list, hover over a Project to **在库中显示**, **编辑项目**, or **删除** it. The global **最近聊天** list on the Agent Chat home screen includes conversations from across Projects.

Deleting a Project removes its Scribe Project configuration. It does not delete your ordinary vault notes or conversation notes already saved in the vault.

## When to use a Project

Use a Project when a task has a stable scope or will continue across several chats. Use a one-turn [context attachment](context-and-mentions.md) when the material matters only for the next message. Use the vault-root `AGENTS.md` when an instruction should apply everywhere.

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [`AGENTS.md` Examples](agents-md-examples.md)
