<h1 align="center">Scribe for Obsidian</h1>

<p align="center"><strong>Agents for your Obsidian vault</strong></p>

<p align="center">Scribe V4 brings Claude Code into Obsidian for research, writing, and knowledge work.</p>

<p align="center"><a href="./docs/getting-started.md">Get started</a></p>

---

## Work with Claude

**Agent** is the main Scribe experience for multi-step work. It can inspect notes, use tools, create Obsidian files, and continue across several turns with permissions you control.

- **Claude Code:** Connect an existing installation. Scribe detects common install locations and uses your Claude Code login.

Use your existing Claude Code account for Agent Chat. Quick tools use your own model API key or local model. Provider terms and usage limits still apply.

[Learn how Agent works →](./docs/agent-mode-and-tools.md)

## Set up Scribe

1. Install Scribe using the steps in the [Getting Started guide](./docs/getting-started.md).
2. Open **Settings → Scribe → Basic → Agents**.
3. Connect Claude Code with **Auto-detect**.
4. Select the **Agent** ribbon icon, or run **Open Scribe Agent Chat window**.

The [Getting Started guide](./docs/getting-started.md) covers Claude Code setup.

## Built around your vault

- **Projects:** Give ongoing work its own instructions, reusable context, and chat history. A project works with Claude. [Learn about Projects](./docs/projects.md).
- **Skills for Claude:** Add a skill once, then enable it for Claude. Scribe also includes skills for Obsidian Markdown, Bases, Canvas, and the Obsidian CLI. [Learn about Skills](./docs/agent-mode-and-tools.md#skills-with-claude).
- **Commands:** Save repeatable prompts, run them with `/` in Agent, or expose them in the editor and Command palette. [Create a Command](./docs/custom-commands.md).
- **Quick Ask:** Ask about a selection without leaving the note. Continue the conversation, replace text, insert the answer, or copy it. Choose its BYOK model under **Basic → Agents → Quick tools**. [Set up Quick Ask](./docs/custom-commands.md#quick-ask).
- **Multiple sessions:** Keep separate Agent tabs open for different tasks.

## Use your own accounts, keys, or local models

- **Bring your own key:** Add a cloud, local, or OpenAI-compatible provider under **Settings → Scribe → BYOK**. Keys are stored in this device's Obsidian Keychain, not in the vault's `data.json`.
- **Claude Code account:** Agent Chat uses your Claude Code login rather than a key from Scribe's BYOK settings.

Your chosen route determines where prompts and included context are processed. Read [LLM Providers](./docs/llm-providers.md) for setup and data-routing details.

## Feedback on the original Copilot project

> "The first tool that truly unifies how I search, organize, and retrieve knowledge without ever leaving Obsidian. My workflow is faster, deeper, and more connected. I can't imagine working without it."
>
> **Jason Zhang**, Investor & Research Analyst

<details>
<summary><strong>More from the community</strong></summary>

> "I drop meeting transcriptions, personal notes, and architecture ideas into my vault. Copilot gives me a personal assistant that finds missing puzzle pieces and surfaces relevant info during live calls, no manual searches."
>
> **Brad Decker**, CTO, Concierge Auctions

> "Since discovering Copilot, my writing process has been completely transformed. Conversing with my own articles and thoughts is the most refreshing experience I've had in decades."
>
> **Mat QV**, Professional Writer

</details>

## Frequently asked questions

<details>
<summary><strong>Can I use my existing model account?</strong></summary>

Yes. Connect Claude Code with its existing account, or use quick tools with your own API key or local model. Your provider may charge for its own usage.

</details>

<details>
<summary><strong>Does Agent work on mobile?</strong></summary>

Agent is a desktop feature because its backends run local processes. Quick Ask, Quick Command, and saved commands remain available on mobile.

</details>

<details>
<summary><strong>How is my data handled?</strong></summary>

Your notes remain files in your vault. Prompts and included context go to your selected provider, agent, or local model. See [Privacy and data handling](#privacy-and-data-handling) below.

</details>

## Help and links

[Documentation](./docs/index.md) · [YouTube](https://www.youtube.com/@loganhallucinates) · [Report a bug](https://github.com/logancyang/obsidian-copilot/issues/new?template=bug_report.md) · [Request a feature](https://github.com/logancyang/obsidian-copilot/issues/new?template=feature_request.md) · [Privacy](https://www.obsidiancopilot.com/en/privacy)

To report a bug with its evidence attached, use **Settings → Scribe → Advanced → Debugging & support → Report an issue**. It packs a screenshot and recent logs into a zip you review before anything is sent, uploads it privately, and opens a prefilled issue carrying the report ID.

## Support the project

If Scribe is useful to you, consider [sponsoring the project on GitHub](https://github.com/sponsors/logancyang) or buying us a coffee.

<p align="center">
  <a href="https://www.buymeacoffee.com/logancyang"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" width="165"></a>
</p>

### Thank you to our GitHub Sponsors

Special thanks to our top sponsors: @mikelaaron, @pedramamini, @Arlorean, @dashinja, @azagore, @MTGMAD, @gpythomas, @emaynard, @scmarinelli, @borthwick, @adamhill, @gluecode, @rusi, @timgrote, @JiaruiYu-Consilium, @ddocta, @AMOz1, @chchwy, @pborenstein, @GitTom, @kazukgw, @mjluser1, @joesfer, @rwaal, @turnoutnow-harpreet, @dreznicek, @xrise-informatik, @jeremygentles, @ZhengRui, @bfoujols, @jsmith0475, @pagiaddlemon, @sebbyyyywebbyyy, @royschwartz2, @vikram11, @amiable-dev, @khalidhalim, @DrJsPBs, @chishaku, @Andrea18500, @shayonpal, @rhm2k, @snorcup, @JohnBub, @obstinatelark, @jonashaefele, @vishnu2kmohan

## Privacy and data handling

Scribe is based on Copilot, a product of Brevilabs LLC, and is not affiliated with Obsidian. The plugin is open source.

- Messages and note context go to the model provider, local endpoint, or agent account you configure. Provider billing and data-handling terms belong to that provider.
- Agents read documents and search files with their own tools. Agents and custom Skills can use network services according to their tools and permissions.
- **Diagnostic reports:** The zip you review under **Report an issue** reaches Brevilabs only when you choose to upload it. It is stored privately, referenced by a report ID, and automatically deleted after 60 days. The public issue carries the ID, not the bundle. Your local copy is yours to keep or delete.
- See the [privacy policy](https://www.obsidiancopilot.com/en/privacy) for full terms.

## Authors

Brevilabs Team · [logan@brevilabs.com](mailto:logan@brevilabs.com) · [@logancyang](https://twitter.com/logancyang)
