# Projects

Projects are focused workspaces inside Agent Chat. Each Project keeps its own instructions, reusable context, and chat history, so ongoing work for a client, codebase, course, or research topic stays together.

A Project works with the Scribe agent. It uses the agent, model, effort, and permission setting selected for the current chat. It does not lock you to a separate model.

On the Agent Chat home screen, open **项目** (**Projects** in English) to browse your most recently used Projects. Scroll the list to see more, or use **搜索项目…** (**Search projects...** in English) to find a Project by name or description. Search includes every Project, even those you have not scrolled to yet.

## Create a Project

1. Open **Agent Chat** from the ribbon or command palette.
2. From the Agent Chat home screen, open **项目** and select **新建项目**.
3. Enter a name. Optionally select **选择文件夹** (**Choose folder** in English) to use an existing folder in this vault, including an empty folder or the vault root.
4. Select **创建**.

Scribe opens the new Project immediately and shows its working location. Without a folder selection, Scribe creates a folder with the Project's name at the vault root. If that folder already exists, creation stops: select it explicitly or choose another name. Selecting an existing folder uses that folder directly; Scribe does not move or copy its notes.

Use **编辑项目** to add a description, instructions, and saved context. The edit screen and Project info show the working location. Renaming a Project changes its name in Scribe; it does not rename or move the working folder.

Project details and the saved context list are kept in the vault-root `.scribe` folder. The working folder is separate and holds your ordinary notes and the Project's `AGENTS.md`. Scribe does not create another `.scribe` folder inside it. Vault-wide instructions remain in the vault-root `AGENTS.md`.

Projects from earlier storage locations are not imported automatically. Their files stay untouched. To continue using an existing working folder, create a new Project and select that folder explicitly.

## Add Project instructions

Open the Project info menu beside the name and select **AGENTS.md**. You can also choose **编辑项目** from the Projects list and edit **项目说明** (**Project instructions** in English). Both edit the instructions in the working folder. A hidden working folder is supported; its instruction file opens with the system's default application.

Scribe provides both the vault-wide instructions and the Project `AGENTS.md` to the model for chats in that Project. Avoid conflicting rules: Scribe does not enforce a guaranteed winner when the files disagree.

Useful Project instructions include:

- the goal and intended audience;
- important source and output folders;
- the expected deliverable format;
- naming, style, or citation rules; and
- actions that should always require confirmation.

Keep stable rules in `AGENTS.md` and put one-off requests in chat. Save the file before sending the next request. See [Instructions for Agent Chat](system-prompts.md).

## Add reusable context

For a new Project, **上下文** (**Context** in English) appears below the composer. After the Project has chats, it appears as a **上下文** tab beside **最近聊天**.

You can:

- drag a vault file or folder into **上下文**;
- select **URL** to add a web page or YouTube video; or
- select **管理** or **管理参考内容** to add **链接** (Links), **标签** (Tags), **属性** (Properties), **文件夹** (Folders), and **文件** (Files), or to manage **忽略文件**.

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

Deleting a Project removes only its Scribe configuration. The working folder, `AGENTS.md`, and all notes remain in their original location. Opening a Project does not automatically replace existing instructions. If you later create another Project for that folder, select the existing folder explicitly.

## When to use a Project

Use a Project when a task has a stable scope or will continue across several chats. Use a one-turn [context attachment](context-and-mentions.md) when the material matters only for the next message. Use the vault-root `AGENTS.md` when an instruction should apply everywhere.

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [`AGENTS.md` Examples](agents-md-examples.md)
