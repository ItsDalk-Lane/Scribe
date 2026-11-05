# Troubleshooting Scribe

**Current safety notice:** Isolated tests found risks to existing files during startup migrations, credential changes, skill edits, cache cleanup, and note writes. Back up your files first, then disable Scribe until these issues are fixed; pending saves may finish during shutdown. Follow the troubleshooting steps below after the fixes.

**当前安全提示：** 隔离测试发现启动迁移、更改密钥、编辑技能、清除缓存和写入笔记时存在文件受损风险。请先备份现有文件，再暂时停用 Scribe，直到问题修复；关闭时程序可能完成之前排队的保存。以下排查步骤应在修复后执行。

After the fixes, check connections under **Settings → Scribe → 模型**, and choose the chat model and permission mode beside the chat input.

## Scribe is starting or did not start

### A Scribe tab or Scribe's settings say “Starting Scribe…”

Scribe finishes loading in the background after Obsidian opens your vault, so the vault never waits for it. Until it is ready, Scribe tabs that were open last time and **Settings → Scribe** show **正在启动 Scribe…**, and Scribe's commands and ribbon icon are not there yet. This usually lasts a moment. The first start after an update can take longer while Scribe updates your settings.

Keep the tab open. It turns back into your chat as soon as Scribe is ready, and the settings page fills in on its own.

### “Scribe failed to start”

Scribe ran into an error while loading and stayed off for this session. To see the error, open the developer console (**View → Toggle Developer Tools**, then the **Console** tab). Keep Scribe disabled until the file-safety issues above are fixed; do not re-enable or restart it to troubleshoot. After the fixes, if the notice returns, open an issue and include the error from the console.

## Agent Chat setup

### 没有可用模型或无法开始聊天

先在 **模型** 页配置供应商及模型，配置完成后即可在聊天中选择使用。检查密钥、地址、服务可达性及供应商额度。原生代理无需安装或登录外部程序。

隔离测试发现，设置引用的密钥在本机缺失时，模型仍可能显示可用但启动失败。请在文件安全问题修复后检查供应商密钥；测试未使用真实桌面或设备密钥。

Isolated tests found that a model may appear available but fail to start when its saved key reference has no key on this device. After the file-safety issues are fixed, check the provider key. The tests did not use a real desktop or device credentials.

如果 Agent Chat 的模型选择器显示 **Not offered by agent**，说明当前代理没有报告该模型；请选择它当前提供的模型。

参见 [Getting Started](getting-started.md) 和 [Models](models-and-parameters.md)。

## Models and API keys

### No model is configured for Quick tools

Add a provider and model under **Settings → Scribe → 模型**. Quick tools use the first configured model by default.

- **Add API key:** edit that provider under **模型**.
  Agent Chat 和快捷工具共用模型连接。 See [Models](models-and-parameters.md) and [Models and providers](llm-providers.md).

### Keys disappeared, or “API Key Storage” says “Unavailable”

Scribe stores configured secrets in the Obsidian Keychain. A backup made from older settings can retain unencrypted keys in the vault's plugin folder and may be copied by vault sync. An isolated test also found that an existing backup with the expected name is accepted without checking that its contents match the settings. Keep the original files and any backups private; do not assume a backup contains the current settings.

Scribe 将已配置的密钥保存在 Obsidian 钥匙串中。旧设置生成的备份可能在资料库的插件文件夹内保留明文密钥，也可能随资料库同步。隔离测试还发现，程序会直接接受已有同名备份，而不检查其内容是否与设置一致。请妥善保管原文件和备份，不要假设备份一定包含当前设置。

If a provider echoes a key, isolated tests show that some connection or chat errors can expose it, and an unusual chat response can save it in a session record. Check chat records, screenshots, and diagnostic reports for secrets before sharing them. The tests used simulated responses, not a real provider account.

隔离测试发现，如果供应商在回复中回显密钥，某些连接或聊天错误可能暴露密钥，异常聊天回复也可能将密钥写入会话记录。分享聊天记录、截图或诊断报告前，请检查其中是否包含密钥。测试使用模拟回复，没有使用真实供应商账户。

Isolated tests of credential management found that removing a provider, or changing or clearing its key, can affect a shared key used by another provider. Changing or clearing a key can also affect a key belonging to another plugin. When two vaults on one device share a Scribe key-storage identifier, deleting all keys in one can also remove the other's keys. Back up your files first and disable Scribe until these issues are fixed; pending saves may finish while it shuts down. Do not remove providers or change or clear keys to troubleshoot. The tests used a simulated host, not the actual interface or a real device's credentials.

隔离测试发现，移除供应商、更改或清空其密钥可能影响其他供应商使用的共用密钥；更改或清空密钥还可能影响其他插件的密钥。如果同一设备上的两个资料库共用 Scribe 密钥存储标识，在一个库中删除全部密钥也可能移除另一个库的密钥。请先备份现有文件，再暂时停用 Scribe，直到这些问题修复；关闭时程序可能完成之前排队的保存。不要通过移除供应商、更改或清空密钥排查问题。测试使用的是替身宿主，没有操作真实界面或设备密钥。

After the fixes:

- **Unavailable:** check your Obsidian version or use a device where the Keychain is available.
- If a provider reports **未设置密钥**, check that provider under **模型与供应商** and enter its key if needed. Keychains are per device and do not follow a synced vault; the storage description does not check their contents.
- To remove this vault's Scribe API keys, use **关于 → API 密钥存储 → 删除所有密钥**. Existing credential backups may remain; review them separately.

Do not delete `data.json`: it contains the vault's Keychain namespace. Resetting settings does not delete Keychain entries or repair missing device credentials. Check the key-storage guidance above before changing credentials.

不要删除 `data.json`，其中保存着资料库的密钥存储标识。重置设置不会删除密钥条目，也不能补回本机缺失的密钥。更改密钥前，请先查看上方密钥存储说明。

## Agent Chat is waiting or behaving unexpectedly

### Nothing happens after you send

Look for **需要授权** or **代理提问**. Review the inputs or diff, then choose an offered option. Another session tab may show an attention indicator.

权限卡只处理对应操作。**Stop** 取消当前回复和其尚未回答的请求；后台任务从任务列表分别停止。

### A skill or skill command is missing

隔离测试发现，启用同名技能可能删除已有目录。请先备份现有文件，再暂时停用 Scribe，直到问题修复；关闭时程序可能完成之前排队的保存。不要通过启用同名技能尝试排查。

Isolated tests found that enabling a same-named skill can delete an existing folder. Back up your existing files first, then disable Scribe until these issues are fixed; pending saves may finish during shutdown. Do not troubleshoot by enabling a same-named skill.

Scribe 不附带、自动安装或更新技能。已有技能文件会保留并作为普通技能管理。修复后，可在 **Settings → Scribe → 技能** 确认你的个人或项目技能可读取并已为 Scribe 启用。仅手动调用的技能需要从 `/` 菜单选择；当前版本可能无法自动发现项目目录中的技能。命令还需要处于启用状态，允许显示于 `/` 菜单的条目才会出现在下拉列表。

参见 [Skills](agent-mode-and-tools.md#skills)。

## Quick Ask does not open or has no model

- **Quick Ask is not available in source mode:** switch the note to Live Preview and try again.
- **No active editor found:** open a Markdown note in an editor pane.
- **No active model configured:** add a model under **模型**; Quick tools use the first configured model by default.
- **Error generating response. Please try again:** retry once; if it continues, collect a log as described below.

See [Scribe Commands and Quick Ask](custom-commands.md#quick-ask) for selection and note-context behavior.

## Agent note writes

Isolated tests found file-write safety issues. Until they are fixed, do not ask the agent to write or edit notes, including through **Auto** or saved permissions. Before editing manually, check whether the note shares a file with an outside entry; if unsure, first save its contents as a new note. See [Models, effort, and permissions](agent-mode-and-tools.md#models-effort-and-permissions) for the affected behavior.

隔离测试发现了笔记写入安全问题。修复前，请暂时不要让代理写入或编辑笔记，包括使用 **Auto** 或已记住的授权；手动编辑前请确认文件未与库外文件共用，不确定时先另存为新笔记。受影响的行为见 [模型与权限说明](agent-mode-and-tools.md#models-effort-and-permissions)。

## Cache cleanup

For now, do not run **Clear Scribe cache** (**清除 Scribe 缓存**). It can delete user files directly inside the vault's `.scribe/file-content-cache`, everything under `.scribe/pdf-cache`, and, on desktop, everything under the per-vault `.obsidian-scribe/vaults/<vault-id>/context-cache` in your home folder. It may also report success when clearing fails. A backup can help recover files, but it does not fix this issue.

目前请不要在命令面板中运行 **清除 Scribe 缓存**（**Clear Scribe cache**）。该命令可能删除直接位于资料库 `.scribe/file-content-cache` 内的用户文件、`.scribe/pdf-cache` 下的所有内容，以及桌面端用户主目录中 `.obsidian-scribe/vaults/<vault-id>/context-cache` 下的所有内容；清理失败时也可能误报成功。备份有助于恢复文件，但不能修复此问题。

## Logs

### Collecting logs by hand

Run **打开 Scribe 日志文件** from the command palette to save the Scribe log into your vault as a note and open it. The Agent Chat log can be opened or cleared under **关于 → 调试与支持 → 代理活动日志**；该日志只保存较早版本 Scribe 记录的活动，当前原生聊天不写入其中。

Logs and screenshots can contain prompts, note contents, paths, and tool inputs. Review them before attaching anything to a public issue.

## What works on mobile?

Agent Chat, Projects, and Skill execution are desktop-only. On mobile, use Quick Ask, Quick Command, and saved editor commands. Desktop-only settings display their availability message on mobile.

## Related

- [Getting Started](getting-started.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [Scribe Settings](settings.md)
