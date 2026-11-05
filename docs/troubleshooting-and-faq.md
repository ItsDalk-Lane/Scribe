# Troubleshooting Scribe

**Current safety notice:** Isolated tests found risks to existing files during startup, changing or resetting settings, skill refresh, cache cleanup, and note writes. Back up your files first, then disable Scribe until these issues are fixed; pending saves may finish during shutdown. Follow the troubleshooting steps below after the fixes.

**当前安全提示：** 隔离测试发现启动、更改或重置设置、刷新技能、清除缓存和写入笔记时存在文件受损风险。请先备份现有文件，再暂时停用 Scribe，直到问题修复；关闭时程序可能完成之前排队的保存。以下排查步骤应在修复后执行。

After the fixes, start in **Settings → Scribe → 代理** and check Scribe's model and permission status.

## Scribe is starting or did not start

### A Scribe tab or Scribe's settings say “Starting Scribe…”

Scribe finishes loading in the background after Obsidian opens your vault, so the vault never waits for it. Until it is ready, Scribe tabs that were open last time and **Settings → Scribe** show **正在启动 Scribe…**, and Scribe's commands and ribbon icon are not there yet. This usually lasts a moment. The first start after an update can take longer while Scribe updates your settings.

Keep the tab open. It turns back into your chat as soon as Scribe is ready, and the settings page fills in on its own.

### “Scribe failed to start”

Scribe ran into an error while loading and stayed off for this session. To see the error, open the developer console (**View → Toggle Developer Tools**, then the **Console** tab). Keep Scribe disabled until the file-safety issues above are fixed; do not re-enable or restart it to troubleshoot. After the fixes, if the notice returns, open an issue and include the error from the console.

## Agent Chat setup

### 没有可用模型或无法开始聊天

先在 **快捷操作 → 模型与供应商** 配置供应商及模型，再到 **代理 → Scribe** 启用聊天模型。检查密钥、地址、服务可达性及供应商额度。原生代理无需安装或登录外部程序。

隔离测试发现，即使代理模型全部停用，状态仍可能显示就绪；设置引用的密钥在本机缺失时，也可能显示可用但启动失败。请在文件安全问题修复后分别检查模型开关和供应商密钥；测试未使用真实桌面或设备密钥。

Isolated tests found that the agent can appear ready with all its models disabled, or appear available but fail to start when its saved key reference has no key on this device. After the file-safety issues are fixed, check the agent model switches and provider key separately. The tests did not use a real desktop or device credentials.

如果 Agent Chat 的模型选择器显示 **Not offered by agent**，说明当前代理没有报告该模型；请选择它当前提供的模型。

参见 [Getting Started](getting-started.md) 和 [Models](models-and-parameters.md)。

## Models and API keys

### No models are enabled for Quick tools

Open **快捷操作 → 工具配置**, enable a model, and choose **快捷指令默认模型**. If none are configured, first add a provider under **Settings → Scribe → 快捷操作 → 模型与供应商**.

- **Add API key:** edit that provider under **模型与供应商**.
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
- To remove this vault's Scribe API keys, use **通用 → 其他 → API 密钥存储 → 删除所有密钥**. Existing credential backups may remain; review them separately.

Do not delete `data.json`: it contains the vault's Keychain namespace. Although resetting settings does not delete Keychain entries, it can trigger the skill file loss described below. Back up your files first and disable Scribe until that issue is fixed; pending saves may finish during shutdown. Do not use reset to troubleshoot.

不要删除 `data.json`，其中保存着资料库的密钥存储标识。重置设置虽然不会删除密钥条目，却可能触发下述技能文件丢失问题。请先备份现有文件，再暂时停用 Scribe，直到问题修复；关闭时程序可能完成之前排队的保存。不要通过重置设置排查。

## Agent Chat is waiting or behaving unexpectedly

### Nothing happens after you send

Look for **需要授权** or **代理提问**. Review the inputs or diff, then choose an offered option. Another session tab may show an attention indicator.

权限卡只处理对应操作。**Stop** 取消当前回复和其尚未回答的请求；后台任务从任务列表分别停止。

### A skill or skill command is missing

隔离测试发现，启动、更改或重置设置、刷新内置技能可能覆盖或删除用户文件，启用同名技能也可能删除已有目录。请先备份现有文件，再暂时停用 Scribe，直到问题修复；关闭时程序可能完成之前排队的保存。不要通过更改或重置 Scribe 设置、刷新或启用技能尝试排查。

Isolated tests found that startup, changing or resetting settings, or built-in skill refresh can overwrite or delete user files, and enabling a same-named skill can delete an existing folder. Back up your existing files first, then disable Scribe until these issues are fixed; pending saves may finish during shutdown. Do not troubleshoot by changing or resetting Scribe settings, refreshing, or enabling skills.

修复后，可在 **Settings → Scribe → 技能** 确认技能可读取并已为 Scribe 启用。仅手动调用的技能需要从 `/` 菜单选择；当前版本可能无法自动发现项目目录中的技能。命令还需要处于启用状态，允许显示于 `/` 菜单的条目才会出现在下拉列表。

参见 [Skills](agent-mode-and-tools.md#skills)。

## Quick Ask does not open or has no model

- **Quick Ask is not available in source mode:** switch the note to Live Preview and try again.
- **No active editor found:** open a Markdown note in an editor pane.
- **No active model configured:** configure and select a default under **快捷操作 → 工具配置**.
- **Error generating response. Please try again:** retry once; if it continues, collect a log as described below.

See [Scribe Commands and Quick Ask](custom-commands.md#quick-ask) for selection and note-context behavior.

## Agent note writes

Isolated tests found file-write safety issues. Until they are fixed, do not ask the agent to write or edit notes, including through **Auto** or saved permissions. Before editing manually, check whether the note shares a file with an outside entry; if unsure, first save its contents as a new note. See [Models, effort, and permissions](agent-mode-and-tools.md#models-effort-and-permissions) for the affected behavior.

隔离测试发现了笔记写入安全问题。修复前，请暂时不要让代理写入或编辑笔记，包括使用 **Auto** 或已记住的授权；手动编辑前请确认文件未与库外文件共用，不确定时先另存为新笔记。受影响的行为见 [模型与权限说明](agent-mode-and-tools.md#models-effort-and-permissions)。

## Cache cleanup

For now, do not run **Clear Scribe cache** (**清除 Scribe 缓存**). It can delete user files directly inside the vault's `.scribe/file-content-cache`, everything under `.scribe/pdf-cache`, and, on desktop, everything under the per-vault `.obsidian-scribe/vaults/<vault-id>/context-cache` in your home folder. It may also report success when clearing fails. A backup can help recover files, but it does not fix this issue.

目前请不要在命令面板中运行 **清除 Scribe 缓存**（**Clear Scribe cache**）。该命令可能删除直接位于资料库 `.scribe/file-content-cache` 内的用户文件、`.scribe/pdf-cache` 下的所有内容，以及桌面端用户主目录中 `.obsidian-scribe/vaults/<vault-id>/context-cache` 下的所有内容；清理失败时也可能误报成功。备份有助于恢复文件，但不能修复此问题。

## Logs and bug reports

Use **通用 → 调试与支持 → 反馈问题** for any Scribe problem, including Agent Chat and quick tools. Turn on **调试模式** in the same section first and reproduce the problem, so the logs you send actually contain it.

### Filing a report

1. **Describe what went wrong, and tick what to include.** The sources on offer are a screenshot of the Obsidian window, the **代理活动日志**, the regular Scribe chat log. Anything you tick that turns out to have nothing to collect is listed on the next page with the reason, so you never have to guess whether it was gathered.
2. **Let Scribe prepare the report.** The review page shows **正在准备报告…** until the zip is ready. Scribe briefly hides open dialogs, including Settings, to photograph the window behind them, reads and cleans the logs you asked for, and packs everything into one zip on your own computer — the zip is the only file it writes.
3. **Review what was packed, then upload.** Scribe lists what actually went into the zip, source by source, with the finished file's size and, beside anything skipped or failed, the reason. **显示压缩文件** opens the file in your file manager if you want to look inside. Uploading is a separate click — **上传并打开问题页面** — and nothing leaves your machine until you press it. **取消** here deletes the zip unless you have already chosen **直接打开问题页面**.
4. **Finish the issue in your browser.** If the dialog is still open after upload succeeds, Scribe attempts to open a prefilled GitHub issue and closes the dialog. If the browser cannot be opened, or the dialog was closed during upload, a notice provides the report ID and a link instead. Review the draft before submitting it; opening the page shares its contents with GitHub, but nothing is filed until you submit it.

### Reporting from Agent Chat

When something goes wrong in an Agent Chat, select **更多操作** (⋯) above the composer and choose **反馈问题**. The report opens for that chat without going through Settings: the screenshot is of the Obsidian window, every available attachment starts ticked, and the description ends with which agent, model and chat the report came from. Write what went wrong above that line, then continue with the steps above.

When Scribe itself fails in Agent Chat, such as a Scribe tool erroring, a needed tool missing, or you telling the agent Scribe crashed or lost your text, the agent may draft a report for you. Reports are intended for Scribe problems; review the draft because its contents can vary. A **要向 Scribe 团队反馈此问题吗？** card may appear with a one-line summary and your own words. The card never interrupts the agent, and it appears at most once each time you open a chat. The card is not saved with the chat, so it is gone once you close the chat or reload Obsidian.

When a reply fails with an error, the same card may appear with the error if feedback reports are enabled and the chat has not already offered a card.

- **查看并反馈** opens **反馈问题** with the draft already in the description: what happened, what you said, and steps to reproduce, or the error for a failed reply, plus which agent, model and chat it came from. Every available attachment starts ticked, so untick anything you would rather not send. Edit the description freely, then continue with the steps above. Once the upload lands, the card shows the report ID.
- **关闭提示** removes the card. Nothing is sent.
- **不再提示** removes the card and turns off **在代理聊天中提供反馈报告** in **通用 → 调试与支持**. This prevents new feedback cards both after failed replies and when the agent calls its feedback tool. You can still open **反馈问题** manually and choose whether to upload.

关闭该选项后，回复失败和代理反馈工具都不会再提供新的反馈卡；你仍可手动打开 **反馈问题**，只有选择上传后才会发送报告。

### What gets sent, and what does not

Before anything is written into the zip, Scribe cleans every log and your own description on this device: usernames taken from home-folder paths, email addresses, and recognizable credentials such as API keys and tokens are replaced with visible markers so you can see that something was removed. This is a best-effort pass over the formats Scribe knows, so an unfamiliar secret can still slip through — which is exactly what the review step is for.

**The screenshot is not cleaned at all.** It is a picture, so nothing can be found and removed in it. Look at it before you upload.

A log too large for the report keeps its newest entries rather than being dropped, and the file itself opens with a banner identifying it as a truncated log and naming the original size. Cleaning always runs over the whole log before anything is cut, so a log too large to clean whole (over 64 MB) is left out and listed with that reason.

The zip is sent to Brevilabs when you choose to upload. The request uses a locally saved random device identifier; if none exists, Scribe may create and save one. If it cannot save and verify a valid identifier, it refuses the upload. Scribe does not automatically add an account credential to the upload headers, but screenshots, descriptions, and logs can contain identifying information.

The GitHub issue link contains the report ID and may also contain part of your description, app and platform details, and attachment names. GitHub receives the draft when the page opens, even before you submit it. The zip is not attached automatically and Scribe does not put a download link in the issue. Review both the zip before uploading and the issue draft before submitting.

选择上传时，压缩包会发送给 Brevilabs。打开 GitHub 问题页面时，草稿可能包含您的描述、应用信息和附件名称，GitHub 会收到这些内容。截图不会自动遮盖；上传前请检查压缩包，提交前请检查草稿。

### What the report ID is for

It is a reference returned by the report service and included in the issue draft. Scribe does not generate a download link from it; who can use the reference to access a report has not been verified. Share it only when you intend to.

### How long a report is kept

The [upstream documentation](https://docs.obsidiancopilot.com/troubleshooting-and-faq/) says its reports are private and deleted after 60 days. Scribe cannot independently verify the uploaded copy's privacy, retention, or whether its maintainers can access it.

The upstream deletion description concerns the uploaded copy only. The zip on your own computer is yours; Scribe leaves it alone after an upload or after you choose **直接打开问题页面**, so delete it yourself when you are done with it.

### If the upload fails

- **Retry carefully.** **重试上传** re-sends the same file with the same request identifier. An earlier attempt may already have arrived; the service's handling of retries has not been verified. The error starts with **Upload failed (HTTP …)** when the server refused the file and says the outcome is unconfirmed when no answer came back.
- **The manual path is always open.** The zip is still on your computer. Use **显示压缩文件** to find it and **直接打开问题页面** to file the report by hand — that issue carries no report ID, so attach the zip to it yourself. After choosing **直接打开问题页面**, you can close the Scribe dialog without losing the zip, even if your browser did not open.
- **Closing the dialog does not stop an upload.** It finishes in the background; when it lands, a notice shows the report ID and a link to the issue page, and the zip stays where it was.
- **If uploads are turned away because too many were sent recently,** wait a while and try again, or file it by hand. On a shared or office network it may not have been your own uploads that used up the limit.

### Collecting logs by hand

Run **打开 Scribe 日志文件** from the command palette to save the Scribe log into your vault as a note and open it. The Agent Chat log can be opened or cleared under **通用 → 调试与支持 → 代理活动日志**；该日志只保存较早版本 Scribe 记录的活动，当前原生聊天不写入其中。

Logs and screenshots can contain prompts, note contents, paths, and tool inputs. Review them before attaching anything to a public issue.

## What works on mobile?

Agent Chat, Projects, and Skill execution are desktop-only. On mobile, use Quick Ask, Quick Command, and saved editor commands. Agent settings display **Agent settings are available on desktop.**

## Related

- [Getting Started](getting-started.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [Scribe Settings](settings.md)
