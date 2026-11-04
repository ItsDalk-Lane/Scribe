# Troubleshooting Scribe

Start in **Settings → Scribe → 代理** and 检查 Scribe 的模型与权限状态。

## Scribe is starting or did not start

### A Scribe tab or Scribe's settings say “Starting Scribe…”

Scribe finishes loading in the background after Obsidian opens your vault, so the vault never waits for it. Until it is ready, Scribe tabs that were open last time and **Settings → Scribe** show **正在启动 Scribe…**, and Scribe's commands and ribbon icon are not there yet. This usually lasts a moment. The first start after an update can take longer while Scribe updates your settings.

Keep the tab open. It turns back into your chat as soon as Scribe is ready, and the settings page fills in on its own.

### “Scribe failed to start”

Scribe ran into an error while loading and stayed off for this session. To see the error, open the developer console (**View → Toggle Developer Tools**, then the **Console** tab). Then turn Scribe off and on again under **Settings → Community plugins**, or restart Obsidian. If the notice comes back, open an issue and include the error from the console.

## Agent Chat setup

### 没有可用模型或无法开始聊天

先在 **快捷操作 → 模型** 配置供应商及模型，再到 **代理 → Scribe** 启用聊天模型。检查密钥、地址、服务可达性及供应商额度。原生代理无需安装或登录外部程序。

参见 [Getting Started](getting-started.md) 和 [Models](models-and-parameters.md)。

## Models and API keys

### No models are enabled for Quick tools

Open **快捷操作 → 工具配置**, enable a model, and choose **快捷指令默认模型**. If none are configured, first add a provider under **Settings → Scribe → 快捷操作 → 模型**.

- **Add API key:** edit that provider under **模型**.
- **Not offered by agent:** the active agent no longer advertises that saved model. Select one it currently offers.

Agent Chat 和快捷工具共用原有自备模型连接。 See [Models](models-and-parameters.md) and [Providers](llm-providers.md).

### Keys disappeared, or “API Key Storage” says “Unavailable”

Scribe stores configured secrets in the Obsidian Keychain. Older installations may also have separate credential backups; handle those as sensitive files.

- **Unavailable:** update Obsidian to 1.11.4 or newer.
- **No API keys found in this device's Obsidian Keychain:** re-enter them. Keys are per device and do not follow a synced vault.
- To remove every stored secret, use **通用 → 其他 → API key storage → Delete All Keys**.

Do not delete `data.json`: it contains the vault's Keychain namespace. Use the in-app reset; it does not delete Keychain entries.

## Agent Chat is waiting or behaving unexpectedly

### Nothing happens after you send

Look for **需要授权** or **代理提问**. Review the inputs or diff, then choose an offered option. Another session tab may show an attention indicator.

权限卡只处理对应操作。**Stop** 取消当前回复和其尚未回答的请求；后台任务从任务列表分别停止。

### A skill or skill command is missing

在 **Settings → Scribe → 技能** 确认技能可读取并已为 Scribe 启用。仅手动调用的技能需要从 `/` 菜单选择；项目技能只在对应项目的聊天中出现。命令还需要处于启用状态，允许显示于 `/` 菜单的条目才会出现在下拉列表。

参见 [Skills](agent-mode-and-tools.md#skills)。

## Quick Ask does not open or has no model

- **Quick Ask is not available in source mode:** switch the note to Live Preview and try again.
- **No active editor found:** open a Markdown note in an editor pane.
- **No active model configured:** configure and select a default under **快捷操作 → 工具配置**.
- **Error generating response. Please try again:** retry once; if it continues, collect a log as described below.

See [Scribe Commands and Quick Ask](custom-commands.md#quick-ask) for selection and note-context behavior.

## Logs and bug reports

Use **通用 → 调试与支持 → Report an issue** for any Scribe problem, including Agent Chat and quick tools. Turn on **调试模式** in the same section first and reproduce the problem, so the logs you send actually contain it.

### Filing a report

1. **Describe what went wrong, and tick what to include.** The sources on offer are a screenshot of the Obsidian window, the **代理活动日志**, the regular Scribe chat log. Anything you tick that turns out to have nothing to collect is listed on the next page with the reason, so you never have to guess whether it was gathered.
2. **Let Scribe prepare the report.** The review page shows **正在准备报告…** until the zip is ready. Scribe briefly hides open dialogs, including Settings, to photograph the window behind them, reads and cleans the logs you asked for, and packs everything into one zip on your own computer — the zip is the only file it writes.
3. **Review what was packed, then upload.** Scribe lists what actually went into the zip, source by source, with the finished file's size and, beside anything skipped or failed, the reason. **显示压缩文件** opens the file in your file manager if you want to look inside. Uploading is a separate click — **上传并打开问题页面** — and nothing leaves your machine until you press it. **取消** here deletes the zip unless you have already chosen **直接打开问题页面**.
4. **Finish the issue in your browser.** As soon as the upload lands, Scribe opens a prefilled GitHub issue with the report ID already in the body, closes the dialog, and shows a short notice. If your browser could not be opened, the notice carries the report ID and a link to the issue page instead. Nothing is filed until you press Submit in your browser.

### Reporting from Agent Chat

When something goes wrong in an Agent Chat, select **更多操作** (⋯) above the composer and choose **Report error**. **反馈问题** opens for that chat without going through Settings: the screenshot is of the Obsidian window, every available attachment starts ticked, and the description ends with which agent, model and chat the report came from. Write what went wrong above that line, then continue with the steps above.

When Scribe itself fails in Agent Chat, such as a Scribe tool erroring, a needed tool missing, or you telling the agent Scribe crashed or lost your text, the agent may draft a report for you. The agent's own mistakes and answers don't get a card, since the Scribe team can't change how a model reasons. A **要向 Scribe 团队反馈此问题吗？** card appears under its reply, with a one-line summary and your own words. The card never interrupts the agent, and it appears at most once each time you open a chat. The card is not saved with the chat, so it is gone once you close the chat or reload Obsidian.

When a reply fails with an error, the same card appears under it, carrying the error.

- **查看并反馈** opens **反馈问题** with the draft already in the description: what happened, what you said, and steps to reproduce, or the error for a failed reply, plus which agent, model and chat it came from. Every available attachment starts ticked, so untick anything you would rather not send. Edit the description freely, then continue with the steps above. Once the upload lands, the card shows the report ID.
- **关闭提示** removes the card. Nothing is sent.
- **不再提示** removes the card and turns off **在代理聊天中提供反馈报告** in **通用 → 调试与支持**.

### What gets sent, and what does not

Before anything is written into the zip, Scribe cleans every log and your own description on this device: usernames taken from home-folder paths, email addresses, and recognizable credentials such as API keys and tokens are replaced with visible markers so you can see that something was removed. This is a best-effort pass over the formats Scribe knows, so an unfamiliar secret can still slip through — which is exactly what the review step is for.

**The screenshot is not cleaned at all.** It is a picture, so nothing can be found and removed in it. Look at it before you upload.

A log too large for the report keeps its newest entries rather than being dropped, and the file itself opens with a banner identifying it as a truncated log and naming the original size. Cleaning always runs over the whole log before anything is cut, so a log too large to clean whole (over 64 MB) is left out and listed with that reason.

The zip is uploaded only to Brevilabs. The upload reuses the random device identifier already used for this vault to group reports and limit uploads. It does not create a separate identifier for bug reports or use your Scribe account identity. If Scribe cannot read a valid saved device identifier, it refuses the upload; you can still save the zip and open the issue to attach it manually. The upload carries no account identity. The public GitHub issue carries the report ID and nothing else — there is no download link on it, and nothing on that page can fetch the bundle.

### What the report ID is for

It is the reference a maintainer looks your report up by. It is not a link, not a password, and there is nothing behind it that anyone reading the issue can open. Because it is just a reference, you can also paste it into Discord when you ask for help there, and it points at the same report.

### How long a report is kept

An uploaded report is stored privately and deleted automatically after 60 days. The report ID is in the issue you filed; copy it somewhere else if you may need it after that.

That deletion covers the uploaded copy only. The zip on your own computer is yours; Scribe leaves it alone after an upload or after you choose **直接打开问题页面**, so delete it yourself when you are done with it.

### If the upload fails

- **Retry first.** **重试上传** re-sends the very same file, and it cannot leave you with two copies stored: if the first attempt quietly did land, the retry returns that same report rather than storing another. The error text starts with **Upload failed (HTTP …)** when the server refused the file and says the outcome is unconfirmed when no answer came back; either way a retry is safe.
- **The manual path is always open.** The zip is still on your computer. Use **显示压缩文件** to find it and **直接打开问题页面** to file the report by hand — that issue carries no report ID, so attach the zip to it yourself. After choosing **直接打开问题页面**, you can close the Scribe dialog without losing the zip, even if your browser did not open.
- **Closing the dialog does not stop an upload.** It finishes in the background; when it lands, a notice shows the report ID and a link to the issue page, and the zip stays where it was.
- **If uploads are turned away because too many were sent recently,** wait a while and try again, or file it by hand. On a shared or office network it may not have been your own uploads that used up the limit.

### Collecting logs by hand

Run **Scribe: Open Scribe log file** from the command palette to save the Scribe log into your vault as a note and open it. The Agent Chat log can be opened or cleared under **通用 → 调试与支持 → Agent activity log**；该日志只保存较早版本 Scribe 记录的活动，当前原生聊天不写入其中。

Logs and screenshots can contain prompts, note contents, paths, and tool inputs. Review them before attaching anything to a public issue.

## What works on mobile?

Agent Chat, Projects, and Skill execution are desktop-only. On mobile, use Quick Ask, Quick Command, and saved editor commands. Agent settings display **Agent settings are available on desktop.**

## Related

- [Getting Started](getting-started.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [Scribe Settings](settings.md)
