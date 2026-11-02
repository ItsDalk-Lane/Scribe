# Getting Started with Scribe V4

Scribe V4 is built around **Agent Chat**, a desktop workspace where Claude Code can read your vault, use tools, and complete multi-step work with the permissions you choose.

Agent Chat is available in Obsidian on desktop. Scribe Commands, Quick Command, and Quick Ask remain available for shorter tasks and on mobile.

## Install Scribe

1. Copy `main.js`, `manifest.json`, and `styles.css` into your vault’s `.obsidian/plugins/scribe/` folder.
2. Open **Obsidian Settings → Community plugins** and enable Scribe. The Agent Chat icon appears in the left ribbon on desktop.

Scribe starts with its own settings and data; it does not automatically import Copilot settings or chats.

### Install or update with BRAT

If you install plugins from GitHub with [BRAT](https://github.com/tfthacker/obsidian42-brat):

1. Install and enable **Obsidian42 - BRAT** from Obsidian's community plugins.
2. Run **BRAT: Add a beta plugin for testing** from the command palette.
3. Enter `ItsDalk-Lane/Scribe` and confirm. Scribe installs from the latest GitHub release.
4. Use BRAT's **Check for updates** to receive new Scribe releases.

BRAT downloads the release files Scribe publishes, so updates do not need the manual copy above. A new release can take a few minutes to appear after it is published.

## Interface language / 界面语言

Scribe automatically follows Obsidian's interface language. Chinese language settings use Simplified Chinese; other languages use English. If Obsidian's language cannot be read, Scribe uses the device language instead. There is no separate Scribe language setting. After changing Obsidian's language, use Obsidian's relaunch option to apply the change to both apps. Changes to the device language take effect the next time Scribe loads and only apply when Obsidian's language is unavailable.

Scribe 自动跟随 Obsidian 的界面语言：中文环境显示简体中文，其他语言显示英文。只有无法读取 Obsidian 语言时，才使用设备的系统语言，无需单独设置。更改 Obsidian 语言后，按其提示重新加载，插件会同步切换。系统语言的变化会在插件下次加载时生效，并且仅在无法读取 Obsidian 语言时使用。

Language changes affect interface text only. Notes, chat history, custom command names, prompt contents, model names, and content returned by external agents are preserved.

语言切换只影响界面文字，不会修改笔记、聊天记录、自定义指令名称、提示词、模型名称或外部代理返回的原文。

## Set Up Your First Agent Chat

打开 **Settings → Scribe → 代理** 配置 Claude Code。目前只提供 Claude Code 代理。

### Connect Claude Code

If Claude Code is already installed, Scribe checks its common install locations automatically and marks **Claude** as installed. If it is not found:

1. Open **代理 → Claude Code → Configure**.
2. Select **Auto-detect**, or enter the path to the `claude` binary.
3. Sign in when prompted.

Claude uses the account held by the Claude Code CLI. You do not paste that account's key into Scribe.

## Start Your First Agent Chat

1. Click the **Agent Chat** ribbon icon, or run **Open Scribe Agent Chat window** from the command palette.
2. Claude opens automatically when it is ready. If setup is required, select **Configure** and connect Claude Code.
3. Pick a model and permission setting beside the message box, then describe the outcome you want.

Try a concrete first request such as: “Review the unfinished tasks in this vault and make a short plan.” With **Default** selected, Agent Chat shows its work and asks before actions that need your approval.

## Projects, Skills, and Commands

### Keep Work Focused with Projects

From Agent Chat Home, open **Projects** and select **New project**. A project keeps its own instructions, reusable context, and chat history, so work for one client or topic stays together. See [Projects](projects.md) for supported context sources and setup.

### Use Skills with Claude

Skills are reusable instruction packets for jobs such as reviewing a change or drafting a release note. Open **Settings → Scribe → Skills** to see skills from Scribe's shared skills folder and Claude's native skills folder. Enable each skill for Claude; Scribe creates the needed folder links for you.

Type `/` in Agent Chat to choose an available skill. Scribe also includes skills for Obsidian Markdown, Bases, Canvas, and the Obsidian CLI. Learn more in [Skills with Claude](agent-mode-and-tools.md#skills-with-claude).

### Reuse Scribe Commands

Create preset prompts under **Settings → Scribe → Commands**. Run them from the command palette, the editor's **Scribe** menu, or by typing `/` in Agent Chat. See [Scribe Commands and Quick Ask](custom-commands.md).

### Ask Without Leaving the Editor

Run **Quick Ask** from the command palette, or assign it a hotkey under **Obsidian Settings → Hotkeys**. It opens a small prompt beside your cursor or selection for quick rewrites, explanations, and follow-up questions. Quick Ask uses a model enabled under **快捷操作 → 工具配置**, so set up a BYOK or local model first.

## Next Steps

- [Agent Chat](agent-mode-and-tools.md): agents, permissions, context, models, and skills
- [Projects](projects.md): focused agent workspaces
- [Scribe Commands and Quick Ask](custom-commands.md): reusable prompts and in-editor help
- [Model Sources and BYOK](llm-providers.md): BYOK setup for Quick tools
- [Scribe Settings](settings.md): every settings tab explained
