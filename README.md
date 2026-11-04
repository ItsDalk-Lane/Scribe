<h1 align="center">Scribe for Obsidian</h1>

<p align="center"><strong>Agents for your Obsidian vault</strong></p>

<p align="center">Scribe brings an in-app agent to Obsidian for research, writing, and knowledge work.</p>

<p align="center"><a href="./docs/getting-started.md">Get started</a></p>

---

## Upstream project

Scribe is a fork of [Obsidian Copilot](https://github.com/logancyang/obsidian-copilot), based on upstream version **4.0.17**. This repository tracks upstream releases and selectively syncs the updates this project can use; **4.0.17** is the currently followed upstream version, and this record is updated whenever a sync lands. Scribe's own version numbering is independent of upstream and starts at 1.0.0.

## Work with Scribe

**Agent Chat** is Scribe's desktop workspace for multi-step work. The in-app agent can inspect notes, use tools, create Obsidian files, and continue across several turns with permissions you control.

Agent Chat and Quick tools use the providers, API keys, connection addresses, or local models you configure in Scribe. Agent Chat does not require an external agent installation or login. Provider terms and usage limits still apply.

[Learn how Agent Chat works →](./docs/agent-mode-and-tools.md)

## Set up Scribe

1. Install Scribe using the steps in the [Getting Started guide](./docs/getting-started.md).
2. Open **Settings → Scribe → 快捷操作 → 模型** and add a provider or local model.
3. Under **Agents → Scribe**, enable a model for Agent Chat.
4. Select the **Agent Chat** ribbon icon, or run **打开 Scribe 代理聊天窗口**.

## Built around your vault

- **Projects:** Give ongoing work its own instructions, reusable context, and chat history. [Learn about Projects](./docs/projects.md).
- **Skills:** Add reusable instructions for Scribe. Built-in skills cover Obsidian Markdown, Bases, Canvas, and the Obsidian CLI. [Learn about Skills](./docs/agent-mode-and-tools.md#skills).
- **Commands:** Save repeatable prompts, run them with `/` in Agent Chat, or expose them in the editor and Command palette. [Create a Command](./docs/custom-commands.md).
- **Quick Ask:** Ask about a selection without leaving the note. Continue the conversation, replace text, insert the answer, or copy it. Choose its model under **Quick actions → Tool configuration**. [Set up Quick Ask](./docs/custom-commands.md#quick-ask).
- **Multiple sessions:** Keep separate Agent Chat tabs open for different tasks.

## Use your own keys or local models

Add a cloud, local, or compatible provider under **Settings → Scribe → 快捷操作 → 模型**. Scribe stores configured API keys in this device's Obsidian Keychain; older installations may also have credential backups that require careful handling. Agent Chat and Quick tools share the connection settings but can enable different models.

Your chosen route determines where prompts and included context are processed. Read [Model Sources and BYOK](./docs/llm-providers.md) for setup and data-routing details.

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

[Documentation](./docs/index.md) · [Report a bug](https://github.com/ItsDalk-Lane/Scribe/issues/new?template=bug_report.md) · [Request a feature](https://github.com/ItsDalk-Lane/Scribe/issues/new?template=feature_request.md) · [Privacy](https://www.obsidiancopilot.com/en/privacy)

To report a bug with its evidence attached, use **Settings → Scribe → 通用 → 调试与支持 → 反馈问题**. It packs a screenshot and available logs into a zip you review before anything is sent, uploads it privately, and opens a prefilled issue carrying the report ID.

## Privacy and data handling

Scribe is based on Copilot, a product of Brevilabs LLC, and is not affiliated with Obsidian. The plugin is open source.

- Messages and note context go to the model provider or local endpoint you configure. Provider billing and data-handling terms belong to that provider.
- Agents read documents and search files with their own tools. Agents and custom Skills can use network services according to their tools and permissions.
- **Diagnostic reports:** The zip you review under **反馈问题** reaches Brevilabs only when you choose to upload it. It is stored privately, referenced by a report ID, and automatically deleted after 60 days. The public issue carries the ID, not the bundle. Your local copy is yours to keep or delete.
- See the [privacy policy](https://www.obsidiancopilot.com/en/privacy) for full terms.

## Authors

ItsDalk-Lane · [GitHub](https://github.com/ItsDalk-Lane)
