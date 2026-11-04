# AGENTS.md

This file provides guidance to any coding agent when working with code in this repository.

## Overview

Scribe is an AI-powered assistant plugin that integrates various LLM providers (OpenAI, Anthropic, Google, etc.) and the Claude Code agent with Obsidian. It provides chat interfaces and various AI-powered commands for note-taking and knowledge management.

This repository (Scribe) is a fork of [Obsidian Copilot](https://github.com/logancyang/obsidian-copilot), forked from upstream v4.0.17. It tracks upstream releases and selectively syncs the updates this project can use. The currently followed upstream version is recorded in the README's "Upstream project" section — update that record whenever a sync lands. Scribe's own version numbering is independent of upstream and starts at 1.0.0.

## Commands

- **NEVER RUN `npm run dev`**.
- `npm run build` — production build (TypeScript check + minified output).
- `npm run lint` / `npm run lint:fix` — ESLint check / autofix.
- `npm run format` / `npm run format:check` — Prettier write / check.
- **Before PR: always run `npm run format && npm run lint`.**
- `npm run test` — unit tests. Single test: `npm test -- -t "test name"`.
- `npm run test:vault` — macOS-only build-and-deploy into `$SCRIBE_TEST_VAULT_PATH`; see [`TESTING_GUIDE.md`](./internal-docs/TESTING_GUIDE.md).

## Core principles (apply to every change)

- **Always write generalizable solutions.** No hardcoded folder names, file patterns, or special-case logic (no "piano notes" / "daily notes" branches). Make varying behavior configurable, not hardcoded.
- **Never modify AI prompt content** — system prompts, model adapter prompts, etc. — unless the user explicitly asks.
- **Never edit `RELEASES.md` outside a release PR.** If a rebase conflicts in `RELEASES.md`, resolve it to the base branch's version.
- **Use stories for user-visible React work.** When a feature adds or changes a component or a meaningful visual state, add or update its adjacent `*.stories.tsx` file and verify the rendered states in the component gallery. Stories complement unit tests; non-visual changes do not require one. Follow the [`Component gallery workflow`](./internal-docs/TESTING_GUIDE.md#component-gallery-workflow).
- **Referential stability.** Never return a freshly-allocated `[]` / `{}` for an "empty" slice; return a frozen module-level constant (canonical examples: `EMPTY_PROVIDERS` / `EMPTY_CONFIGURED_MODELS` / `EMPTY_BACKENDS` in `src/settings/model.ts`).
- **Structure unit tests by module, class, and callable.** Use exactly one top-level `describe("moduleName", ...)` for the module under test; do not split the same subject across multiple top-level `describe` blocks. Within that module suite, wrap each class's tests in exactly one `describe("ClassName", ...)` so method ownership remains visible, then give each method exactly one nested `describe("methodName()", ...)` group. Keep module-level functions directly under the module suite, with exactly one `describe("functionName()", ...)` group per function. Merge cases that exercise the same callable. Separate same-callable groups only when a material test-lifecycle constraint makes merging misleading, and name that constraint in the groups' `describe` titles. Write `it(...)` descriptions that state the observable behavior without requiring the reader to inspect the test body.
- **Write unit tests as executable specifications.** A developer or agent reading the `describe`/`it` outline should understand the module's purpose and observable contract without opening its implementation. Establish normal behavior before boundary, failure, and regression cases; name each case by its condition and expected outcome. Use concrete fixtures and assert the promised result, not just internal calls. For behavior changes, verify the test fails for the intended reason before making it pass, then refactor with tests green. → [`Test design workflow`](./internal-docs/TESTING_GUIDE.md#test-design-workflow)
- **Preserve provenance for new behavioral branches and edge cases.** When a change adds a conditional branch or explicit edge-case path, include the originating GitHub issue's full URL in both the nearby code comment that explains why the path exists and the `it(...)` description that covers it. If no issue exists, create one before landing the behavior. Explain the user or reliability failure that justified the path, not its mechanics.
- **Pair every production TypeScript function and method with unit coverage.** Directly test exported and public callables; cover private and module-local helpers through their observable public contract unless direct isolation materially improves clarity. Test-only helper functions are exempt.
- **Never wait for async work by ticks or timers.** No `setTimeout(…, 0)`, `queueMicrotask`, or `await Promise.resolve()` to "let pending work land". Await the work itself, handle events where their order is defined, or signal completion explicitly. → [`Async ordering`](./internal-docs/STYLE_GUIDE.md#async-ordering)
- **Never call `console` directly** — use `logInfo()` / `logWarn()` / `logError()` from `@/logger`.
- **Every JavaScript/TypeScript comment links a GitHub issue.** A comment may only record a tricky decision tied to a specific issue: the one-line why plus the issue's full URL (`https://github.com/OWNER/REPO/issues/N`). Everything else, including JSDoc, section banners, restated logic, and issue-less TODOs, is expressed through names, types, and tests. If a decision needs explaining and no issue exists, file one. When you change code under an issue-linked comment, re-check the comment against its issue and update or delete it. Existing comments were cleared during the Scribe naming reset; this rule applies to comments written from that point on. `scribe/issue-linked-comments` enforces this in `npm run lint`; tool directives (`eslint-disable`, `@ts-expect-error`, `prettier-ignore`, …) are exempt. → [`STYLE_GUIDE.md`](./internal-docs/STYLE_GUIDE.md)
- **Keep React styling in Tailwind.** Put static styles on React-owned elements with Tailwind utilities, and reuse a shared component when the same visual pattern appears more than once. Do not add one-off selector families such as `.feature`, `.feature-copy`, and `.feature-actions` to `src/styles/tailwind.css` just to move utility declarations out of JSX. Add custom CSS only for markup React does not own or a styling contract Tailwind cannot express, and document that constraint beside the rule. Never edit `styles.css` (generated), use inline `style` for static values, or add arbitrary font sizes; wrap composed class strings in `cn()`. → [`STYLE_GUIDE.md`](./internal-docs/STYLE_GUIDE.md)
- **TypeScript:** `@/` absolute imports; `interface` for shapes, `type` for unions. **React:** custom hooks, props interfaces above components. → [`STYLE_GUIDE.md`](./internal-docs/STYLE_GUIDE.md)
- **Never use the global `app`** (footgun in popouts, hides dependencies); thread it via `useApp()` or a parameter. → [`PLUGIN_DEV_GUIDE.md`](./internal-docs/PLUGIN_DEV_GUIDE.md)

## Task-specific guides

Read the matching guide when your task touches that area — they aren't loaded by default.

| When you're…                                                          | Read                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| writing or altering tests, or doing E2E via the Obsidian CLI          | [`internal-docs/TESTING_GUIDE.md`](./internal-docs/TESTING_GUIDE.md)                         |
| building or changing user-visible React components or visual states   | [`Component gallery workflow`](./internal-docs/TESTING_GUIDE.md#component-gallery-workflow)  |
| writing code: DI/structure, TypeScript, React, comments, CSS/Tailwind | [`internal-docs/STYLE_GUIDE.md`](./internal-docs/STYLE_GUIDE.md)                             |
| touching plugin runtime: the `app`, network requests, popout windows  | [`internal-docs/PLUGIN_DEV_GUIDE.md`](./internal-docs/PLUGIN_DEV_GUIDE.md)                   |
| running a multi-step dev session                                      | [`internal-docs/PROCESS_GUIDE.md`](./internal-docs/PROCESS_GUIDE.md)                         |
| changing user-facing behavior                                         | [`internal-docs/DOCS_GUIDE.md`](./internal-docs/DOCS_GUIDE.md)                               |
| reviewing code or preparing an Obsidian submission                    | [`internal-docs/OBSIDIAN_COMMUNITY_REVIEW.md`](./internal-docs/OBSIDIAN_COMMUNITY_REVIEW.md) |

## Important notes

- The plugin supports multiple LLM providers with custom endpoints.
- Settings are versioned — migrations may be needed.
- Local model support via Ollama / LM Studio.
- Rate limiting is implemented for all API calls.
- Message & chat architecture: Repository → Manager → UIState → UI; single `MessageRepository`; per-project isolation.
- Current session plan → [`TODO.md`](./TODO.md).
- Available Tailwind tokens/classes → [`tailwind.config.js`](./tailwind.config.js).

## Obsidian review guidelines

When reviewing code or preparing a PR that changes plugin source, CSS, package metadata, or dependencies, run `npm run review:obsidian` and inspect its warning output. Obsidian review errors are blockers. Fix warnings only when runtime, UI, and persisted behavior remain equivalent; leave risky warnings visible and nonblocking.

Review changed lines for desktop-only Node imports, `fetch` outside justified streaming adapters, async callbacks passed to void-returning APIs, global `app` access, console use, deprecated APIs, runtime dependency replacements, native DOM creation instead of Obsidian helpers, external CSS URLs, `!important`, and `:has()`. Never suppress, ignore, or downgrade a review rule just to make the gate green.

If the authenticated community review finds something the local gate missed, first check the pinned official Obsidian lint packages, then add a regression fixture outside source roots. See [`internal-docs/OBSIDIAN_COMMUNITY_REVIEW.md`](./internal-docs/OBSIDIAN_COMMUNITY_REVIEW.md) for the parity and risk policy.

<!-- brevilabs-review-guidelines:start (synced from Brevilabs/brevilabs-skills — edit there, not here) -->

## Review guidelines

Apply these in addition to the built-in review. Report only problems
introduced or exposed by this pull request, and describe the concrete failure
scenario for each finding rather than giving general advice.

Priorities, in order:

1. **Correctness** — logic errors, data loss, unhandled failure paths,
   concurrency hazards.
2. **Security** — authorization bypass, injection, secrets or private data
   leaving the codebase.
3. **Breaking changes and migrations** — changed function signatures, renamed
   or removed exports, altered return shapes, changed defaults, tightened
   validation; persisted schemas, settings files, and serialized formats that
   already-written data must still load. A change that needs a migration and
   ships without one is a defect. When a migration exists, check that it
   handles already-in-the-wild states, not just the happy path.
4. **Code budget** — added lines are spend, not progress. A change that
   solves the problem in fewer concepts beats one that solves it in more; the
   best diff is the smallest one that does the job.
5. **Tests** — changed behavior, failure paths, and boundary cases are
   covered, and tests assert behavior rather than implementation detail.

Severity calibration:

- Treat as P1: an unhandled breaking change to a public API, plugin interface,
  CLI flag, or wire format; a change requiring a migration that ships without
  one; a data-corrupting or destructive operation; an authorization bypass; a
  reproducible crash.
- Also treat as P1: a diff carrying substantial code the problem does not
  require — a speculative abstraction with a single caller, configurability
  nothing asks for, premature optimization without a measurement showing the
  need, defensive branches guarding states that cannot occur, or a
  reimplementation of a helper that already exists in the codebase. Rank
  smaller instances of the same problems P2/P3 rather than dropping them. An
  over-engineering finding must name the simpler shape that solves the same
  problem; a bare "consider simplifying" is not a finding.
- Never report naming, formatting, or style that automated checks enforce, at
  any priority.

Code-budget checks:

- Prefer fixes that remove code; say so when a net-negative diff is available.
- Flag dead code the change itself creates — superseded branches, obsolete
  fallbacks, stale tests — deletion belongs in the same PR.
- Do not suggest broad refactors of pre-existing code unless required to fix
  a reported defect; the budget applies to what this PR adds, not to what was
  already there.

## Responding to review comments

Reply with the endpoint that publishes immediately, where `ROOT_COMMENT_ID` is
the thread's top-level comment:

```bash
gh api -X POST repos/OWNER/REPO/pulls/PR/comments/ROOT_COMMENT_ID/replies -f body="..."
```

Never open a review draft: `POST /pulls/PR/reviews` without an `event` (and the
UI's "Start a review") leaves the reply _pending_, which means invisible — it
never reaches the reviewer, it is absent from the comments API, and its thread
still reads as unanswered. Before finishing, confirm none exists:

```bash
gh api repos/OWNER/REPO/pulls/PR/reviews --jq '[.[]|select(.state=="PENDING")]|length'   # must be 0
```

<!-- brevilabs-review-guidelines:end -->

<!-- aoci:begin -->

## AOCI Repository Cognition

AOCI maintains a stable, versioned, incrementally updatable repository-level cognition layer so models can reuse their understanding of this system across tasks.

`aoci.txt` is a structured cognition index for models. It assigns one independent Entry to every managed file, database table, or other managed object. Symbolic tags and F/R/A/S semantics describe the object's core responsibility, important relationships, external contracts, and non-obvious constraints or design decisions needed to understand or modify the system.

The Header, directory sections, and all Entries form the complete repository index. They can cover frontend, backend, configuration, database structures, and other managed content. When managed content changes, normally only the affected cognition Entries need maintenance; the complete index does not need to be regenerated.

AOCI provides a high-density view of system architecture, object responsibilities, important relationships, external contracts, and key constraints.

### How it works

AOCI uses a model-generated, model-read cognition loop.

Header, Entry, and Curation semantics follow only the current machine-issued Plan and live Guide. The Host model independently authors them from the current bound evidence.

Entry semantics must come from the model's understanding of actual evidence. Never derive, prefill, assemble, or rewrite index semantics solely from paths, filenames, extensions, an AST, symbol lists, dependency scans, regular expressions, fixed templates, or rule engines.

For a Fresh Bootstrap, follow only the current machine-issued Plan and live Guide. When they require authoring, the Host model authors Root, Meta, tags, and F/R/A/S, supplies its authoring-run declaration, and binds it to the Plan, Evidence, and complete Candidate. Never ask AOCI to set `origin=host_model`, manufacture a receipt, or turn a generated framework into semantics. Do not reconstruct the Onboarding progression here. Internal batches are not user decisions; stop only at an existing approval boundary or a real safety, drift, CAS, or Recovery condition.

### Minimal entry points

- `aoci_rules`: obtain the session-level runtime contract for the current AOCI version.
- `aoci_overview`: establish or restore complete cognition for this repository.
- `aoci_maintain`: after managed objects reach their final stable state, check whether cognition needs maintenance.
- `aoci_update_entry`: submit a complete semantic update batch bound to current evidence and source digests.
- `aoci_report`: when the current layout and tool state support it, record follow-up work if evidence is insufficient to generate semantics reliably; do not guess.

For other MCP tools, CLI commands, parameters, and specialized workflows, follow current tool descriptions, Guide, and `--help` output. This file does not duplicate the full manual.

This managed block defines only repository integration, cognition use, and task-closing principles. `aoci_rules` carries the current session contract. Live Guide output carries the execution order and stop conditions of the current Plan. Tool Schema, Spec, and Validator carry machine structures and criteria. Prompt, Description, README, and static documentation cannot override those machine facts.

### Establishing, generating, and restoring cognition

1. At the beginning of every new Agent Run, first determine:
   - whether this repository already has a usable complete AOCI index; and
   - whether current context already contains complete repository cognition that matches this repository root, current index version, and current AOCI service, and that the model can still use reliably.

2. When the repository has a usable complete index but the current Run lacks reliable complete cognition, call `aoci_rules` first and then `aoci_overview`.

   Reuse complete cognition directly while it remains reliable. Local uncertainty does not by itself require mechanically rereading the system-wide view.

   A Run that resumes from a known Host context compaction, including a Host-injected compaction summary, must treat prior model cognition as unreliable. The compacted handoff must not retain or summarize the formal Whole-Index or any Overview Header, Entry, Chunk, Challenge, or Attestation body; it may retain only receipt identity, unfinished write or Recovery state needed for safe continuation, and an instruction to reload immediately. Whole-Index semantics or a receipt copied into that handoff cannot prove that the resumed model's current cognition is reliable. If the runtime contract is no longer reliably present, call `aoci_rules` first. Before continuing the business task, make an ordinary complete Whole-Index `aoci_overview` request (`check_only` absent or false) with `refresh_reasons=["context_compaction"]` and a fresh `refresh_event_id`; do not use `check_only` or a cognition probe. Follow every exact `next_cursor` through `completed=true`, confirm delivery, and submit one Attestation based only on the newly delivered body. After that fresh complete transport, a partial or failed Attestation consumes the generation and permits the existing source-bound continuation without another automatic Overview.

   AOCI can report checkpoint and cognition-status facts for `context_compaction`, the machine `semantic_threshold` under the project `cognition_refresh_threshold`, or a major `phase_transition`. Use `check_only=true` when only those compact facts are needed. They advise the Agent but do not decide whether the model needs the system-wide view.

   When the Agent explicitly calls ordinary `aoci_overview` (`check_only` absent or false), AOCI must deliver the complete requested scope whenever a coherent CognitionSet can be formed. It must not suppress that body because a receipt already exists, a threshold was not reached, or no refresh reason is pending. Dirty or stale formal cognition is still delivered but is marked unreliable. Pending recovery or an incoherent snapshot fails closed without a mixed body.

   When an ordinary Overview reports `continuation_required=true`, submit its exact `next_cursor` automatically until `completed=true`. Do not ask the user to continue, begin the business task, or state a partial system conclusion. Stop the cognition chain on Host truncation, a missing, duplicate, or reordered Chunk, cursor failure, Index change, or `chunk_tokens` change. Until Attestation completes, never use Memory, source, Spec, `aoci.txt`, historical sessions, scope, search, or Entry reads to repair or supplement Whole-Index cognition. A challenge ordinal is the 1-based position in the formal Entry sequence; Header content, comments, blank lines, Section/Overview/Chunk markers, receipts, and Metadata are excluded, and Chunk Receipt ordinals use that same sequence. The Attestation must echo the Challenge's exact current `index_sha256`, `entry_sequence_sha256`, and `entry_count`; a prior Index, Entry sequence, count, or Attestation is invalid. After the complete chain, submit the existing model cognition Attestation once. One same-response JSON Schema or field-format error may be corrected once without changing semantic answers; an object, Tag, or F mismatch means failure and uncertain assimilation, with no semantic retry or information bypass. During initial cognition it also blocks Root/Meta, Migration, layout-wide, or other unbound system decisions. During a context-compaction refresh with complete transport, unchanged cognition identity, aligned governance, and no Recovery or third-party conflict, the attempt consumes that refresh generation even when Attestation is partial or failed; continue the existing task without another automatic Overview. `system_mastery_percent` self-assesses only the system framework—architecture, responsibilities, strong relationships, stable external contracts, and high-entropy safety and maintenance constraints—not complete implementation or runtime knowledge. Keep machine Index coverage separate, and normally give the user only the prescribed single success or failure sentence derived from actual coverage, Challenge, Chunk, token, and mastery results. If the Host truncates a Chunk, ask the user to set `overview_delivery.chunk_tokens` to a smaller valid value and restart; do not change it automatically.

   Interpret the additive cognition level independently from strict proof fields. `delivery_verified` means the Index was loaded and Host delivery was confirmed while complete cognition verification is still unfinished; describe that state as loaded and delivery-verified, never as no cognition or failure to understand the system. `cognition_verified` requires a passing Attestation (at least 80 percent of Challenge ordinals fully correct with at most one object identity miss), and `cognition_governed` additionally requires governance alignment. A generic complete-read failure sentence is reserved for an actual delivery fault.

   When an Overview response contains the optional `cognition-state/v2` projection, use its dimensions independently. Its Level ends at `model_cognition_usable`; `strict_attestation_verified`, `governance_aligned`, and `current_system_cognition_reliable` are independent states and never participate in that Level. An ordinal, object identity, Tag, or core F mismatch can make strict Attestation fail while model cognition remains usable; do not report that mismatch alone as proof that the model did not understand the system. Only `current_system_cognition_reliable=true` permits an unqualified current complete-system cognition claim. When the projection is absent, keep using the legacy interpretation above.

   An ordinary read-only audit, analysis, or check, a request not to modify code, or a request not to commit or push does not automatically mean strictly zero writes and does not alter the cognition-validity decision above. Codex Memory and historical Skills may only help recover experience, user preferences, and investigation directions. They cannot replace a current cognition receipt matching the repository root, index digest, AOCI service identity, and cognition scope. Project AGENTS and current AOCI identity take precedence over historical Memory for AOCI state.

   Treat a task as strictly zero-write only when the user explicitly prohibits Ledger, metadata, `.aoci` runtime assets, and every filesystem write. If necessary cognition establishment conflicts with that boundary, report the conflict and ask the user to decide or recommend an isolated copy. Never silently substitute Memory for current repository cognition.

3. If the repository has no usable complete index, or has only a minimal skeleton, an incomplete Header, unfinished Entries, or undecided required Curation, obtain `aoci_rules` and enter the current AOCI Guide when a formal complete AOCI index is required. Let Guide choose the next phase from actual repository state and complete the required safety steps.

   `aoci_maintain` does not replace the index-establishment workflow.

   Do not reconstruct or hard-code the full-index generation state machine in this file.

4. During a long-running task, the model is responsible for preserving the current cognition receipt and using the refresh gate correctly:
   - when the Host reports context compaction or the model knows the system-wide view was lost, follow the mandatory `context_compaction` reload rule above; AOCI cannot infer the Host event;
   - when entering a genuinely major phase, declare `phase_transition`, not a function, test run, or small step;
   - at a plausible stable checkpoint, use `check_only=true` to obtain the machine semantic count when that fact is useful;
   - except for the mandatory known-compaction reload, decide whether the current task needs another explicit scoped or complete Overview; and
   - keep the Dirty or Stale reliability state reported by AOCI until maintenance and alignment complete.

### Task closing and cognition maintenance

5. A purely read-only question, analysis, version check, or task that changes no AOCI-managed object does not require a maintenance-tool call. The AOCI version in use is `cognition_receipt.mcp_service_version` in any `aoci_overview` check_only or `aoci_maintain` response; the binary path is the `command` in the project's `.mcp.json`, and the CLI need not be on PATH.

6. When AOCI-managed objects change, call `aoci_maintain` once after they reach the task's final stable state. Do not maintain files individually after each intermediate edit.

7. If maintenance returns actual semantic candidates, the Host model must independently author the complete tag and F/R/A/S updates from each candidate's bound object and necessary evidence. Submit the complete candidate set for that current machine-issued batch in one `aoci_update_entry` call while preserving each `source_sha256`, `candidate_id`, and domain batch identity. `max_entries` limits one request and atomic transaction, not the logical plan, Whole-Index, or Managed Scope. When `remaining` is nonzero, call Maintain again after the successful Apply and continue from the new preimage; never shrink Index coverage or slice a returned batch to satisfy transport limits.

   When evidence is insufficient and the current layout supports `aoci_report`, use it instead of guessing, applying a template, or generating unsupported cognition merely to eliminate follow-up work.

8. Obey structured tool states and safety boundaries:
   - `repair_required`: repair only the explicitly identified candidates, then resubmit the complete current machine-issued batch;
   - `stopped`: end that write attempt and inspect `failed_step`, error, formal-write evidence, and Recovery. In auto mode, a proven zero-write closure is followed by a fresh Plan; a complete Intent with provable postimage is resumed; a policy-selected Rollback with exact preimage is completed and replanned. Stop the user task only when proof is unavailable, third-party bytes conflict, approval or external action is required, or another real safety boundary applies;
   - never ignore conflicts, approvals, human decisions, permissions, or safety signals; and
   - after alignment, do not repeat maintenance or writes; `refresh_ready_for_overview` is a checkpoint fact, and the Agent decides whether to request an ordinary complete Overview for its next phase.

   If any managed object changes after maintenance completes, the previous result is invalid. Complete closing again from the new final stable state.

9. When the user limits only business-file scope and does not explicitly forbid repository-managed assets, AOCI-managed assets may be updated during closing to preserve cognition consistency. Distinguish them from business files in audits and commits.

   When the user explicitly forbids changes to `aoci.txt`, `.aoci`, metadata, or any additional file, obey that restriction, do not write, and report any remaining inconsistency accurately.

### Specialized workflows

Initialization, complete-index generation, Header generation, Entries generation, database-structure indexing, Curation, human review, and failure recovery must follow only the instructions, commands, and safety stops returned by the current AOCI Guide or tool at the corresponding stage.

Do not preload, guess, or reconstruct these specialized workflows. The relevant Guide, tool descriptions, model Prompt, and CLI help provide platform invocation, request format, batch limits, approval rules, index-format details, and recovery steps as needed.

<!-- aoci:end -->
