# Model Sources and BYOK

Scribe V4 can get models from your own provider key or local endpoint, or an agent account you already use. These options are separate.
Adding a key does not change the models supplied by Claude Code.

Settings show where each source sends your requests. Hover the small icon next to a provider name: a desktop for a server on this computer or your local network, and a cloud for any other service. The Claude tab in Agent settings shows the same icon next to the agent name, for example "Amazon Bedrock" when your Claude Code settings turn on Bedrock.

## Choose a model source

| Model source                        | Quick tools | Agent Chat |
| ----------------------------------- | ----------- | ---------- |
| **Your API key or endpoint (BYOK)** | Yes         | No         |
| **Claude Code account**             | No          | Claude     |

## Bring your own key (BYOK)

BYOK lets you connect Scribe directly to an AI provider, a compatible gateway,
or a model server on your computer. For cloud providers, usage and billing stay
with that provider.

1. Open **Settings → Scribe → 模型**.
2. Click **Add a provider**.
3. Choose a provider, **Ollama**, **LM Studio**, or **Add a custom provider**.
4. Enter the credential, **Base URL**, and any provider-specific fields, such
   as the account, project, or gateway ID. Keep JSON credentials in the credential
   field; public fields do not store a separate copy of your secret.
5. Use **Fetch models** to read the provider's model directory, or choose from
   the catalog and enter an exact model ID yourself. A directory error does not
   prevent you from saving a valid configuration with a model selected.
6. Select a chat model and click **Test chat connection** if you want to check
   that it can answer. When several chat models are selected, choose the model
   to test. This sends one short message and may use the provider's quota.
7. Click **Save**. Opening or saving the form never sends a chat test.

**Fetch models** only reads a directory. It does not prove permission to use a
model. **Test chat connection** uses the current, unsaved key, address, parameters,
and selected model through the same connection as Quick tools. Only an actual
text reply shows **Chat connection verified**. Changing those inputs clears the
old chat result; a late result from an earlier check cannot verify the new inputs.

Each time you open **模型**, Scribe also checks your configured providers' directory
or key endpoint. The small “Verifying providers…” indicator reports these checks.
**Endpoint accessible** means that endpoint returned the expected data, not that
chat has been tested. **No key** or **Invalid key** indicates a missing or rejected
credential. **Access restricted** can mean the account lacks permission; read the
provider's original reason before replacing a key. **Not verified** means the
check address was not found. **Unexpected response** can mean an address returned
a login page or other content instead of API data. Your saved configuration is
kept, and you can still choose a catalog model or enter its ID manually.

The provider list changes with the live catalog. The current validation covers a
snapshot of **232 visible providers using simulated local requests**. It checks
how saved settings are used to build requests; it is **not a successful test of
232 real provider accounts**. A real account still needs the right credential,
model access, available quota, and a reachable service. Use **Test chat connection**
with your selected model to check those conditions yourself.

Public connection parameters are saved with the provider. Existing custom
addresses and extra settings are retained. URL placeholders are filled only when
a request is made; the original template is kept. New providers enable **CORS
compatibility** by default. Existing explicit choices are retained. With this
setting enabled, replies normally appear after completion instead of word by word.

New chat models are enabled for Quick tools by default. Image, speech, embedding, and reranking models remain saved but are marked separately and are not offered as chat choices.

**快捷操作 → 工具配置** controls **Quick tools models** and its **Default quick command model**, shared by Quick Ask and commands.

### OpenCode and OpenCode Go

The catalog keeps each model's correct OpenAI, Anthropic, or Gemini address. Use
your OpenCode personal API key or service account key. A directory check does not
confirm access to every model: the account's plan, model permissions, and privacy
settings can still restrict a chat request.

For Go's OpenAI-compatible models, keep the chat **Base URL** as
`https://opencode.ai/inference/go/openai/v1`. **Fetch models** reads the separate
`https://opencode.ai/inference/go/v1/models` address. **Test chat connection** sends
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
service or proxy, choose **Add a custom provider** and enter its base URL and
model ID. The API key is optional; add one when the endpoint requires
authentication. Model discovery uses the endpoint's `/v1/models` response, but
you can always enter an exact model ID before searching the discovered list.

If a directory loads but sending a message fails, use **Test chat connection**
with the same selected model and read its error. For a browser access error,
check **CORS compatibility**, which is enabled by default for new providers.
Responses then appear after completion. For LM Studio, enabling CORS in the local
server can let you turn compatibility off and keep word-by-word streaming.

## Claude Code account

Claude is the Agent Chat backend and uses its own account:

- **Claude** inherits authentication and models from the Claude Code CLI. Its
  usage follows your Claude Code account or CLI environment.

Scribe discovers the models reported by Claude Code and lets you enable them under **代理 → Claude Code**. Those models stay inside Agent Chat; they do not become Quick tools models.

An OpenAI API key is different from a ChatGPT subscription, just as an
Anthropic API key is different from a Claude Code subscription. Use **模型** for Quick tools API access and the Claude setup for Claude Code account access.

## Where keys are stored

Scribe stores provider API keys in this device's
**Obsidian Keychain**, not in the vault's `data.json`. The Keychain is
device-specific, so syncing a vault does not copy its credentials to another
computer.

To remove stored credentials, open **Settings → Scribe → 通用 → 其他 → API Key
Storage** and click **Delete All Keys**.

## Related

- [Getting Started](getting-started.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Models, Effort, and Permissions](models-and-parameters.md)
- [Settings: Models](settings.md#models)
