<h1 align="center">Scribe for Obsidian</h1>

<p align="center"><strong>Agents for your Obsidian vault</strong></p>

<p align="center">Scribe brings an in-app agent to Obsidian for research, writing, and knowledge work.</p>

<p align="center"><a href="./docs/getting-started.md">Get started</a></p>

---

## Current safety notice

Isolated tests found that starting Scribe, changing or resetting its settings, or refreshing built-in skills can overwrite edited support files and delete added files when a built-in skill is missing a file. Removing a provider or changing its key can also affect a key shared with another provider; changing or clearing a key can affect another plugin's key. When two vaults on one device share a Scribe key-storage identifier, deleting all keys in one can also remove the other's keys. Backups made from older settings can contain unencrypted keys inside the vault and may be copied by sync. Keep a backup of your existing files first, then turn Scribe off under **Obsidian Settings → Community plugins** until these issues are fixed; Scribe may finish pending saves while shutting down. Do not change Scribe settings before the fixes. The cache cleanup command and agent note writes also have unresolved data-safety issues. See [Troubleshooting](./docs/troubleshooting-and-faq.md).

隔离测试发现，内置技能缺少文件时，启动 Scribe、更改或重置设置、刷新技能可能覆盖已修改的参考文件并删除新增文件。移除供应商或更改其密钥也可能影响与其他供应商共用的密钥；更改或清空密钥还可能影响其他插件的密钥。如果同一设备上的两个资料库共用 Scribe 密钥存储标识，在一个库中删除全部密钥也可能移除另一个库的密钥。旧设置生成的备份可能在资料库内保留明文密钥，并可能随资料库同步。请先备份现有文件，再在 **Obsidian 设置 → 社区插件** 中暂时关闭 Scribe，直到这些问题修复；关闭时程序可能完成之前排队的保存。修复前不要更改 Scribe 设置。清除缓存命令与代理笔记写入也有尚未解决的数据安全问题，详见[故障排查](./docs/troubleshooting-and-faq.md)。

## Upstream project

Scribe is a fork of [Obsidian Copilot](https://github.com/logancyang/obsidian-copilot), based on upstream version **4.0.17**. This repository tracks upstream releases and selectively syncs the updates this project can use; **4.0.17** is the currently followed upstream version, and this record is updated whenever a sync lands. Scribe's own version numbering is independent of upstream and starts at 1.0.0.

## Work with Scribe

**Agent Chat** is Scribe's desktop workspace for multi-step work. The in-app agent can inspect notes, use tools, create Obsidian files, and continue across several turns with permissions you control.

Agent Chat and Quick tools use the providers, API keys, connection addresses, or local models you configure in Scribe. Agent Chat does not require an external agent installation or login. Provider terms and usage limits still apply.

[Learn how Agent Chat works →](./docs/agent-mode-and-tools.md)

## Set up Scribe

1. Install Scribe using the steps in the [Getting Started guide](./docs/getting-started.md).
2. Open **Settings → Scribe → 快捷操作 → 模型与供应商** (**Settings → Scribe → Quick actions → Models and providers** in English) and add a provider or local model.
3. Under **代理 → Scribe** (**Agents → Scribe** in English), enable a model for Agent Chat.
4. Select the **Agent Chat** ribbon icon, or run **打开 Scribe 代理聊天窗口** (**Open Scribe Agent Chat window** in English).

## Built around your vault

- **Projects:** Give ongoing work its own instructions, reusable context, and chat history. [Learn about Projects](./docs/projects.md).
- **Skills:** Add reusable instructions for Scribe. Built-in skills cover Obsidian Markdown, Bases, Canvas, and the Obsidian CLI. [Learn about Skills](./docs/agent-mode-and-tools.md#skills).
- **Commands:** Save repeatable prompts, run them with `/` in Agent Chat, or expose them in the editor and Command palette. [Create a Command](./docs/custom-commands.md).
- **Quick Ask:** Ask about a selection without leaving the note. Continue the conversation, replace text, insert the answer, or copy it. Choose its model under **快捷操作 → 工具配置** (**Quick actions → Tool configuration** in English). [Set up Quick Ask](./docs/custom-commands.md#quick-ask).
- **Multiple sessions:** Keep separate Agent Chat tabs open for different tasks.

## Use your own keys or local models

Add a cloud, local, or compatible provider under **Settings → Scribe → 快捷操作 → 模型与供应商** (**Settings → Scribe → Quick actions → Models and providers** in English). Scribe stores configured API keys in this device's Obsidian Keychain; older installations may also have credential backups that require careful handling. Agent Chat and Quick tools share the connection settings but can enable different models.

Your chosen route determines where prompts and included context are processed. Read [Models and providers](./docs/llm-providers.md) for setup and data-routing details.

## Frequently asked questions

<details>
<summary><strong>Can I use my existing model account?</strong></summary>

Agent Chat and Quick tools use an API key, compatible endpoint, or local model configured in Scribe. A provider account's access and charges depend on its own terms; an external agent login or subscription is not used.

</details>

<details>
<summary><strong>Does Agent work on mobile?</strong></summary>

Agent Chat is a desktop feature; its in-app agent and tools require desktop capabilities. Quick Ask, Quick Command, and saved commands remain available on mobile.

</details>

<details>
<summary><strong>How is my data handled?</strong></summary>

Your notes remain files in your vault. Prompts and included context go to your selected provider or local model. See [Privacy and data handling](#privacy-and-data-handling) below.

</details>

## Help and links

[Documentation](./docs/index.md) · [Report a bug](https://github.com/ItsDalk-Lane/Scribe/issues/new?template=bug_report.md) · [Request a feature](https://github.com/ItsDalk-Lane/Scribe/issues/new?template=feature_request.md) · [Upstream privacy policy](https://www.obsidiancopilot.com/en/privacy)

To report a bug with its evidence attached, use **Settings → Scribe → 通用 → 调试与支持 → 反馈问题**. It prepares a zip from your description and selected attachments for you to review. You can choose whether to upload it and review the issue draft before submitting.

## Privacy and data handling

Scribe is based on Copilot, a product of Brevilabs LLC, and is not affiliated with Obsidian. The plugin is open source.

- Messages and note context go to the model provider or local endpoint you configure. Provider billing and data-handling terms belong to that provider.
- Agents read documents and search files with their own tools. Agents and custom Skills can use network services according to their tools and permissions.
- **Diagnostic reports:** When you choose to upload, Scribe sends the zip to Brevilabs and may open a GitHub issue draft with the report ID. The draft can include your description, app details, and attachment names; opening the page shares the draft with GitHub. The zip is not attached automatically. Review the zip before uploading and the draft before submitting. Upstream documentation describes private storage and deletion after 60 days, but Scribe cannot verify privacy, retention, or maintainer access. Your local copy remains on your device.
- Brevilabs publishes an [upstream privacy policy](https://www.obsidiancopilot.com/en/privacy); its scope for Scribe as a whole has not been confirmed.

## Authors

ItsDalk-Lane · [GitHub](https://github.com/ItsDalk-Lane)
