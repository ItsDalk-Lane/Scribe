# Getting Started with Scribe

Scribe is built around **Agent Chat**, a desktop workspace where Scribe can read your vault, use tools, and complete multi-step work with the permissions you choose.

Agent Chat is available in Obsidian on desktop. Scribe Commands, Quick Command, and Quick Ask remain available for shorter tasks and on mobile.

**Current safety notice:** Isolated tests found risks to existing files during startup migrations, credential changes, cache cleanup, and note writes. Back up your files first, then disable Scribe until these issues are fixed; pending saves may finish during shutdown. The setup steps below are for use after the fixes. See [Troubleshooting](troubleshooting-and-faq.md).

**当前安全提示：** 隔离测试发现启动迁移、更改密钥、清除缓存和写入笔记时存在文件受损风险。请先备份现有文件，再暂时停用 Scribe，直到问题修复；关闭时程序可能完成之前排队的保存。以下设置步骤应在修复后执行，详见[故障排查](troubleshooting-and-faq.md)。

## Install Scribe

1. Copy `main.js`, `manifest.json`, and `styles.css` into your vault’s `.obsidian/plugins/scribe/` folder. `.obsidian` is the default configuration folder; if your vault uses a different configuration folder, use that folder instead.
2. Open **Obsidian Settings → Community plugins** and enable Scribe. The Agent Chat icon appears in the left ribbon on desktop.

Scribe uses its own settings and data. Chats from other plugins are not automatically imported.

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

The language choice affects interface text. If Scribe is enabled, reloading it can also trigger the separate startup behavior described in the safety notice above.

语言选择影响界面文字；如果 Scribe 处于启用状态，重新加载还可能触发上方安全提示中所述的启动流程。

## Set Up Your First Agent Chat

打开 **Settings → Scribe → 模型**（英文为 **Settings → Scribe → Models**），配置供应商或本机模型。保存后即可在聊天中选择，无需另行启用；模型选择器按供应商分组，供应商卡片上的开关可让该供应商的全部模型整体退出选择器。已有连接可能需要重新检查；不同设备的密钥不会自动共享。无需安装或登录外部代理程序。首次新聊天使用配置的第一个可运行模型和自动权限模式，之后记住你最近一次成功的模型、推理强度和权限选择。

## Start Your First Agent Chat

1. Click the **Agent Chat** ribbon icon, or run **打开 Scribe 代理聊天窗口** (**Open Scribe Agent Chat window** in English) from the command palette.
2. 文件安全问题修复后，若模型不可用，请在 **模型** 检查供应商、模型及本机密钥，详见[故障排查](troubleshooting-and-faq.md)。

   After the file-safety issues are fixed, if a model is unavailable, check the provider, model and device key under **Models**. See [Troubleshooting](troubleshooting-and-faq.md).

3. Pick a model and permission setting beside the message box, then describe the outcome you want.

Try a concrete first request such as: “Review the unfinished tasks in this vault and make a short plan.” With **Default** selected, Agent Chat shows its work and asks before actions that need your approval.

## Projects, Skills, and Commands

### Keep Work Focused with Projects

From Agent Chat Home, open **项目** (**Projects** in English) and select **新建项目**. A project keeps its own instructions, reusable context, and chat history, so work for one client or topic stays together. See [Projects](projects.md) for supported context sources and setup.

### Use Skills

在 **Settings → Scribe → 技能** 管理自己的技能，并为 Scribe 启用。输入 `/` 选择允许手动调用的技能；已允许模型调用的技能也可由模型按任务选择。技能统一来自当前库技能目录，可供不同项目使用。

Scribe 附带七个只读内置技能，默认启用，可卸载并恢复。通过“添加技能”选择 Agent 创建、系统搜索或本地导入；Agent 创建需你检查完整草稿并确认保存。此前保存的技能按“本地”展示，继续可用。更多信息见 [Skills](agent-mode-and-tools.md#skills)。

### Reuse Scribe Commands

Create preset prompts under **Settings → Scribe → 我的指令** on desktop or mobile, and run them from the command palette or the editor's **Scribe** menu. Agent 斜杠命令在 **命令** 页创建（仅桌面端），通过 Agent Chat 输入框的 `/` 菜单使用。 See [Scribe Commands and Quick Ask](custom-commands.md).

### Ask Without Leaving the Editor

Run **快捷提问** from the command palette, or assign it a hotkey under **Obsidian Settings → Hotkeys**. It opens a small prompt beside your cursor or selection for quick rewrites, explanations, and follow-up questions. Quick Ask starts with the first available configured chat model. Configure a provider or local model under **模型** first.

## Next Steps

- [Agent Chat](agent-mode-and-tools.md): agents, permissions, context, models, and skills
- [Projects](projects.md): focused agent workspaces
- [Scribe Commands and Quick Ask](custom-commands.md): reusable prompts and in-editor help
- [Models and providers](llm-providers.md): Agent Chat 和快捷工具共用的模型连接
- [Scribe Settings](settings.md): every settings tab explained
