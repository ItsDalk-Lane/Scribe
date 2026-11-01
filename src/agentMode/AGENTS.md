# Agent Mode — layer rules

Six element types, strict imports. Enforced by `eslint-plugin-boundaries`
(see root `eslint.config.mjs`). The list below mirrors `boundaries/elements` and
`boundaries/dependencies` exactly — when in doubt, the lint config wins.

1. **`session/`** — **the contract layer.** Hosts the
   backend-agnostic session, message store, UI-state bridge,
   persistence manager.
2. **`sdk/`** — the Claude Agent SDK driver. Implements `BackendProcess`
   directly and emits session-domain events.
3. **`backends/<id>/`** — backend-specific setup and configuration. The only
   supported agent is `backends/claude/`; its `BackendDescriptor` constructs
   the SDK process.
4. **`backends/registry.ts`** — the registry and default selection for Claude.
5. **`ui/`** — React UI. Permission modals, model pickers, and trail rendering
   read session-domain types.
6. **`skills/`** — canonical-store discovery, symlink lifecycle, reconciliation,
   and the Skills settings UI.

## Claude SDK and the session contract

The contract lives in `session/types.ts` (`BackendProcess`,
`BackendDescriptor`, the full session-domain type set) and
`session/errors.ts` (`MethodUnsupportedError`).
`sdk/ClaudeSdkBackendProcess` wraps the Claude Agent SDK's async generator
and emits `SessionEvent` and `BackendState` values. `AgentSession` consumes
that contract without importing the SDK implementation. The registry only
registers Claude; unsupported saved agent selections fall back to Claude.

## Changing Claude support

1. Keep installation, authentication, model selection, and agent-specific UI
   in `backends/claude/`.
2. Keep SDK translation and process lifecycle in `sdk/`.
3. Store agent configuration under `agentMode.backends.claude` in
   `src/settings/model.ts`.
4. If the shared UI needs more information from Claude, extend the
   `BackendDescriptor` contract rather than importing the backend directly.

## Adding a new layer

1. Create `src/agentMode/<layer>/`.
2. Add an entry under `boundaries/elements` in root `eslint.config.mjs` and a
   corresponding rule in `boundaries/dependencies`.
3. Re-export from `src/agentMode/index.ts` if it should be visible to
   plugin host code.
4. Update this doc.

## What lives where (cheatsheet)

- "Backend-agnostic contract — `BackendProcess`, `BackendDescriptor`,
  the session-domain types, `MethodUnsupportedError`, debug sink,
  `translateBackendState` helper" → `session/`
- "In-process driver for an SDK that produces session-domain events
  natively" → `sdk/`
- "Shared agent setup and configuration helpers" → `backends/shared/`
- "Knows about a specific binary, install path, BYOK keys, vendor models" → `backends/<id>/`
- "React component or modal" → `ui/` (generic) or `backends/<id>/`
  (backend-specific)
- "Canonical-store skill discovery, symlink lifecycle, SKILL.md
  parser/serializer, Skills settings tab (reads `backends/registry.ts`
  for the brand list)" → `skills/`
- "Plugin-level wiring" → `index.ts` only

## Modals and dialogs

**Use Obsidian's native `Modal`** (from `obsidian`). It gives us correct
popout-window behavior, native header chrome, ESC handling, and visual
consistency with the rest of the plugin.

The standard pattern is in `src/components/modals/ConfirmModal.tsx` and
`src/agentMode/skills/ui/DeleteConfirmDialog.tsx`. If a surface must live
inside an existing React tree, keep its visual content as a presentational
component and host it from an Obsidian modal instead of introducing a second
modal system.

## BackendDescriptor surface

The descriptor is the contract `session/`, `sdk/`, and `ui/` rely on.

If a UI component needs something the descriptor doesn't expose, **add
it to the descriptor** — don't reach into a specific backend. The
descriptor will keep growing; that's by design.

## Debugging tips

### Inspect full Agent Mode frames

The default debug log truncates each frame's payload to 400 chars. For
diagnostic frame logs with larger payload summaries, turn on
**Settings → Advanced → Debugging & support → Agent activity log**.

When enabled, every parsed frame is appended as one NDJSON line outside the
vault, under the OS temp directory:

```text
<tmp>/obsidian-copilot/acp-frames/<vault-hash>/acp-frames.ndjson
```

Each line is a `FrameRecord` (`src/agentMode/session/debugSink.ts`):

```ts
{ ts, dir: "→" | "←", tag, kind: "request" | "notif" | "result" | "error" | "raw",
  method, id, payload }
```

`dir` is from the plugin's perspective: `→` = sent to the agent,
`←` = received from the agent. The Claude SDK adapter
(`sdk/sdkDebugTap`) writes frames with the `claude-sdk` tag. The existing
`acp-frames` file name is retained for saved log compatibility.

Useful queries:

```bash
LOG="<path shown in Settings → Advanced → Agent activity log>"

# count frames by method
jq -r .method "$LOG" | sort | uniq -c | sort -rn

# inspect every session/update payload
jq -c 'select(.method=="session/update") | .payload' "$LOG"

# only frames for one backend
jq -c 'select(.tag=="claude-sdk")' "$LOG"
```

The file is append-only and bounded. Oversized individual frames are replaced
with a `__truncated` summary, and at 50 MB the file rotates to
`acp-frames.old.ndjson` (overwriting any prior `.old`) in the same temp
folder. Use the **Open** / **Clear** buttons in the same settings section, or
delete the files directly. Disable the toggle when not actively debugging.
