# Model Sources and BYOK

Scribe 的 Agent Chat 和快捷工具共用现有的供应商、密钥及连接地址。你可以连接云端模型、兼容网关或本机服务，费用由对应模型服务收取。

## Choose a model source

| 模型来源                   | Quick tools | Agent Chat |
| -------------------------- | ----------- | ---------- |
| 自备密钥或连接地址（BYOK） | 支持        | 支持       |
| 本机模型服务               | 支持        | 支持       |

## Bring your own key (BYOK)

BYOK lets you connect Scribe directly to an AI provider, a compatible gateway,
or a model server on your computer. For cloud providers, usage and billing stay
with that provider.

BYOK uses pi-ai as its internal connection engine. Quick Ask, Quick Command,
provider settings, model selection, saved configuration, and key storage stay
the same; existing providers do not need to be recreated. Agent Chat 现在也沿用这些连接设置。

1. Open **Settings → Scribe → 快捷操作 → 模型**.
2. Click **添加服务商**.
3. Choose a provider, **Ollama**, **LM Studio**, or **添加自定义服务商**.
4. Enter the credential, **基础地址**, and any provider-specific fields, such
   as the account, project, or gateway ID. Keep JSON credentials in the credential
   field; public fields do not store a separate copy of your secret.
5. Use **获取模型列表** to read the provider's model directory, or choose from
   the catalog and enter an exact model ID yourself. A directory error does not
   prevent you from saving a valid configuration with a model selected.
6. Select a chat model and click **测试聊天连接** if you want to check
   that it can answer. When several chat models are selected, choose the model
   to test. This sends one short message and may use the provider's quota.
7. Click **保存**. Opening or saving the form never sends a chat test.

**获取模型列表** only reads a directory. It does not prove permission to use a
model. **测试聊天连接** uses the current, unsaved key, address, parameters,
and selected model through the same connection as Quick tools. Only an actual
text reply shows **聊天连接验证通过**. Changing those inputs clears the
old chat result; a late result from an earlier check cannot verify the new inputs.

Each time you open **模型**, Scribe also checks your configured providers' directory
or key endpoint. The small “Verifying providers…” indicator reports these checks.
**接口可访问** means that endpoint returned the expected data, not that
chat has been tested. **未设置密钥** or **密钥无效** indicates a missing or rejected
credential. **访问受限** can mean the account lacks permission; read the
provider's original reason before replacing a key. **尚未验证** means the
check address was not found. **返回内容异常** can mean an address returned
a login page or other content instead of API data. Your saved configuration is
kept, and you can still choose a catalog model or enter its ID manually.

The provider list changes with the live catalog. The current validation covers a
snapshot of **232 visible providers using simulated local requests**. It checks
how saved settings are used to build requests; it is **not a successful test of
232 real provider accounts**. A real account still needs the right credential,
model access, available quota, and a reachable service. Use **测试聊天连接**
with your selected model to check those conditions yourself.

Public connection parameters are saved with the provider. Existing custom
addresses and extra settings are retained. URL placeholders are filled only when
a request is made; the original template is kept. New providers enable **CORS
compatibility** by default. Existing explicit choices are retained. With this
setting enabled, replies normally appear after completion instead of word by word.

With compatibility off, a server that allows browser access can deliver text as
it is generated, and **Stop** cancels the streaming request. With compatibility
on, **Stop** ends the local turn and ignores any late reply, but cannot cancel a
request already sent to the server; provider-side work or billing may continue.
Accepted partial text remains available for follow-up questions.

If a chat is still waiting for sign-in to finish when you press **Stop**, Scribe
does not send its note content afterward. Other chats can finish signing in and
continue normally. Leaving reasoning effort unset uses the provider's default.

Google model IDs can be entered with or without the `models/` prefix. Gemma
receives the same instructions within the conversation, and supported Google
services can continue a long reply without losing its earlier text. For Vertex
Anthropic, an omitted output limit remains 4096; an explicit limit takes priority.

Automated checks cover incremental HTTP replies, cancellation, follow-ups,
connection errors, and mobile startup and first requests, including service-account
signing. They use fixture services, not live model accounts or physical iOS/Android
devices; test your actual endpoint on each device you use.

New chat models are enabled for Quick tools by default. Image, speech, embedding, and reranking models remain saved but are marked separately and are not offered as chat choices.

**快捷操作 → 工具配置** controls **Quick tools models** and its **快捷指令默认模型**, shared by Quick Ask and commands.

### OpenCode and OpenCode Go

OpenCode here is a model service (`opencode.ai` inference API), unrelated to how the agent itself runs. The catalog keeps each model's correct OpenAI, Anthropic, or Gemini address. Use
your OpenCode personal API key or service account key. A directory check does not
confirm access to every model: the account's plan, model permissions, and privacy
settings can still restrict a chat request.

For Go's OpenAI-compatible models, keep the chat **基础地址** as
`https://opencode.ai/inference/go/openai/v1`. **获取模型列表** reads the separate
`https://opencode.ai/inference/go/v1/models` address. **测试聊天连接** sends
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

Inside **模型 → Add a provider**, choose **Ollama** or **LM Studio** from the
**Self-host** group to use their local OpenAI-compatible servers. Their API key is optional, and Scribe fills in the
usual local URL:

- Ollama: `http://localhost:11434/v1`
- LM Studio: `http://localhost:1234/v1`

Start the local server before testing the provider. For another compatible
service or proxy, choose **添加自定义服务商** and enter its base URL and
model ID. The API key is optional; add one when the endpoint requires
authentication. Model discovery uses the endpoint's `/v1/models` response, but
you can always enter an exact model ID before searching the discovered list.

If a directory loads but sending a message fails, use **测试聊天连接**
with the same selected model and read its error. For a browser access error,
check **CORS compatibility**, which is enabled by default for new providers.
Responses then appear after completion. For LM Studio, enabling CORS in the local
server can let you turn compatibility off and keep word-by-word streaming.

## Agent Chat model access

Agent Chat 使用你在 **代理 → Scribe** 启用的自备模型。模型目录和纯文字聊天测试不能证明工具可用：只有模型确实返回结构化工具调用，并在收到对应工具结果后继续回复，才完成一次工具交互。端点拒绝工具时会保留错误；真实服务的模型访问权限和额度仍需你自己的账号验证。

聊天模型测试会消耗所选供应商的用量。Scribe 不使用外部代理的登录或订阅账户，也不另存一份 Agent 专用密钥。

## Where keys are stored

Scribe stores configured provider API keys in this device's
**Obsidian 钥匙串** rather than the current settings file. The Keychain is
device-specific, so syncing a vault does not copy its credentials to another
computer. Older installations may have separate credential backup files; those
may contain sensitive data and are not deleted automatically.

To remove stored credentials, open **Settings → Scribe → 通用 → 其他 → API Key
Storage** and click **删除所有密钥**.

## Related

- [Getting Started](getting-started.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Models, Effort, and Permissions](models-and-parameters.md)
- [Settings: Models](settings.md#模型)
