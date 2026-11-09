# Troubleshooting Scribe

**Current safety notice:** Isolated tests found risks to existing files during ordinary note writes. Back up your files first and avoid affected operations until these issues are fixed. The new storage does not run old-data migrations or cleanup.

**当前安全提示：** 隔离测试发现写入普通笔记时仍存在文件受损风险。请先备份现有文件，暂时避免受影响的操作。新存储不执行旧资料导入或清理。

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

密钥文件缺失或无法读取时，请在供应商设置中重新填写。已保存但尚未解锁的模型仍可选择，首次发送时会请求主密码。

If a credential file is missing or unreadable, enter that provider's key again. Locked saved keys remain selectable and ask for the master password when you send.

如果 Agent Chat 的模型选择器显示 **Not offered by agent**，说明当前代理没有报告该模型；请选择它当前提供的模型。

参见 [Getting Started](getting-started.md) 和 [Models](models-and-parameters.md)。

## Models and API keys

### No model is configured for Quick tools

Add a provider and model under **Settings → Scribe → 模型**. Quick tools use the first configured model by default.

- **Add API key:** edit that provider under **模型**.
  Agent Chat 和快捷工具共用模型连接。 See [Models](models-and-parameters.md) and [Models and providers](llm-providers.md).

### Saved keys are locked or missing

Scribe now encrypts service credentials inside the vault-root `.scribe/secrets` folder. The old Obsidian Keychain is not read or changed. Re-enter your service keys in **模型** when adopting the new storage system.

插件将密钥加密保存在当前库的 `.scribe/secrets`，不读取或修改旧钥匙串。采用新存储后，请在 **模型** 中重新填写各服务商密钥。

- **Locked:** start a chat or connection test and enter the master password. Background checks do not open the unlock dialog.
- **Missing:** enter a key for that service. An empty edit field does not mean a saved key is missing; look for **已保存密钥**.
- **Wrong password or damaged file:** no request is sent and the original files stay unchanged. Retry the password or restore a trusted backup.
- **Forgotten master password:** there is no password recovery. The unlock dialog offers a confirmed reset of the new saved keys only; then set a new password and enter service keys again.

主密码不会写入磁盘。备份或同步时，请同时保留 `.scribe` 和插件配置文件；恢复后仍需原主密码。旧文件与旧备份不会自动清理，请自行妥善保管。

Scribe masks this request’s known original keys and authorization tokens in replies and errors before saving them. Unknown transformations, encoded variants, and secrets you enter in notes or questions may remain. Review records, screenshots, and diagnostic reports before sharing them.

Scribe 会在保存回复和错误前遮盖本次请求已知的密钥和访问令牌原值；未知变形、编码形式，以及你自己写进笔记或问题中的秘密仍可能保留。分享记录、截图和诊断资料前请检查。

## Agent Chat is waiting or behaving unexpectedly

### Nothing happens after you send

Look for **需要授权** or **代理提问**. Review the inputs or diff, then choose an offered option. Another session tab may show an attention indicator.

权限卡只处理对应操作。**Stop** 取消当前回复和其尚未回答的请求；后台任务从任务列表分别停止。

### A skill or skill command is missing

Scribe 首次安装会附带七项内置技能；明确卸载后不会自动恢复，可在“恢复内置技能”中找回。个人技能通过 Agent 创建、系统搜索或本地导入添加。当前只读取库根 `.scribe/skills` 中的技能，不扫描项目工作目录、不创建技能链接，也不自动导入或修改旧位置资料。在 **Settings → Scribe → 技能** 刷新并确认技能可读取、已经启用；允许手动调用的技能才出现在聊天 `/` 菜单。格式损坏的个人技能可从详情页让 Agent 修复，内置技能可恢复内置版本。

Scribe reads skills directly from the vault-root `.scribe/skills` folder. It does not scan project work folders, create skill links, or import or change old skill locations. Settings and the chat menu use the same skill inventory.

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

Scribe stores new caches inside `.scribe`. It does not scan or clean old cache locations in the home folder or system temporary folder. Existing files remain untouched.

新缓存统一保存在 `.scribe`；插件不会扫描或清理旧用户目录和系统临时目录中的缓存，也不会删除旧资料。

## Chat history and recovery

### Older chats are missing after this update

The new chat format starts with newly created chats. Chats created before this change are not read, listed, or converted, including earlier chats inside `.scribe`. Their files remain unchanged. New chats and shared pictures still live inside the vault-root `.scribe` folder.

这次改造从新建聊天开始。改造前的聊天不再读取、显示或转换，包括原先在 `.scribe` 内的聊天；旧文件原样保留，没有被自动删除。新聊天和共享图片仍然保存在库根 `.scribe` 内。

### Only recent turns or a process summary are visible

Long chats initially show the latest 30 turns. Choose **Load 30 earlier turns** to view older content. Completed tool and thinking activity is collapsed by default; expand its summary to see the details. Compaction keeps the original conversation and only uses a summary when preparing a model request.

长聊天先显示最近 30 轮，点击 **再加载前 30 轮** 查看更早内容。已完成的工具和思考过程默认收起，点击摘要可展开。压缩也不会删除原文，只在准备模型请求时使用摘要。

### An operation shows a system recovery notice

**Never started** means no execution admission was recorded. **Outcome unknown** means execution was admitted but its result was not saved; files may already have changed. Inspect the named files and tasks before retrying. Restoring history does not automatically repeat these operations or resend accepted queued messages.

“系统恢复说明”中的“未启动”表示没有执行记录；“结果未知”表示操作已获准，但未保存结果，文件可能已经改变。请先核查相关文件和任务，再决定是否重试。恢复历史不会自动重做操作，也不会自动重发已接收的排队消息。

### Saving failed or part of a chat is damaged

Scribe waits for disk confirmation when accepting a message, before admitting an operation, and after receiving a tool result. If saving fails, new requests and operations that have not started stop. A sudden power loss can still lose content after the last successful disk confirmation.

接收消息、操作获准即将执行及收到工具结果时，Scribe 会等待硬盘确认；保存失败会停止新请求和尚未开始的操作。突然断电仍可能丢失最近一次确认之后尚未确认保存的内容。

If the disk stops responding, text already received remains visible. Save waits have a deadline, and Stop reports a save that could not be confirmed instead of waiting forever. Visible text may still be unsaved. Wait for the disk to recover before retrying; Scribe does not start another write over one that is still unfinished.

如果硬盘一直没有响应，已经收到的回答仍可显示；保存等待有时限，“停止”也会结束等待并报告未能确认保存，不会一直转圈。看见文字不代表已经保存，请先等硬盘恢复再重试。原来的写入尚未结束时，Scribe 不会另开写入去覆盖它。

Readable parts of a damaged chat remain available where possible. If safe continuation cannot be established, keep the original files and backups and start a new chat. Missing pictures show a notice; deleting one chat does not automatically remove shared pictures used by other chats.

聊天部分损坏时，会尽量保留可读内容；无法安全继续时，请保留原件和备份，另开聊天。图片缺失会显示提示；删除单条聊天不会自动清理共享图片，以免影响其他聊天。

## Logs

### Collecting logs by hand

Run **打开 Scribe 日志文件** from the command palette to save the Scribe log into your vault as a note and open it. The old Agent Chat activity-log controls have been removed; current native chats do not write that log. 旧版代理活动日志入口已移除，当前原生聊天不写入该日志。

Logs and screenshots can contain prompts, note contents, paths, and tool inputs. Review them before attaching anything to a public issue.

## What works on mobile?

Agent Chat, Projects, and Skill execution are desktop-only. On mobile, use Quick Ask, Quick Command, and saved editor commands. Desktop-only settings display their availability message on mobile.

## Related

- [Getting Started](getting-started.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [Scribe Settings](settings.md)
