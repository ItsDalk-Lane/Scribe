# Models and providers

Scribe 的 Agent Chat 和快捷工具共用现有的供应商、密钥及连接地址。你可以连接云端模型、兼容网关或本机服务，费用由对应模型服务收取。

隔离测试发现，移除供应商、更改或清空密钥可能影响其他供应商或插件使用的共用密钥。请先备份现有文件，再暂时停用 Scribe，直到问题修复；关闭时程序可能完成之前排队的保存。以下设置步骤应在修复后执行，详见[故障排查](troubleshooting-and-faq.md)。

Isolated tests found that removing a provider, or changing or clearing its key, can affect keys shared with another provider or plugin. Back up your files first, then disable Scribe until this is fixed; pending saves may finish during shutdown. Follow the setup steps below after the fixes. See [Troubleshooting](troubleshooting-and-faq.md).

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
5. Use **获取模型列表** (**Fetch models**) to read the provider's model directory, or choose from
   the catalog and enter an exact model ID yourself. A directory error does not
   prevent you from saving a valid configuration with a model selected.
6. Select a chat model and click **测试聊天连接** (**Test chat connection**) if you want to check
   that it can answer. When several chat models are selected, choose the model
   to test. This sends one short message and may use the provider's quota.
7. Click **保存** (**Save**). Opening or saving the form never sends a chat test.

When adding a provider with a default address or editing a provider, the form may request the model list using current inputs or a default address before saving. For a new provider that requires a key, automatic discovery waits until the key field is nonempty; an edit may trigger discovery even with an empty key. Address and other parameters also affect the request. It does not send a chat test.

新建带默认地址的供应商或编辑供应商时，表单可能根据当前输入或默认地址自动请求模型列表，无需先保存。新建需要密钥的供应商时，密钥字段非空后才会自动请求；编辑时即使密钥为空也可能请求。请求还取决于地址和其他参数，且不会发送聊天测试。

**获取模型列表** (**Fetch models**) only reads a directory. It does not prove permission to use a
model. **测试聊天连接** (**Test chat connection**) uses the current, unsaved key, address, parameters,
and selected model through the same connection as Quick tools. Only an actual
text reply shows **聊天连接验证通过** (**Chat connection verified**). Changing those inputs clears the
old chat result; a late result from an earlier check cannot verify the new inputs.

Each time you open **模型与供应商** (**Models and providers**), Scribe also checks your configured providers' directory
or key endpoint. The small “Verifying providers…” indicator reports these checks.
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
filled only when a request is made; the original template is kept. New providers enable **CORS
compatibility** by default. Existing explicit choices are retained. With this
setting enabled, replies normally appear after completion instead of word by word.

With compatibility off, a server that allows browser access can deliver text as
it is generated, and **Stop** cancels the streaming request. With compatibility
on, **Stop** ends the local turn and ignores any late reply, but cannot cancel a
request already sent to the server; provider-side work or billing may continue.
Accepted partial text remains available for follow-up questions.

If you press **Stop** while a provider is authenticating a chat, Scribe does not
send that chat's note content after authentication finishes. Some providers share
an authentication request between chats; stopping one chat does not cancel the
request needed by another. Leaving reasoning effort unset uses the provider's default.

Google model IDs can be entered with or without the `models/` prefix. Gemma
receives the same instructions within the conversation, and supported Google
services can continue a long reply without losing its earlier text. For Vertex
Anthropic, an omitted output limit remains 4096; an explicit limit takes priority.

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
tested on mobile. Credentials are stored on each device, so syncing a saved
configuration alone does not copy its secret to another device.

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
with the same selected model and read its error. For a browser access error,
check **启用 CORS** (**Enable CORS**), the CORS compatibility setting, which is enabled by default for new providers.
Responses then appear after completion. For LM Studio, enabling CORS in the local
server can let you turn compatibility off and keep word-by-word streaming.

## Agent Chat model access

Agent Chat 使用你在 **模型** 中配置并在聊天中选择的模型。模型目录和纯文字聊天测试不能证明工具可用：只有模型确实返回结构化工具调用，并在收到对应工具结果后继续回复，才完成一次工具交互。端点拒绝工具时会保留错误；真实服务的模型访问权限和额度仍需你自己的账号验证。

聊天模型测试会消耗所选供应商的用量。Scribe 不使用外部代理的登录或订阅账户，也不另存一份 Agent 专用密钥。

## Where keys are stored

Scribe stores configured provider API keys in this device's
**Obsidian 钥匙串** (**Obsidian Keychain**) rather than the current settings file. Keychain entries are
device-specific; syncing a vault does not copy the Keychain itself. Backups made
from older settings are not deleted automatically; they can
retain unencrypted keys inside the vault and may be copied by vault sync. An isolated
test found that an existing backup with the expected name is accepted without checking
whether its contents match the settings. Keep the original files and backups private,
and do not assume a backup contains the current settings.

钥匙串条目只在本机，资料库同步不会复制钥匙串本身。旧设置生成的备份不会自动删除，可能在资料库内保留明文密钥，并可能随资料库同步。隔离测试发现，程序会直接接受已有同名备份，而不检查其内容是否与设置一致。请妥善保管原文件和备份，不要假设备份一定包含当前设置。

If a provider echoes a key, isolated tests show that some connection or chat errors can expose it, and an unusual chat response can save it in a session record. Review chat records, screenshots, and diagnostic reports for secrets before sharing them. The tests used simulated responses, not a real provider account.

隔离测试发现，如果供应商在回复中回显密钥，某些连接或聊天错误可能暴露密钥，异常聊天回复也可能将密钥写入会话记录。分享聊天记录、截图或诊断报告前，请检查其中是否包含密钥。测试使用模拟回复，没有使用真实供应商账户。

Isolated tests of credential management found that removing a provider, or changing
or clearing its key, can affect a shared key used by another provider. Changing or
clearing a key can also affect a key belonging to another plugin. Back up your files
first and disable Scribe until these issues are fixed; pending saves may finish while
it shuts down. Do not remove providers or change or clear provider keys to troubleshoot. The tests used a
simulated host, not the actual interface or a real device's credentials.

When two vaults on one device share a Scribe key-storage identifier, isolated tests also
found that deleting all keys in one can remove the other's keys. Do not use **删除所有密钥** (**Delete All Keys**)
until this is fixed.

隔离测试发现，移除供应商、更改或清空其密钥可能影响其他供应商使用的共用密钥；更改或清空密钥还可能影响其他插件的密钥。如果同一设备上的两个资料库共用 Scribe 密钥存储标识，在一个库中删除全部密钥也可能移除另一个库的密钥。请先备份现有文件，再暂时停用 Scribe，直到这些问题修复；关闭时程序可能完成之前排队的保存。不要通过移除供应商、更改或清空密钥排查问题，也不要使用 **删除所有密钥**。测试使用的是替身宿主，没有操作真实界面或设备密钥。

After these issues are fixed, to remove stored credentials, open **Settings → Scribe → 关于 → API 密钥存储** (**Settings → Scribe → About → API key storage** in English) and click **删除所有密钥** (**Delete All Keys**).

## Related

- [Getting Started](getting-started.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Models, Effort, and Permissions](models-and-parameters.md)
- [Settings: Models and providers](settings.md#模型)
