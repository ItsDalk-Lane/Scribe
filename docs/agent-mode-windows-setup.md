# Windows setup for Agent Chat

Agent Chat uses **Claude Code** in the Obsidian desktop app.

## Connect Claude Code

The Claude backend uses the Claude Code installation and account already on your computer.

1. Open **Settings → Scribe → 代理 → Claude Code** and select **Configure**.
2. If Claude Code is installed, select **Auto-detect** under **Claude Code installation**.
3. If it is not installed, copy the current **Install it** command from the dialog and run it in PowerShell.
4. Return to **Configure Claude** and select **Auto-detect** again. If detection still fails, enter the absolute path to `claude.exe` and select **Apply**.
5. If the dialog shows **Sign in**, select it and complete the browser login.

You can also start the Claude Code login from PowerShell:

```powershell
claude auth login --claudeai
```

Scribe uses Claude Code's credentials. Do not add an Anthropic API key to this dialog. If Scribe reports that the installed version is unsupported, update Claude Code and detect it again.

## Use Skills with Claude

Open [**Settings → Scribe → Skills**](settings.md#skills) and toggle the Claude icon for each Skill. Scribe keeps one shared copy and creates folder links into `.claude/skills/`.

Windows may block creation of these links. Enable **Windows Settings → Privacy & security → For developers → Developer Mode**, or run Obsidian with administrator access, then toggle the affected agent off and on in the **Skills** tab.

If a sync service replaces a folder link and a Skill disappears from an agent, toggle that agent off and on again to recreate the link.

## Open Agent Chat

Select the **Agent Chat** ribbon icon or run **Open Scribe Agent Chat window** from the command palette. Claude opens automatically when it is ready. Use **Configure** if setup is required.

For models, effort, permissions, and Projects, see [Agent Chat](agent-mode-and-tools.md).
