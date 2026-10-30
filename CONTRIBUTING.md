# Contributing to Scribe

Issues and pull requests are welcome. Issues are the preferred way to contribute: if you describe the problem and your environment clearly, it can be investigated.

## Before You Start

- Search existing issues and pull requests to avoid duplicates.
- For a substantial change, open an issue first so the problem and scope can be discussed before implementation.
- Keep each pull request focused on one problem. Unrelated fixes, refactors, formatting changes, or dependency updates should be submitted separately.

## Reporting an Issue

A useful issue explains the problem well enough for someone else to understand and reproduce it. Please include:

- What you were trying to do.
- What happened and what you expected instead.
- Clear reproduction steps or a minimal example.
- Your Scribe version, Obsidian version, operating system, provider, provider CLI version, and installation method.
- Relevant logs, screenshots, or recordings.

Remove API keys, tokens, private vault content, personal paths, and other sensitive information before attaching logs or screenshots.

For a feature request, start with the user problem or unmet use case. A proposed solution is helpful, but explaining the need is more important than prescribing an implementation.

## Pull Requests

Pull requests are welcome when they solve a specific, well-defined problem. A pull request description must explain:

- **Why:** the problem being solved, who it affects, and why it is worth solving.
- **What:** the behavior or code that changes.
- **Why this approach:** why the proposed design is a good fit, including meaningful alternatives and tradeoffs.
- **Validation:** tests and manual checks performed, with screenshots or recordings for user-facing changes.
- **Impact:** known limitations, compatibility or data risks, and any follow-up work.
- **Context:** a linked issue when one exists.

Please also:

- Add or update tests for behavior changes and bug fixes.
- Preserve provider and feature ownership boundaries; avoid coupling shared feature code to provider internals.
- Avoid new production dependencies unless the need and tradeoff are explicit.
- Update documentation when behavior or user-facing configuration changes.

## Development

Scribe requires the Node.js version declared in `.node-version`.

```bash
npm install
npm run dev
```

For a bug fix or new behavior, add or update a failing test first, then make the narrowest implementation change that passes it. Use focused checks while iterating. Before submitting a pull request with code or test changes, run the full verification suite:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run check:performance
```

Run one unit or integration file with `npm run test:unit -- tests/unit/example.test.ts`; file paths replace the old runner-specific path flag. Use `npm run test:watch -- <path>` for watching and `npm run test:coverage` for V8 coverage of `src/`.

For local iteration, `npm run test:affected -- --base origin/main` selects tests from
committed, staged, unstaged and untracked changes using the CI dependency graph.
It prints the selection and runs the selected Vitest and script checks.
Use `--list` to inspect without running, `--full` for all tests, and `-- --maxWorkers=1` to forward Vitest
options. Unknown inputs or an unavailable base retain full coverage. For code or test
changes, this does not replace typecheck, lint, build/performance checks or native
checks on other platforms.

For documentation-only changes, a production build is not required. Follow the authoritative rules in [AGENTS.md](AGENTS.md): run `git diff --check` and the affected documentation tests.

Full Linux CI verification uses two Vitest shards, with script checks on the first
shard. Affected selections use one job. Each Linux test job uses three workers.
Both shards must pass the aggregate test gate, and each uploads its own timing artifact. Sharding uses more runner capacity
to reduce elapsed time; compare runner minutes as well as wall time.

Vitest runs through the package wrappers with `--outputFile=<path>` produce JSON, suite execution timings and metadata including resolved workers and unhandled-error counts. Suite execution timings exclude import/worker startup; wall time includes them. CI uploads these
for Linux, native smoke and scheduled suites. To compare native worker counts locally:

```bash
npm run test:cross-platform -- --maxWorkers=2 --outputFile=.context/native.json
node scripts/summarize-vitest-results.mjs .context/native.json .context/native-timings
```

CI runs native smoke with three workers on macOS and one on Windows. The local wrapper
remains serial unless a worker count is supplied. Compare the same selection and
commit, including fixture setup/teardown, and report elapsed time separately from
summed suite durations. Recheck timings on the actual CI runners before increasing
concurrency further.

Scheduled Linux verification also shuffles test files once, using and printing the workflow run ID as its seed. Reproduce with `npm run test:unit -- --sequence.shuffle.files --sequence.seed=<seed>`. Test order within files is unchanged. Linux CI still runs selected tests under `faketime -m -f +1100d` with monotonic clocks excluded and shared memory disabled (`FAKETIME_DISABLE_SHM=1`). Threaded mode serializes libfaketime clock updates; disabling shared memory prevents a killed native child from leaving its stat semaphore locked. Worker threads and child processes still inherit the same relative clock offset. The CI test step stops after five minutes and retains active-file diagnostics in `vitest.json.progress.json` if execution is interrupted.

The project architecture and area-specific development rules are documented in `AGENTS.md` and the scoped `AGENTS.md` files under `src/`.
