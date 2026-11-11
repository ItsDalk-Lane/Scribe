# Testing Guide

How to test Scribe with unit and end-to-end tests. Most changes only
need unit tests; use end-to-end tests when unit tests can't answer the question.

## Test pyramid

| Layer | Command                             | When to use                                                                                                                                                           |
| ----- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit  | `npm run test`                      | Pure logic. Fast. Mocks the Obsidian API. Default for any code change that doesn't touch Obsidian itself.                                                             |
| E2E   | `obsidian` CLI against a real vault | Anything that needs the live React tree, the real Obsidian DOM, or actual settings persistence — UI regressions, settings round-trips, plugin lifecycle, perf checks. |

## Unit tests

- Jest with TypeScript support. `npm run test` runs the unit suite; run a
  single test with `npm test -- -t "test name"`.
- Mock the Obsidian API for plugin testing.
- Test files live adjacent to the implementation (`.test.ts`).
- Use `@testing-library/react` for component testing.
- For how to structure code so it's unit-testable — dependency injection, pure
  leaf modules, the litmus test — see [`STYLE_GUIDE.md`](./STYLE_GUIDE.md).

### Provider transport regression checks

The pi-ai provider and session suites run without user credentials or paid calls:

```bash
npm test -- --runInBand src/LLMProviders src/modelManagement src/hooks/use-streaming-chat-session.test.tsx src/commands/customCommandChatEngine.test.ts
npm run test:mobile-load
```

`localStreaming.integration.test.ts` uses an ephemeral loopback HTTP server without
browser CORS headers through the shared desktop streaming bridge to prove that text arrives before the response ends, Stop closes the native socket,
and accepted partial history is sent on the next turn. These are protocol fixtures,
not running Ollama or LM Studio models. Buffered `requestUrl` tests instead prove
prompt local cancellation and isolation of late results.

The mobile smoke check evaluates the production bundle and exercises first-use
provider requests with Node modules unavailable, including Vertex service-account
signing through WebCrypto. It uses simulated endpoints in a browser-like VM; a
physical iOS/Android device and real provider authentication still need separate
validation. Do not equate the catalog's simulated provider coverage with successful
requests to real accounts.

### Test design workflow

Unit tests are executable specifications. A developer or agent should be able to
read the `describe`/`it` outline and explain what the module does, how its public
operations affect observable state or output, and which constraints it preserves.
A green suite alone does not establish that the intended behavior is covered.

When adding or changing behavior:

1. **Write the behavioral outline first.** Derive cases from the required contract.
   For each affected callable, establish its normal use before adding relevant
   boundary, failure, and regression cases. If an existing suite only covers edge
   cases, add the missing normal behavior. Avoid copying implementation branches
   into tests or inventing cases for unsupported states.
2. **Name the condition and outcome.** Read each `describe` plus `it` as a sentence.
   State what changes or is returned and when. Avoid names such as "works",
   "handles updates", or "publishes once" that leave the behavior unexplained.
   Keep required issue URLs, but make the description understandable without
   opening the issue.
3. **Make the body demonstrate the claim.** Use concrete inputs and meaningful
   fixture names, with clear arrange, act, and assert sections. Keep one behavioral
   scenario per case; multiple assertions may establish that scenario. Assert
   observable results. Call counts are useful when notification or interaction is
   part of the contract, but do not substitute for checking the promised state or
   output. Helpers should remove setup noise while leaving decisive inputs and
   outcomes visible.
4. **Red, green, refactor.** Run the new test before implementing the behavior or
   fix. Confirm it fails because the promised behavior is missing or wrong, not
   because setup, imports, or mocks are broken. Make the smallest production change
   that passes, then improve the code while keeping tests green. When adding
   coverage for behavior that already works, temporarily break that behavior
   locally to verify the test detects it, then restore it. Do not claim a red phase
   that was not observed.
5. **Review the outline and the assertions.** Read the test names without their
   bodies: can a newcomer explain the affected module's contract? Then inspect
   each body: would it fail if the named behavior broke? Fix gaps in coverage or
   assertions; renaming a weak test alone is insufficient.

For example, a `select()` suite should explain selection before deduplication:

- `it("reopens the selected chat with its saved conversation", ...)`
- `it("switches the context source to another chat before notifying subscribers", ...)`
- `it("does not notify subscribers again when the same chat context object is reselected", ...)`

This workflow applies Uncle Bob's guidance that tests should read as specifications
and express intent clearly before making them pass. See
[Robert C. Martin, "Test First"](https://blog.cleancoder.com/uncle-bob/2013/09/23/Test-first.html).

## End-to-end testing (Obsidian CLI)

E2E via the CLI is the slowest and most fragile layer — reach for it only when
unit tests can't answer the question.

A field guide for driving Scribe through the Obsidian desktop CLI. Some
procedures were observed with an earlier plugin build and Obsidian `1.12.7`;
verify the current build, vault, selectors, and behavior before relying on them.
The CLI lives at
`/Applications/Obsidian.app/Contents/MacOS/obsidian` — use the full path; the
`obsidian` shim is not always on `PATH`.

## Get a fresh build into the test vault

**Use a dedicated, disposable test vault.** Before deploying, resetting, or
running the examples below, verify its resolved path and installed plugin ID,
and back up anything you need. Deployment replaces plugin artifacts; a reset
replaces settings; some examples delete files. These operations can also reload
plugins and alter the test vault's trusted-plugin state. Never target a personal
or shared vault.

```bash
npm run test:vault
```

macOS only. Installs deps, builds, and copies `main.js` / `manifest.json` /
`styles.css` from the current worktree into
`$SCRIBE_TEST_VAULT_PATH/.obsidian/plugins/scribe/` for the current manifest,
then attempts to reload the plugin via the Obsidian CLI. The script derives the
plugin directory from `manifest.json`. It requires a folder with a `.obsidian/` directory.

If Obsidian has not registered the folder yet (`obsidian vaults verbose` does
not list it), as with a copied test vault, `test:vault`, `test:reset-data`, and
`gallery:vault` register it the way "Open folder as vault" does, through
Obsidian's undocumented `vault-open` IPC, and then turn off restricted mode in
that vault, the same as clicking "Trust author and enable plugins". Only a
vault the script just registered is trusted this way. Naming a vault on each CLI
call reduces targeting mistakes, but does not distinguish two registered vaults
with the same name; verify the resolved path before any change.

Never open an unregistered folder with an `obsidian://open?path=` URL. Obsidian
answers with a native "Vault not found" dialog, and every CLI call to every
vault hangs until someone dismisses it.

This is the canonical "get my changes running" step — don't hand-roll `npm run
build && cp main.js …`. If the user has multiple Conductor worktrees, whichever
one ran `test:vault` last wins; verify with the preflight in the next section.
The copied manifest carries a development-only version suffix and visible tag
with the commit, clean/dirty state, and bundle hash. A later build in the
worktree does not mutate the deployed plugin; run `test:vault` again to deploy
and reload the new build.

## Reset the test vault's settings

```bash
npm run test:reset-data                 # bundled clean-onboarding fixture
npm run test:reset-data -- <path>       # any data.json you point at
```

Companion to `test:vault`. Overwrites
`$SCRIBE_TEST_VAULT_PATH/.obsidian/plugins/scribe/data.json` for the current
manifest with a fixture, then attempts to reload the plugin. This overwrites the
existing file; JSON validation is not a backup. Verify the target path and make a
secure backup before running it. A running plugin can otherwise write its in-memory
settings over the fixture; check that the reload actually succeeded.

With no argument it uses `scripts/test-fixtures/data.clean-onboarding.json`,
which has no configured providers or models. This resets the settings file only:
it does not clear the device's Obsidian Keychain or guarantee an isolated clean
credential state. Use a separate test vault and synthetic credentials, and check
the resulting state without printing secrets.

### `data.legacy-byok.json` — one-time BYOK migration

`npm run test:reset-data -- scripts/test-fixtures/data.legacy-byok.json` loads a
synthetic pre-versioned fixture with legacy models and provider keys. The reset
has the same overwrite and reload risks described above. Startup may create a
credential backup and request key re-entry; treat that backup as sensitive even
when using a fixture. Do not use or print real credentials.

After loading the fixture in an isolated vault, inspect the migration notice and
non-secret provider, model, and version state. Compare the result with the current
migration and persistence tests rather than assuming old fields, credentials, or
legacy agent settings remain untouched. Repeat the reload to check that migration
does not create duplicates. A fixture result is not evidence of a successful
migration of every historical user configuration.

## 0. Golden rule: pick the right window first

Obsidian is a single Electron app with one renderer per open vault. The CLI
talks to **one** renderer at a time, and by default that renderer is whichever
vault was touched most recently (focus + last CLI target — _not_ stable across
calls). On a developer machine with several vaults open at once this almost
guarantees that "it worked locally" is meaningless.

**Always pass `vault=<name>` on every command.** The flag is global (works on
any subcommand) and binds the call to a specific renderer.

```bash
OBS=/Applications/Obsidian.app/Contents/MacOS/obsidian
VAULT="$(basename "$SCRIBE_TEST_VAULT_PATH")"

$OBS vault=$VAULT vault           # echoes name/path of the targeted vault
```

`VAULT` is only a name derived from the path, not proof of identity. Compare the
reported path with the resolved `SCRIBE_TEST_VAULT_PATH`, and check `vaults
verbose` for duplicate names. If the target is ambiguous or the paths differ,
stop; do not rely on a matching name or the focused window.

### Verification gate before any test run

Run this preflight and inspect its output manually. Abort before any mutation if
it is empty, a field is missing, or anything differs from the intended target:

```bash
$OBS vault=$VAULT eval code='JSON.stringify({
  vault: app.vault.getName(),
  path:  app.vault.adapter.basePath,
  scribeLoaded: !!app.plugins.plugins.scribe,
  scribeVersion: app.plugins.manifests.scribe?.version,
  buildTag: app.plugins.manifests.scribe?.description?.match(/dev build: ([^ |]+)/)?.[1],
  buildBranch: app.plugins.manifests.scribe?.description?.match(/branch: ([^ |]+)/)?.[1]
})'
```

Check that:

- `vault` matches the intended target and `path` resolves to the intended test
  vault, not just a different vault with the same name
- `scribeLoaded` is `true` (`vault=<name>` will _open_ a known-but-closed
  vault as a fresh renderer — silently. If it is `false`, first verify the path,
  then load Scribe in the test vault and repeat the entire preflight.)
- `buildTag` starts with the current worktree's short commit, reports the
  expected clean/dirty state, and stays unchanged until the next deployment
- `buildBranch` matches the worktree branch you actually built from. Multiple
  Conductor workspaces sharing one test vault means whichever ran
  `npm run test:vault` last wins — _verify_, don't assume.

### Failure modes to recognise

| Symptom                                                   | Cause                                                                                                    | Fix                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `Vault not found.`                                        | Typo in `vault=<name>` (case-sensitive, matches the vault name shown in `vaults verbose`)                | Run `$OBS vaults verbose` to list known vaults  |
| Command exits 0 with empty stdout, `eval` returns nothing | The named vault is registered but no renderer is open _yet_ — Obsidian is launching it. Retry after 1–2s | `sleep 2 && retry`, then verify                 |
| Default vault keeps changing between commands             | You omitted `vault=<name>` — focus moved                                                                 | Always pass the flag, never rely on the default |
| Screenshot shows a different vault than expected          | Same — captured the focused renderer, not the targeted one                                               | Re-take with `vault=<name>` explicit            |

## 1. Setup once per session

```bash
$OBS vault=$VAULT dev:debug on  # attach Chrome DevTools Protocol (required for dev:console, dev:errors, dev:cdp)
$OBS vault=$VAULT eval code='app.plugins.loadPlugin("scribe")'  # if not auto-loaded
```

`dev:debug on` is sticky for the life of the Obsidian process. Re-running it is
a no-op, but if Obsidian was restarted you need to run it again before
`dev:console`, `dev:errors`, or `dev:cdp` will return anything useful.

## 2. Driving the plugin

### Run a command

```bash
$OBS vault=$VAULT command id=scribe:agent-chat-open-window
```

The full set of registered command IDs is available via:

```bash
$OBS vault=$VAULT eval code='JSON.stringify(Object.keys(app.commands.commands).filter(c=>c.startsWith("scribe:")))'
```

(Note: top-level `obsidian commands` lists only Obsidian-core commands. Plugin
commands are only visible through `app.commands.commands`.)

### Inspect settings programmatically

Settings live in `data.json` on disk and in a Jotai atom store at runtime. Inspect
only the non-secret fields needed for a test; a raw settings dump can expose
credentials in older fixtures or backups:

```bash
$OBS vault=$VAULT eval code='app.plugins.plugins.scribe.loadData().then(d=>JSON.stringify({defaultModelKey:d.defaultModelKey}))'
```

This reads disk state, not necessarily the state currently shown by an open
settings page. Use the UI when testing a settings change and verify both the
visible result and persistence after a successful reload. Writing `data.json`
directly bypasses the normal in-memory and credential handling paths; a running
plugin can overwrite that change.

## 3. Capturing evidence

### Screenshot — `dev:screenshot`

```bash
$OBS vault=$VAULT dev:screenshot path=/tmp/before.png
```

The file is written asynchronously; the CLI can return before it lands on disk.
Choose a fresh path and wait until the screenshot actually appears before reading
it with the Read tool. Path can be absolute (`/tmp/foo.png`) or vault-relative.

**Always pair the screenshot with a `vault=<name>` flag** — otherwise you may
capture whichever Obsidian window is focused, not the one under test. A useful
sanity check is to crop/inspect the status bar at the bottom which shows the
vault name.

### DOM query — `dev:dom`

Read-only — returns `outerHTML` (default), text, attributes, or computed CSS.

```bash
$OBS vault=$VAULT dev:dom selector='.vertical-tab-nav-item.is-active .vertical-tab-nav-item-title' text
$OBS vault=$VAULT dev:dom selector='.modal.mod-settings input[type="text"]' all
```

For complex inspection (loops, structured data), prefer `eval` with
`document.querySelectorAll` — `dev:dom` output gets verbose fast and the CLI
streams it back synchronously.

### Console & errors

```bash
$OBS vault=$VAULT dev:console limit=30
$OBS vault=$VAULT dev:console level=error limit=20
$OBS vault=$VAULT dev:errors clear   # reset before a scenario
$OBS vault=$VAULT dev:errors         # capture after
```

`dev:errors` only captures **uncaught** errors. Use the test pattern:
clear → run scenario → wait → re-read. Counts above zero mean a regression.

### Performance snapshots

```bash
$OBS vault=$VAULT dev:cdp method=Performance.enable
$OBS vault=$VAULT dev:cdp method=Performance.getMetrics      # JSHeap*, Nodes, JSEventListeners, ScriptDuration, ...
$OBS vault=$VAULT dev:cdp method=Memory.getDOMCounters       # { documents, jsEventListeners, nodes }
$OBS vault=$VAULT eval code='JSON.stringify(performance.memory)'
```

To time an action, first inspect the current settings DOM and identify the
specific control in the verified test vault. Do not reuse selectors from an
older plugin build. Record the action and its completion criterion alongside
the measurements; two animation frames only indicate a paint opportunity.

Diff-pattern for leak detection: snapshot `Memory.getDOMCounters` → repeat the
feature N times → snapshot again. If `nodes` or `jsEventListeners` keeps
climbing past N iterations, the feature is leaking.

## 4. Interacting with the UI (clicks, typing)

There is no first-class "click selector" or "type into input" CLI command.
Two real options:

### 4a. `eval` — synthetic JS events (fast, easy, slightly fake)

Works for ordinary plugin controls after inspecting the current DOM. Use the
control's actual selector and event contract; do not assume a chat composer is an
`input` with a `value` setter. The current composer is an editable rich-text
surface, so assigning an input value does not simulate typing into it. Confirm
focus and the displayed text in the target window before continuing.

### 4b. `dev:cdp` — real browser-level input (slower, faithful)

Use when synthetic events are rejected, when you need `isTrusted=true`, or
when you're verifying that the UI itself behaves correctly (focus, validators,
onChange, modals).

Inspect the current DOM to find the intended element and its coordinates; verify
that the correct vault and window are active. Then use `Input.dispatchMouseEvent`
for a click or `Input.insertText` after focusing the intended editable control.
Do not reuse a selector or coordinate from an earlier build or another window.
Record what was actually entered and observed; these calls alone do not prove a
setting was saved.

## 4c. Popout windows — the second targeting gotcha

Even after `vault=<name>` lands you on the correct renderer, Obsidian supports
**popout windows** (a view detached into its own Electron window). The CLI's
attach point is the main vault renderer only:

- `eval`'s `document` / `window` always refer to the main window.
- `dev:dom` and `dev:cdp Input.*` operate on the main window's document and
  input layer.
- `dev:screenshot` captures the main vault window — popout windows are not in
  the frame.

To reach a popout from the CLI, traverse `app.workspace.floatingSplit`:

```bash
$OBS vault=$VAULT eval code='JSON.stringify({
  popouts: app.workspace.floatingSplit?.children?.length || 0,
  popoutTypes: (app.workspace.floatingSplit?.children || []).map(c=>c.children?.[0]?.children?.[0]?.view?.getViewType?.())
})'
```

To inspect a popout's DOM, use the `.win` / `.doc` properties Obsidian augments
onto the window node, then locate the actual control for the current build. The
chat composer is editable content, not an input whose text is read with `.value`.
Confirm the popout and element identity before driving any interaction.

For UI input into a popout, prefer `eval`-based synthetic events targeted at
`popout.win.document.querySelector(...)`. CDP-level `Input.*` events go to the
main window and won't reach the popout — there's no way around that with the
current CLI surface. **If your test scenario depends on popout interaction,
the cheap fix is to not pop the view out:** drive everything from the main
sidebar leaf.

Related runtime gotcha (in plugin code, not test code): standard `instanceof`
checks fail across realms — a popout window has its own `HTMLElement`,
`MouseEvent`, etc. constructors. Inside `eval`, use
`element.instanceOf(HTMLElement)` / `event.instanceOf(MouseEvent)` if you need
cross-realm type checks.

## 5. Vault data setup

For deterministic test fixtures, prefer creating notes via the CLI rather
than hand-editing the vault. The example includes a permanent deletion: use a
unique disposable note, verify its exact path, and confirm it is not needed
before running the delete command:

```bash
$OBS vault=$VAULT create name="test-note" content="# Hello\n\nbody"
$OBS vault=$VAULT append file="test-note" content="\nmore text"
$OBS vault=$VAULT delete file="test-note" permanent
$OBS vault=$VAULT search query="scribe" format=json limit=10
```

For more aggressive resets, manipulate files directly on disk under the vault
path (from `app.vault.adapter.basePath`) and then call
`$OBS vault=$VAULT reload` to make Obsidian re-scan.

## Component gallery workflow

Use the component gallery whenever a feature adds or changes a user-visible React component or a meaningful visual state. A story is not required for non-visual backend, data, or tooling changes. Gallery verification complements callable-level unit coverage; it does not replace it. See the [bounded review coverage inventory](./GALLERY_REVIEW_COVERAGE.md) for representative settings, open-menu, permission-diff and transition checks, plus remaining gaps.

### Authoring stories

1. Add or update a `*.stories.tsx` file beside the component. The generated gallery index discovers `src/**/*.stories.tsx`; do not edit `dev/gallery/stories.generated.ts`.
2. Import `Meta` and `StoryObj` from `@/lib/story`, declare component metadata with `satisfies Meta<Props>`, and type every named story as `StoryObj<Props>`.
3. Cover the load-bearing states a user can actually see: default, empty, loading, success, error, disabled, overflow-prone content, or other states introduced by the feature. Use realistic copy and fixture props rather than production stores or runtime singletons.
4. Prefer `args` for ordinary prop states and `render` for compositions. Hook-backed render functions are supported. Keep fixtures deterministic and actions inert unless interaction is the behavior under test.
5. Choose `parameters.gallery.host` (`leaf`, `modal`, `popover`, or `settings-tab`) and `layout` (`padded`, `centered`, or `fullscreen`) to match the real component boundary. Use `coverage: false` only for an intentional presentational-component opt-out. Stories cannot pin a canvas width — width is view state owned by the gallery's width toolbar, so check a component at other widths with that toolbar or sweep them all via `audit()`. Never add a story whose only difference from a sibling is the width you wish it rendered at; it will render identically.
6. If a component cannot render without plugin state, extract or expose a presentational boundary that accepts the required data as props; do not widen the Gallery import fence to reach settings, stores, or runtime singletons.

A minimal adjacent story looks like this:

```tsx
import type { Meta, StoryObj } from "@/lib/story";
import { StatusCard, type StatusCardProps } from "./StatusCard";

const meta = {
  title: "Feature/Status Card",
  component: StatusCard,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<StatusCardProps>;
export default meta;

export const Error: StoryObj<StatusCardProps> = {
  args: { message: "The operation could not be completed.", tone: "error" },
};
```

Before live verification, run the focused unit tests for the changed component and story contract, then build the development plugin:

```bash
npm run gallery:build
```

Deploy to the non-production test vault configured by `SCRIBE_TEST_VAULT_PATH` with `npm run gallery:vault`. Before any CLI or UI mutation, verify that the resolved vault name and path match that configuration; never rely on the implicitly focused renderer.

### The gallery shares a stylesheet with the plugin

The gallery's stylesheet is built by concatenating `src/styles/tailwind.css` into its own source, so it carries a near-complete copy of the production stylesheet — and Obsidian injects every enabled plugin's `styles.css` document-wide. Both copies land in the same cascade at equal specificity, so a gallery copy built from an older `src/styles/tailwind.css` outranks the deployed production rules and the plugin's own views render pre-change behavior.

`npm run test:vault` keeps the two in step: whenever the vault has a gallery plugin installed, it rebuilds the gallery from the worktree being deployed and relinks it there, then reloads it. `gallery:vault` symlinks its whole source directory, so this also repairs a link left dangling by a deleted worktree; if the vault has no gallery plugin, the step is skipped.

If a CSS change appears to have no effect, check for the same selector twice in the inspector before suspecting the change itself.

The story tree keeps its top-level categories open. Select a category label to show its contact sheet. For nested categories, the label also folds or unfolds the subtree; use the adjacent chevron when you want to toggle it without changing the selected contact sheet. Selecting a different story or contact sheet does not close branches you already opened.

### Agent verification loop

When the development-only component gallery plugin is loaded, its typed
`window.__gallery` handle can select and audit stories without screenshots.
Short async calls can set both `awaitPromise` and `returnByValue`. For a full
audit, store the eventual result in the page and poll it: the Obsidian CLI can
return before a long-running CDP promise settles even when `awaitPromise` is
set.

```bash
# Discover exact story ids.
$OBS vault=$VAULT dev:cdp method=Runtime.evaluate params='{"expression":"window.__gallery.list()","returnByValue":true}'

# Render one story and wait until its effects and layout have settled.
$OBS vault=$VAULT dev:cdp method=Runtime.evaluate params='{"expression":"window.__gallery.show(\"UI/Button/Variants\",{width:300}).then(()=>true)","awaitPromise":true,"returnByValue":true}'

# Address the mounted case by its stable identity and requested width.
$OBS vault=$VAULT dev:dom selector='[data-story="UI/Button/Variants"][data-story-width="300"]' all

# Start an exact width sweep without relying on the CLI connection to await it.
$OBS vault=$VAULT dev:cdp method=Runtime.evaluate params='{"expression":"window.__galleryRun={status:\"pending\"};window.__gallery.audit({widths:[300,340,400,600]}).then(value=>{window.__galleryRun={status:\"fulfilled\",value}},reason=>{window.__galleryRun={status:\"rejected\",reason:String(reason?.stack??reason)}});true","returnByValue":true}'

# Repeat until status is fulfilled or rejected. A fulfilled value has one AuditReport per width.
$OBS vault=$VAULT dev:cdp method=Runtime.evaluate params='{"expression":"window.__galleryRun","returnByValue":true}'
```

`audit()` returns an array shaped as
`[{theme,width,findings:[{story,check,detail}]}]`. Requested widths may be any
positive finite pixel values; the four values above match the gallery's visible
buttons. Theme is intentionally read-only through this handle: switch the
Obsidian appearance setting, then run the same array sweep again. A complete
automated pass ends by checking uncaught errors separately:

```bash
$OBS vault=$VAULT dev:errors clear
# Run the store-and-poll sweep above and wait for a fulfilled or rejected status.
$OBS vault=$VAULT dev:errors
```

## 6. Typical e2e flow

A minimal smoke-test scaffold. Run and inspect the full preflight from the
verification gate above first; it does not automatically stop on a mismatched
path, unloaded plugin, or wrong build. Continue only after all fields match:

```bash
OBS=/Applications/Obsidian.app/Contents/MacOS/obsidian
VAULT="$(basename "$SCRIBE_TEST_VAULT_PATH")"

# 1. Attach debugger, clear error buffer
$OBS vault=$VAULT dev:debug on
$OBS vault=$VAULT dev:errors clear

# 2. Baseline screenshot + metrics
$OBS vault=$VAULT dev:screenshot path=/tmp/test-before.png
$OBS vault=$VAULT dev:cdp method=Memory.getDOMCounters > /tmp/dom-before.json

# 3. Open the chat, inspect the current DOM, and verify its editable control
$OBS vault=$VAULT command id=scribe:agent-chat-open-window
# Only after verifying the target control and focus, exercise the scenario.
# Record the selector, input, completion signal, and result actually observed.

# 4. Capture evidence after the scenario has completed
$OBS vault=$VAULT dev:screenshot path=/tmp/test-after.png
$OBS vault=$VAULT dev:cdp method=Memory.getDOMCounters > /tmp/dom-after.json
$OBS vault=$VAULT dev:console level=error limit=20 > /tmp/console-errors.txt
$OBS vault=$VAULT dev:errors > /tmp/uncaught.txt

# 5. Assert: errors empty, screenshots look right, node counts not blown up
```

## 7. Quick reference

| Need                               | Command                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| List open vaults                   | `vaults verbose`                                                                                                 |
| Target a vault                     | prefix every command with `vault=<name>`                                                                         |
| Verify the right vault is targeted | Check both the name and resolved path using the full preflight above                                             |
| Visual confirmation                | `vault=<name> dev:screenshot path=/tmp/x.png` (wait for the file to appear)                                      |
| Load plugin if not loaded          | `vault=<name> eval code='app.plugins.loadPlugin("scribe")'`                                                      |
| List plugin commands               | `vault=<name> eval code='JSON.stringify(Object.keys(app.commands.commands).filter(c=>c.startsWith("scribe:")))'` |
| Run a plugin command               | `vault=<name> command id=scribe:<id>`                                                                            |
| Inspect a non-secret setting       | `vault=<name> eval code='app.plugins.plugins.scribe.loadData().then(d=>d.defaultModelKey)'`                      |
| Click via JS                       | `vault=<name> eval code='document.querySelector("...").click()'`                                                 |
| Click via CDP                      | `dev:cdp method=Input.dispatchMouseEvent params='{"type":"mousePressed",...}'`                                   |
| Type via CDP                       | `dev:cdp method=Input.insertText params='{"text":"..."}'`                                                        |
| Uncaught errors                    | `dev:errors` (clear + run + read)                                                                                |
| Console messages                   | `dev:console level=error limit=20`                                                                               |
| DOM scale                          | `dev:cdp method=Memory.getDOMCounters`                                                                           |
| Heap                               | `eval code='JSON.stringify(performance.memory)'`                                                                 |
| Full perf metrics                  | `dev:cdp method=Performance.getMetrics` (after `Performance.enable`)                                             |

## 聊天渲染管线固定工作负载

`Markdown/StressWorkbench` 组件预览提供相同的短回答、长段落、超长代码、多图表、多轮历史和并行正文输入。只使用合成文本，不发送模型请求。对照构建应使用同一故事与逐帧输入，在同一专用测试资料库、窗口宽度和主题下运行。分别记录宿主调用数、累计输入字符、最大在途工作、渲染耗时与主线程长任务；不要把这些指标混同为模型速度。检查终态原文与输入一致、链接来源、图表源码回退、选区、历史阅读锚点与卸载清理。

基线采用改造前提交，候选采用当前工作树；不得直接从候选的调用次数推算基线。保存结果时只记录合成数据与聚合指标。真实宿主后处理无法强制中断，排版失败或超预算的完整原文降级属于预期行为。
