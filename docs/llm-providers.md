# Models and providers

Scribe 的 Agent Chat 和快捷工具共用现有的供应商、密钥及连接地址。你可以连接云端模型、兼容网关或本机服务，费用由对应模型服务收取。

密钥现在由当前库的主密码保护，保存在库内的加密文件中，不再使用系统钥匙串。已有模型和连接配置会保留；旧位置的密钥和资料不会自动导入，需要重新填写密钥。

## Choose a model source

| 模型来源       | Quick tools | Agent Chat |
| -------------- | ----------- | ---------- |
| 云端或兼容服务 | 支持        | 支持       |
| 本机模型服务   | 支持        | 支持       |

## Configure a provider

Connect Scribe to an AI provider, a compatible gateway, or a model server on your
computer. For cloud providers, usage and billing stay with that provider. Supplying
your own API key when one is required is often called Bring Your Own Key (BYOK).
Some local or custom endpoints do not require a key.

Quick Ask, Quick Command, and Agent Chat share the provider connections saved in
Scribe. The selected model depends on the tool or chat you are using.

1. Open **Settings → Scribe → 模型** (**Settings → Scribe → Models** in English).
2. Click **添加供应商** (**Add a provider**).
3. Choose a provider, **Ollama**, **LM Studio**, or **添加自定义供应商** (**Add a custom provider**).
4. Enter the credential, **基础地址** (**Base URL**), and any provider-specific fields, such
   as the account, project, or gateway ID. Keep JSON credentials in the credential
   field; public fields do not store a separate copy of your secret.
5. Use **获取模型列表** (**Fetch models**) to switch the dialog to the model list view and read
   the provider's model directory, or choose from the catalog and enter an exact model ID there.
   Models you have added stay at the top of the list with ticked boxes; unchecking one removes
   it from this provider. Use **返回** (**Back**) to return to the configuration view; entered
   values are kept. A directory error does not prevent you from saving a valid configuration
   with a model selected.
6. Select a chat model and click **测试聊天连接** (**Test chat connection**) if you want to check
   that it can answer. When several chat models are selected, choose the model
   to test. This sends one short message and may use the provider's quota.
7. Click **保存** (**Save**). Opening or saving the form never sends a chat test.

新建供应商时，表单可能根据当前输入自动获取模型列表；需要密钥时，会等你填写后再请求。获取到的模型显示在模型列表界面中；配置表单的“已选择的模型”区域只列出已添加的模型，取消勾选即移除。编辑供应商不会自动读取已保存的密钥或自动请求模型列表。主动点击 **获取模型列表** 或 **测试聊天连接** 时，如果密钥尚未解锁，会先显示主密码窗口。模型页上每个供应商的检查结果会记住上次的结果：重新打开或重载插件后先直接显示上次的检查状态，不在打开页面时自动发起网络检查；修改了地址或重新填写密钥后，旧结果自动失效，需重新检查才会显示新状态。

Opening an existing provider never fills its saved key into the form or unlocks it. Use **Fetch models** or **Test chat connection** to make a request with the saved key. If needed, Scribe asks for the vault's master password first. New-provider discovery may use credentials you have just entered.

**获取模型列表** (**Fetch models**) only reads a directory. It does not prove permission to use a
model. **测试聊天连接** (**Test chat connection**) uses the current, unsaved key, address, parameters,
and selected model through the same connection as Quick tools. Only an actual
text reply shows **聊天连接验证通过** (**Chat connection verified**). Changing those inputs clears the
old chat result; a late result from an earlier check cannot verify the new inputs.

Each time you open **模型与供应商** (**Models and providers**), Scribe also checks your configured providers' directory
or key endpoint when credentials are already unlocked. Locked credentials are left untouched;
background checks never open the password window. The small “Verifying providers…” indicator reports these checks.
**接口可访问** (**Endpoint accessible**) means that endpoint returned the expected data, not that
chat has been tested. **未设置密钥** (**No key**) or **密钥无效** (**Invalid key**) indicates a missing or rejected
credential. **访问受限** (**Access restricted**) can mean the account lacks permission; read the
provider's original reason before replacing a key. **尚未验证** (**Not verified**) means the
check address was not found. **返回内容异常** (**Unexpected response**) can mean an address returned
a login page or other content instead of API data. Your saved configuration is
kept, and you can still choose a catalog model or enter its ID manually.

The provider list changes with the live catalog. The current validation covers a
snapshot of **232 visible providers using simulated local requests**. It checks
how saved settings are used to build requests; it is **not a successful test of
232 real provider accounts**. A real account still needs the right credential,
model access, available quota, and a reachable service. Use **测试聊天连接** (**Test chat connection**)
with your selected model to check those conditions yourself.

Public connection parameters are saved with the provider. Scribe uses the saved
address and supported extra settings when making a request. URL placeholders are
filled only when a request is made; the original template is kept. Scribe chooses
the connection method automatically; there is no CORS switch to configure.

On desktop, replies appear as they are generated when the provider supports
streaming. **Stop** cancels the live connection, and accepted partial text remains
available for follow-up questions. On mobile, replies may appear only after
completion. **Stop** ends the local turn and ignores any late reply, but cannot
cancel a request already sent through the mobile connection; provider-side work
or billing may continue.

If you press **Stop** while a provider is authenticating a chat, Scribe does not
send that chat's note content after authentication finishes. Each chat request prepares
its own credentials; stopping one chat does not stop a live sibling request.
Leaving reasoning effort unset uses the provider's default.

请求准备和等待服务开始返回都有等待期限；鉴权长时间无响应时会结束等待，之后仍可重试。已经正常持续输出的回复不会因为等待服务开始返回的期限到达而被截断，长时间没有任何新内容时才会结束。超时或连接中断在重试后仍失败时会显示错误，只有你主动停止才作为取消处理。SAP 的不同部署、资源组和地址分别使用各自的连接设置。

Google model IDs can be entered with or without the `models/` prefix. Gemma
receives the same instructions within the conversation, and supported Google
services can continue a long reply without losing its earlier text. For Vertex
Anthropic, an omitted output limit remains 4096; an explicit limit takes priority.

在同一聊天中切换到 Google 模型时，会保留普通对话和已有工具结果，移除来自其他供应商或模型的内部思考资料。继续使用同一 Google 模型时，会保留它要求回传的原始信息及分段，避免后续请求因记录格式不符而失败。

Automated checks cover incremental HTTP replies, cancellation, follow-ups,
connection errors, and mobile startup and first requests, including service-account
signing. They use fixture services, not live model accounts or physical iOS/Android
devices; test your actual endpoint on each device you use.

New chat models are enabled for Quick tools by default. Image, speech, embedding, and reranking models remain saved but are marked separately and are not offered as chat choices.

配置后的聊天模型直接供 Agent Chat 和快捷工具使用，无需分别启用。快捷工具默认使用配置顺序中第一个可用模型；聊天记住最近一次成功选择的模型、推理强度和权限模式。首次新聊天使用第一个可运行模型和自动模式。

### OpenCode and OpenCode Go

OpenCode here is a model service (`opencode.ai` inference API), unrelated to how the agent itself runs. The catalog keeps each model's correct OpenAI, Anthropic, or Gemini address. Use
your OpenCode personal API key or service account key. A directory check does not
confirm access to every model: the account's plan, model permissions, and privacy
settings can still restrict a chat request.

For Go's OpenAI-compatible models, keep the chat **基础地址** (**Base URL**) as
`https://opencode.ai/inference/go/openai/v1`. **获取模型列表** (**Fetch models**) reads the separate
`https://opencode.ai/inference/go/v1/models` address. **测试聊天连接** (**Test chat connection**) sends
one real test message to the selected model; it is no longer just a key check.

OpenCode's free chat models are restricted to OpenCode itself. Quick tools can
use paid models or models allowed by your Go subscription; entering a key does
not remove the free-model restriction. Scribe identifies itself under its own
name and keeps a stable Go session identifier for each chat.

See the [OpenCode inference API](https://opencode.ai/v2/docs/console/api/inference/)
and [OpenCode Go guide](https://opencode.ai/v2/docs/console/go/) for current access
requirements.

### Providers with extra setup

- **Google Vertex AI:** enter the project and location, then paste service-account
  JSON or a current access token into the credential field.
- **Watsonx:** enter the IBM Cloud API key and project ID.
- **Cohere:** the recommended **API format** is **OpenAI-compatible API**, including
  for your own compatible proxy. To use Cohere's native service, choose
  **Provider-native API** and enter its native base URL, such as
  `https://api.cohere.com/v2`. Changing the format keeps your address and clears
  the previous chat check; test again after making the change.
- **Cloudflare Workers AI / AI Gateway:** enter the account ID and, for a gateway,
  its gateway ID. These fields complete the provider's address.
- **SAP AI Core:** paste the service-key JSON. It supplies the service address,
  so a separate base URL is optional. You may set the resource group and deployment
  ID.
- **GitLab:** use a personal access token or OAuth access token with the required
  model access. Check the GitLab instance and AI Gateway address.
- **QVAC:** first start your QVAC server, then enter its actual base URL and key.
  There is no assumed default address. Saving and testing stay disabled until
  the required address is filled in.

SAP AI Core, GitLab, and Google Vertex connections can also be configured and
tested on mobile. Moving only the settings file does not copy the encrypted credentials.
To use saved keys on another device, transfer the vault's `.scribe` data and plugin
settings together, then unlock them with the same master password. Check that your
sync tool includes hidden folders; Scribe does not transfer these files for you.

### Privatemode and Tinfoil privacy setup

**Privatemode** defaults to `http://localhost:8080/v1`, the address of its local
proxy. Start the [official Privatemode proxy](https://docs.privatemode.ai/getting-started/api/)
before testing. The proxy performs the service verification and encryption. When
the proxy already holds your API key, a placeholder key in Scribe is sufficient.
Entering a real key in Scribe alone does not start the proxy. Privatemode's
proxyless HTTPS option has a different privacy model; do not assume it provides
the same client-verified protection.

**Tinfoil** accepts a normal HTTPS connection, but that connection does not verify
the secure environment before sending your text. For verified privacy, use the
[official Tinfoil proxy](https://docs.tinfoil.sh/local-proxy/cli) and change the base
URL to its local address, usually `http://127.0.0.1:3301/v1`. A successful chat test
checks that a reply arrives; it does not prove encryption or remote verification.
See [Tinfoil's direct-connection explanation](https://docs.tinfoil.sh/sdk/direct-api-access).

### Local and Custom Endpoints

Inside **模型与供应商 → 添加供应商** (**Models and providers → Add a provider**), choose **Ollama** or **LM Studio** from the
**Self-host** group to use their local OpenAI-compatible servers. Their API key is optional, and Scribe fills in the
usual local URL:

- Ollama: `http://localhost:11434/v1`
- LM Studio: `http://localhost:1234/v1`

Start the local server before testing the provider. For another compatible
service or proxy, choose **添加自定义供应商** (**Add a custom provider**) and enter its base URL and
model ID. The API key is optional; add one when the endpoint requires
authentication. Model discovery uses the endpoint's `/v1/models` response, but
you can always enter an exact model ID before searching the discovered list.

If a directory loads but sending a message fails, use **测试聊天连接** (**Test chat connection**)
with the same selected model and read its error. On desktop, Scribe connects
without requiring browser CORS access, including for local model servers. You do
not need to change a CORS setting to receive streaming replies.

## Agent Chat model access

Agent Chat 使用你在 **模型** 中配置并在聊天中选择的模型。模型目录和纯文字聊天测试不能证明工具可用：只有模型确实返回结构化工具调用，并在收到对应工具结果后继续回复，才完成一次工具交互。端点拒绝工具时会保留错误；真实服务的模型访问权限和额度仍需你自己的账号验证。

聊天模型测试会消耗所选供应商的用量。Scribe 不使用外部代理的登录或订阅账户，也不另存一份 Agent 专用密钥。

## Where keys are stored

密钥保存到当前库根目录 `.scribe/secrets` 内的加密 JSON 文件。插件设置文件只保留密钥引用，不保存密钥明文。普通 API 密钥、访问令牌、包含私钥的服务账号 JSON 都按同一规则保存；主密码本身不会以明文写入磁盘。

首次保存密钥时设置并确认主密码。每次打开库后，首次主动使用已保存密钥时解锁一次；关闭库或停用插件后需要重新解锁。查看设置和切换模型不会解密密钥，发送请求时只解密对应服务商需要的内容。

桌面端默认开启 **在这台设备上记住主密码**（设置 → Scribe → Agent 配置）：解锁成功后，主密码会用操作系统钥匙串再加密一层，作为设备解锁包保存在 `.scribe/secrets` 内。此后插件重载或 Obsidian 重启时自动恢复解锁，不再要求重新输入；恢复仍要通过原有的主密码校验，校验失败会自动删除该解锁包并回到正常输入窗口。把这个开关关闭或重置密钥存储，都会删除解锁包，下次回到每次输入的行为。该解锁包只在本机、本应用账户下可解密；把 `.scribe` 文件夹拷到别处仍然解不开任何密钥。移动端不支持此功能，保持每次输入。

编辑供应商时，密钥栏会显示 **已保存密钥**，输入框保持空白。留空并保存会保留原密钥；填写新内容会替换它；点击 **清除** 后保存才会移除。取消主密码窗口不会发送请求，也不会清空聊天问题或指令草稿。

Scribe stores each provider's credential in an encrypted JSON file inside the current
vault's `.scribe/secrets` folder. The settings file keeps only a reference. Your master
password is never saved. Viewing settings does not decrypt saved credentials; only
an outgoing request resolves the selected provider's secret.

The credential field stays empty when you edit a provider. Leave it blank to keep the
saved key, enter a replacement, or explicitly clear it and save. Cancelling the
master-password prompt leaves your draft intact and sends no request.

忘记主密码无法恢复原密钥。解锁窗口提供重置入口，需要明确确认；重置只移除新密钥存储及其引用，之后重新填写密钥。聊天、技能、项目说明和普通笔记不会因此删除。不要把主密码和加密资料一起分享。

旧系统钥匙串和旧位置文件不会被读取、导入或清理。若旧备份含有明文密钥，它们仍需要自行妥善保管。新加密方式不能保护旧备份，也不能承诺请求期间的内存明文会立即物理清零。

Scribe masks this request's known credential values in replies, thinking, tool inputs,
model-list results and errors before they enter chat records or diagnostic output.
This includes the entered key, private keys and tokens inside service-account JSON,
and the request's derived authorization token. Split response chunks are checked
before they are joined. Opening or reopening settings does not run credential checks;
connection tests and model queries are explicit actions.

Only known original values are covered. Unknown transformations, encoded variants,
and secrets that you type directly into your notes or questions may remain. Review
chat records, screenshots and diagnostic reports before sharing them. These checks
use simulated responses, not real provider accounts.

Scribe 会在回复、思考内容、工具输入、模型查询结果和错误进入聊天记录或诊断输出前，遮盖本次请求已知的密钥原值，包括服务账号 JSON 中的私钥和令牌，以及认证后取得的本次访问令牌。分段回复会在合并前检查。打开或重新打开设置不会检查已保存密钥；连接测试和模型查询需要主动操作。

这只覆盖已知原值，不能识别所有未知变形或编码形式，也不能替你清除自己写进笔记或问题中的秘密。分享记录、截图或诊断资料前仍需检查。验证使用模拟回复，没有使用真实服务商账户。

## Related

- [Getting Started](getting-started.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Models, Effort, and Permissions](models-and-parameters.md)
- [Settings: Models and providers](settings.md#模型)
