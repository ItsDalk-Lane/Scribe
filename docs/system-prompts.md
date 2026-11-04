# Instructions for Agent Chat

Instructions are rules Scribe should keep following, such as your writing style, folder conventions, preferred formats, and safety boundaries.

Agent Chat reads the vault-root `AGENTS.md` for your custom instructions when starting a response in a native Scribe session.

Agent Chat's built-in guidance covers vault context, Obsidian links and tool routing. The selected agent decides how much searching and planning the task needs, and can report unavailable tools or access honestly.

## Choose the right instruction tool

| Use                 | Best for                                                   |
| ------------------- | ---------------------------------------------------------- |
| Vault `AGENTS.md`   | Default rules for Agent Chat                               |
| Project `AGENTS.md` | More specific rules for one Project                        |
| **Skill**           | A reusable workflow with instructions and supporting files |
| **Scribe command**  | A short saved prompt or template you want to run again     |
| One-off prompt      | A request that matters only for the current turn           |

Keep stable conventions in `AGENTS.md`. Use a [Skill](agent-mode-and-tools.md#skills) when an agent needs a repeatable process. Use a [Scribe command](custom-commands.md) for a short reusable prompt.

## Vault instructions

Vault-wide instructions live in `AGENTS.md` at the root of your vault. Scribe makes them available to native Agent Chats in that vault.

Open [**Settings → Scribe → 通用 → 自定义说明**](settings.md#通用) and edit **库的自定义说明**. Scribe saves the text to the vault-root file as you type. Select **打开 AGENTS.md** to edit the same file as a normal note.

Good instructions are short and concrete:

```markdown
- Keep meeting notes under Meetings/.
- Use YYYY-MM-DD dates.
- Preserve existing frontmatter unless I ask you to change it.
- Ask before deleting a note.
```

Scribe reads the current file when it starts a response. Check the file's saved contents before sending the next request.

## Project instructions

Each [Project](projects.md) can add its own `AGENTS.md` inside the Project folder. Open the Project info menu and select **AGENTS.md**, or use **Edit project → Project instructions**.

A Project chat provides both files to the model:

1. The vault-root `AGENTS.md` contains general rules.
2. The Project `AGENTS.md` contains rules specific to that Project.

Avoid conflicting instructions: Scribe does not enforce a guaranteed winner when the files disagree.

Use Project instructions for details that should not affect the rest of the vault, such as a client's tone, deliverable format, source folders, or output location.

## Native instructions

Scribe 使用自己的 Obsidian 任务说明，并组合资料库说明、当前项目说明和你选择的上下文。原生代理不读取外部代理的专属说明目录，也不导入它们的设置。原有外部文件保留。

## Examples and next steps

Start with the [`AGENTS.md` examples](agents-md-examples.md), then keep only rules that reflect how you actually work. Long procedures are easier to maintain as [Skills](agent-mode-and-tools.md#skills).

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Projects](projects.md)
- [Scribe Commands and Quick Ask](custom-commands.md)
