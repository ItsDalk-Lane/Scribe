# Model Management — layer rules

The chat-model data model: providers, configured models, per-backend
model selection, and the transient catalog types used during setup.

## Architecture in one paragraph

`models.dev` supplies catalog information during setup. Providers hold
connection details, while configured models retain their selected model
information, including manually entered IDs. The `chat` and `native`
backend configurations select which configured models are available to
quick tools and the in-process agent respectively. The `agent` provider
origin is a persisted type; it does not provide a second active agent
backend. The model-and-provider settings show providers with
`origin.kind === "byok"`, and the chat-model factory selects the provider
protocol from the configured provider.
