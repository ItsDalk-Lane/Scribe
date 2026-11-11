# `AGENTS.md` Examples for Agent Chat

`AGENTS.md` holds instructions that Agent Chat should keep following. Write shared vault rules once at the vault root. Scribe makes them available to its native agent. A Project can add a second `AGENTS.md` in its folder. Both sets reach the model. For adjustable preferences, the current request takes priority, followed by Project instructions, vault instructions, and Scribe defaults; tool permissions are checked separately.

Isolated tests found that opening or restoring a Project can change existing instructions, and saving another Project detail can overwrite a newer instruction body. Back up your files first, then disable Scribe until these issues are fixed; pending saves may finish during shutdown. These examples are for use after the fixes. See [Projects](projects.md).

隔离测试发现，打开或恢复项目可能改写已有说明；保存其他项目详情时也可能覆盖较新的说明。请先备份现有文件，再暂时停用 Scribe，直到问题修复；关闭时程序可能完成之前排队的保存。以下示例应在修复后使用，详见[项目](projects.md)。

Start small. A useful file describes how _your_ vault works, not everything an AI might ever need to know.

## Starter `AGENTS.md` for an Obsidian vault

Copy this to the root of your vault, then change it to match your habits:

```markdown
# Vault instructions

## Working style

- Lead with the result, then explain only what helps me act on it.
- If a request is ambiguous in a way that changes the outcome, ask before proceeding.
- Use available skills for repeatable workflows instead of improvising the process.

## Notes

- Treat this vault as a knowledge base, not a software repository.
- Read a note before making claims about its contents.
- Preserve existing frontmatter, wikilinks, embeds, and formatting unless I ask for changes.
- Use `[[Note Title]]` for links between notes.
- Make the smallest change that completes the request.

## Safety and completion

- Ask before deleting notes, moving many files, or publishing anything outside the vault.
- Never place passwords, API keys, or private note content in external services without permission.
- When finished, name the notes you changed and mention anything you could not verify.
```

Save `AGENTS.md` to make changes take effect at the next model step, including after a tool finishes. A request already in progress keeps its original rules.

## Patterns worth adding

Add only patterns that describe real, recurring preferences:

- **Organization:** where meeting notes, sources, drafts, and finished work belong.
- **Naming:** date formats, title conventions, tags, and required properties.
- **Evidence:** when the agent must read source notes, search the vault, or verify current facts.
- **Boundaries:** which edits are routine and which actions require confirmation.
- **Definition of done:** checks to run and what the final handoff should report.
- **Routing:** which repeatable jobs belong to a [Skill](agent-mode-and-tools.md#skills).

For a project, keep its additional instructions short. For example:

```markdown
# Project instructions

- Write deliverables to `outputs/`.
- Use a concise, client-ready tone.
- Cite the project sources used for factual claims.
- Do not modify source notes unless I ask.
```

## External examples worth studying

- [Andrej Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): borrow its separation of raw sources, maintained knowledge, and update rules.
- [GBrain `AGENTS.md`](https://raw.githubusercontent.com/garrytan/gbrain/master/AGENTS.md): study its read order, privacy boundary, and explicit user decisions.
- [gstack `AGENTS.md`](https://raw.githubusercontent.com/garrytan/gstack/main/AGENTS.md): notice how the file routes substantial workflows into Skills instead of containing every procedure.
- [`claude-obsidian` `AGENTS.md`](https://github.com/AgriciDaniel/claude-obsidian/blob/main/AGENTS.md): a concrete example of conventions for an AI-maintained Obsidian knowledge base.
- [Daniel Mulroy's Pi workspace](https://raw.githubusercontent.com/dmmulroy/.dotfiles/main/home/.pi/AGENTS.md): borrow its compact map of where to look, what to avoid, and how to handle sensitive information.

## What not to copy blindly

- Another person's folder paths, tool names, account identity, or publishing workflow.
- Broad permission or deletion rules you would not want applied to your own vault.
- Long step-by-step procedures that should be a skill.
- Coding, test, and release rules when the scope is ordinary note work.
- Secrets or private information. Agents can read `AGENTS.md`; treat it as normal vault content.

Review the file occasionally. Keep rules that prevent a recurring mistake or express a real preference, and remove generic advice that does not change the agent's behavior.

## Related

- [Instructions for Agent Chat](system-prompts.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Projects](projects.md)
