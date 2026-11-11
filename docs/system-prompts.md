# Instructions for Agent Chat

Instructions are rules Scribe should keep following, such as your writing style, folder conventions, preferred formats, and safety boundaries.

Agent Chat reads the vault-root `AGENTS.md` for your custom instructions before every model step in a native Scribe session, including steps after a tool finishes.

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

Open [**Settings → Scribe → Agent 配置**](settings.md#agent-配置) and edit **库的自定义说明**. Scribe saves the text to the vault-root file as you type. Select **打开 AGENTS.md** to edit the same file as a normal note.

Good instructions are short and concrete:

```markdown
- Keep meeting notes under Meetings/.
- Use YYYY-MM-DD dates.
- Preserve existing frontmatter unless I ask you to change it.
- Ask before deleting a note.
```

Saved changes take effect at the next model step. A request already in progress keeps the version it started with. If a rule file cannot be read, that step stops with an error instead of treating the failure as deletion. Clearing a file or deleting it removes that source from the next request.

## Project instructions

Each [Project](projects.md) can add its own `AGENTS.md` inside the Project folder. Open the Project info menu and select **AGENTS.md**, or use **Edit project → Project instructions**.

A Project chat provides both files to the model:

1. The vault-root `AGENTS.md` contains general rules.
2. The Project `AGENTS.md` contains rules specific to that Project.

For adjustable preferences, your explicit request for the current task takes priority, followed by Project preferences, vault preferences, and Scribe defaults. These preferences do not grant permission to use tools or bypass approval.

Use Project instructions for details that should not affect the rest of the vault, such as a client's tone, deliverable format, source folders, or output location.

## Native instructions

Scribe 使用自己的 Obsidian 任务说明，并组合资料库说明、当前项目说明和你选择的上下文。原生代理不读取外部代理的专属说明目录，也不导入它们的设置。原有外部文件保留。

The old `.scribe/system-prompts` directory and its saved selection are retired. Scribe no longer creates or reads that directory, and does not import or delete its old files. Manage vault and Project instructions through their `AGENTS.md` files.

旧版 `.scribe/system-prompts` 目录及其选择项已停用。插件不再创建或读取该目录，也不导入或删除其中旧文件。库说明和项目说明分别通过各自的 `AGENTS.md` 管理。

## Examples and next steps

Start with the [`AGENTS.md` examples](agents-md-examples.md), then keep only rules that reflect how you actually work. Long procedures are easier to maintain as [Skills](agent-mode-and-tools.md#skills).

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Projects](projects.md)
- [Scribe Commands and Quick Ask](custom-commands.md)

## Current project sources and request records

更换或清空项目资料范围后，下一次模型生成会收到当前完整声明，并明确替代旧声明。你明确选择的来源和排除条件始终列出；自动展开的匹配结果最多列出 100 条，多出的数量会说明。资料正文仍按需重新读取，不会自动把整个项目加入每次请求。

压缩、重新打开聊天或任务中途插入消息时，都重新建立当前规则和资料范围。你已经发送的选区、附件和文字保持原样。

在聊天的更多菜单中选择“查看上次请求”，可以查看上一次保存的模型输入，包括当时的说明、资料声明、技能内容和工具定义。旧聊天没有这类记录时会明确提示。这里展示的是送入模型适配层的内容，供应商最终格式可能有所调整；查看不会再次发出模型请求或执行工具。

## 减少重复准备与使用模型缓存

资料库说明和项目说明仍在每次模型生成前读取，两份文件同时准备。项目资料清单在一次准备中共用文件列表；同名笔记都保留，新增、移动和删除的资料仍在下次准备时重新核对。

外部工具目录没有变化时复用上次生成的文字；工具连接、工具开关或目录加载设置改变后，下次请求立即更新。连续修改只按请求开始时的最终状态生成目录，不需要等待固定时间，也不新增缓存文件。

当前模式和资料声明固定放在请求开头，后续提问可以保留前面未变化的内容。规则、工具或资料范围变化后，后续请求还会在末尾收到当前状态提醒，要求重新核对旧计划并撤销已清空来源的要求；重新打开已有聊天时也会重建这条提醒。提醒不改写你的原始消息。发生变更或恢复历史后，提醒会随聊天继续保留，可能增加输入用量；正确使用当前规则优先于缓存复用。规则、资料或技能内容改变时，以正确的新内容为准。Scribe 不会为保持缓存而继续使用旧规则，也不会向未确认支持的服务发送中途规则或工具增量。

官方 Anthropic 和 Vertex 的 Anthropic 通道现在默认使用短期提示缓存；明确关闭提示缓存时不添加缓存标记。自填的 Anthropic 兼容网关默认保持原格式，只有明确开启提示缓存时才添加标记。OpenRouter 沿用原有缓存方式，其他兼容通道不额外添加这类字段。是否命中缓存由模型服务决定，短请求、内容变化或服务限制都可能无法命中。

可在聊天统计中查看服务实际返回的输入用量、缓存读取比例和首次输出等待时间。未返回的数据仍显示为未知或部分统计，不根据本地复用次数推算费用或网络提速。
