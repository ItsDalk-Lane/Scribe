# Agent Mode — layer rules

The import boundaries in `eslint.config.mjs` separate the session contract,
plugin process runtime, native configuration, UI, and skills.

- `session/` owns backend-neutral messages, events, approvals, plans, tasks,
  persistence, and the UI adapter. It must not import a concrete backend.
- `sdk/` contains the in-process Pi Agent runtime, Scribe tools, real desktop
  commands, and native transcript storage. Pi drives the execution loop;
  no external Agent executable or local Agent proxy is used.
- `backends/native/` wires configured models and providers, credentials,
  project instructions, extensions, and Agent settings to that runtime.
- `backends/registry.ts` registers only the native Scribe backend.
- `ui/` consumes session-domain data and preserves the established chat
  components. Tool classification maps native product names to existing cards.
- `skills/` manages canonical skills and native project links.
- `index.ts` wires plugin lifecycle resources and is the plugin host entry.

Read the root guidance and the matching internal guide before changing a
layer. Import restrictions are architectural: fix ownership or pass data
through the contract instead of adding a per-file exemption.

Native chats use a separate backend ID and native UUID. Restoring history
must not rerun tools or reuse permission decisions as new authorizations.
Old external Agent sessions, plugins, login state, and machine configuration
are not imported or deleted.

Use native Obsidian modals, pass the app explicitly or obtain it with the
existing React hook, and follow the popout rules in `PLUGIN_DEV_GUIDE.md`.
