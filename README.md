<h1 align="center">Scribe for Obsidian</h1>

<p align="center"><strong>Agents for your Obsidian vault</strong></p>

<p align="center">Scribe brings an in-app agent to Obsidian for research, writing, and knowledge work.</p>

<p align="center"><a href="./docs/getting-started.md">Get started</a></p>

---

## Current safety notice

Isolated tests found that removing a provider or changing its key can also affect a key shared with another provider; changing or clearing a key can affect another plugin's key. When two vaults on one device share a Scribe key-storage identifier, deleting all keys in one can also remove the other's keys. Backups made from older settings can contain unencrypted keys inside the vault and may be copied by sync. Keep a backup of your existing files first, then turn Scribe off under **Obsidian Settings → Community plugins** until these issues are fixed; Scribe may finish pending saves while shutting down. Do not remove providers or change or clear keys to troubleshoot before the fixes. The cache cleanup command and agent note writes also have unresolved data-safety issues. See [Troubleshooting](./docs/troubleshooting-and-faq.md).

## Upstream project

Scribe is a fork of [Obsidian Copilot](https://github.com/logancyang/obsidian-copilot), based on upstream version **4.0.17**. This repository tracks upstream releases and selectively syncs the updates this project can use; **4.0.17** is the currently followed upstream version, and this record is updated whenever a sync lands. Scribe's own version numbering is independent of upstream and starts at 1.0.0.

The provider preset catalog under `src/modelManagement/catalog/presets/` is ported from [cc-switch](https://github.com/farion1231/cc-switch) (MIT License, Copyright (c) 2025 Jason Young), version **4.0.28**, commit `cdca0984231021c4eb7e8978af8670cd29c6e415`. The preset data and the inline provider logo SVGs are distributed under cc-switch's MIT license; each provider logo remains the trademark of its respective owner.

## Work with Scribe

**Agent Chat** is Scribe's desktop workspace for multi-step work. The in-app agent can inspect notes, use tools, create Obsidian files, and continue across several turns with permissions you control.

Agent Chat and Quick tools use the providers, API keys, connection addresses, or local models you configure in Scribe. Agent Chat does not require an external agent installation or login. Provider terms and usage limits still apply.

[Learn how Agent Chat works →](./docs/agent-mode-and-tools.md)

## Set up Scribe

1. Install Scribe using the steps in the [Getting Started guide](./docs/getting-started.md).
2. Open **Settings → Scribe → Models** and add a provider or local model.
3. Configured models are available directly. Select the **Agent Chat** ribbon icon, or run **Open Scribe Agent Chat window**.

## Built around your vault

- **Projects:** Give ongoing work its own instructions, reusable context, and chat history. [Learn about Projects](./docs/projects.md).
- **Skills:** Start with seven bundled skills, create reviewed drafts with the Agent, or import skills from supported desktop tools, folders, and ZIP files. Built-in skills are read-only, can be switched off or uninstalled, and can be restored. Existing skill files stay available as local skills. [Learn about Skills](./docs/agent-mode-and-tools.md#skills).
- **Commands:** Save repeatable prompts, run them with `/` in Agent Chat, or expose them in the editor and Command palette. [Create a Command](./docs/custom-commands.md).
- **Quick Ask:** Ask about a selection without leaving the note. Continue the conversation, replace text, insert the answer, or copy it. Quick tools use the first configured model by default. [Set up Quick Ask](./docs/custom-commands.md#quick-ask).
- **Multiple sessions:** Keep separate Agent Chat tabs open for different tasks.

## Use your own keys or local models

Add a cloud, local, or compatible provider under **Settings → Scribe → Models**. Scribe encrypts service keys inside the current vault’s `.scribe` folder using a master password that is never saved. The old system keychain is not imported or changed; enter service keys again when adopting the new storage. Agent Chat and Quick tools share these configured models. Choose a chat model and permission mode in the chat; new chats remember the last manual choices.

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

You can collect the Scribe log with **Open Scribe log file** in the command palette. Review any logs or screenshots before sharing them in a GitHub issue.

## Privacy and data handling

Scribe is based on Copilot, a product of Brevilabs LLC, and is not affiliated with Obsidian. The plugin is open source.

- Messages and note context go to the model provider or local endpoint you configure. Provider billing and data-handling terms belong to that provider.
- Agents read documents and search files with their own tools. Agents and custom Skills can use network services according to their tools and permissions.
- Brevilabs publishes an [upstream privacy policy](https://www.obsidiancopilot.com/en/privacy); its scope for Scribe as a whole has not been confirmed.

## Authors

ItsDalk-Lane · [GitHub](https://github.com/ItsDalk-Lane)
