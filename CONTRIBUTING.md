# Contributing to Scribe

First off, thank you for considering contributing to Scribe! It's people like you who make Scribe such a great tool!

## How Can I Contribute?

### Reporting Bugs or Suggesting Enhancements

Before submitting a bug report or suggestion, please check the [issues](https://github.com/ItsDalk-Lane/Scribe/issues) page for a list of currently known issues to ensure the bug has not already been reported. If it's a new bug or suggestion, create an issue and provide the following information:

- Use a clear and descriptive title.
- Describe the exact steps which reproduce the problem in as much detail as possible.
- Provide specific examples to demonstrate these steps.
- Describe the behavior you observed after following the steps, pointing out what exactly is the problem.
- Explain which behavior you expected to see instead and why.
- Include screenshots or animated GIFs showing you following the described steps and clearly demonstrating the problem.

### Your First Code Contribution

Unsure where to begin contributing to Scribe? You can start by looking through the `help-wanted` issues.

### Pull Requests

The process described here aims to:

- Maintain the quality of Scribe.
- Fix problems that are important to users.
- Engage the community in working towards the best possible Scribe.
- Enable a sustainable system for Scribe's maintainers to review contributions.

Please follow these steps to have your contribution considered by the maintainers:

1. Ensure the code adheres to a clean style consistent with the existing code.
2. Thoroughly test your changes before submitting.
3. Be descriptive in your pull request, linking to the issue it addresses, and showing screenshots demonstrating the change.
4. Once you receive feedback, update the code accordingly to address them before your pull request can be ultimately accepted.

### How to Set Up Dev Environment

Here is a great [writeup by Daniel Haven](https://medium.com/gitconnected/how-to-set-up-the-ideal-obsidian-plugin-development-workflow-b222fe72280f) on the best practices for setting up your dev environment for Obsidian plugins.

In the case of Scribe, you will need to:

1. Fork the repo.
2. Create a vault just for development.
3. Clone the forked repo into your vault's `plugins` folder.
4. Run `npm install` to install all dependencies.
5. Install the recommended VS Code extensions (Prettier and ESLint).
6. Ensure your editor respects the `.editorconfig` and Prettier settings.
7. Run `npm run dev` in your repo to see the effect of your changes.
8. Before committing, run `npm run format` to ensure all files are properly formatted.
9. Before opening a pull request, run `npm run review:obsidian` as described below.
10. When you are ready to make a pull request, ensure to make your changes in **a branch on your fork**, and then submit a pull request to the **main repo**.

Try to be descriptive in your branch names and pull requests. Happy coding!

### Obsidian community review preflight

`npm run review:obsidian` reproduces the public Obsidian source, CSS, manifest/license, and runtime dependency checks. Errors fail the command; warnings remain visible for conservative follow-up work when an automatic cleanup could change plugin behavior or UI. The command rebuilds and scans the packaged `styles.css`, then runs rejection fixtures to ensure every guarded review family is still detected.

ESLint and Stylelint findings include the file, line, rule, and message; the same details appear as annotations in GitHub Actions. Dependency-audit findings remain visible for explicit, compatibility-tested follow-up work; critical advisories block the preflight.

The upstream review packages are pinned in `package.json`. Update those versions and the lockfile together, review the upstream rule changes, and rerun the complete preflight before committing an upgrade. Do not weaken an error merely to re-establish a passing baseline, and do not promote a warning to blocking until its remediation is behavior-preserving.

Maintainers should also read the [review-gate maintenance guide](./internal-docs/OBSIDIAN_COMMUNITY_REVIEW.md) before changing review rules, severities, or fixtures.

#### Limiting Jest Workers

`npm test` starts one Jest worker per CPU core, minus one, and each worker can use 2 GB of memory or more. A full run can use up all the RAM on a 16 GB machine. To cap the number of workers, set `COPILOT_JEST_MAX_WORKERS` in your shell profile:

```bash
export COPILOT_JEST_MAX_WORKERS=2
```

It takes a number (`2`) or a share of your CPU cores (`50%`). When it's unset, Jest uses its default. Passing `--maxWorkers` on the command line overrides it for that run.

#### Fast Iteration with `npm run test:vault` (macOS)

If you work across multiple worktrees or just want one command to build and load the plugin into a test vault, use `npm run test:vault`. It runs `npm install`, builds, symlinks `main.js` / `manifest.json` / `styles.css` from the worktree into the vault's `.obsidian/plugins/scribe/` folder, and reloads the plugin in Obsidian via its CLI.

**One-time setup:**

1. Create or pick a vault dedicated to plugin testing and open it in Obsidian at least once so `.obsidian/` is created.
2. Enable community plugins in that vault (Settings → Community plugins → Turn on).
3. Set an env var pointing at the vault path. Add this to `~/.zshrc`, `~/.bashrc`, or `~/.config/fish/config.fish`:

   ```bash
   export COPILOT_TEST_VAULT_PATH="$HOME/Obsidian/CopilotTestVault"
   ```

**Per change:**

From any worktree, run:

```bash
npm run test:vault
```

The script installs deps, builds the plugin, symlinks the build artifacts into the vault, then calls `plugin:enable` and `plugin:reload` on the Obsidian CLI. If Obsidian isn't running, the symlinks are still in place — start Obsidian and the new build will load.

Because the script symlinks files (not the worktree root), the vault's plugin `data.json` (settings, chat history) stays vault-local and is preserved across worktrees and rebuilds.

Requires macOS with Obsidian installed at `/Applications/Obsidian.app`.

## Commit Signing

Commits to `master` must be signed and verified by GitHub. The easiest path is SSH signing using your existing SSH key.

1. Configure git to sign with your SSH key:

   ```bash
   git config --global gpg.format ssh
   git config --global user.signingkey ~/.ssh/id_ed25519.pub
   git config --global commit.gpgsign true
   ```

   Replace `id_ed25519.pub` with the path to your own public key if different.

2. Register the same key as a **Signing Key** on GitHub at https://github.com/settings/ssh/new. Set "Key type" to `Signing Key` (this is separate from an Authentication Key, even if it's the same key).

3. Confirm your commit email matches a verified email on your GitHub account at https://github.com/settings/emails. Otherwise commits show as Unverified even when signed.

4. Verify locally and on GitHub:

   ```bash
   git commit --allow-empty -m "test signing"
   git log --show-signature -1
   ```

   After pushing, the commit on github.com should display a green **Verified** badge.

If you already use GPG, set `gpg.format openpgp` instead and register the GPG public key at https://github.com/settings/gpg/new. Commits merged via the GitHub web UI are auto-signed by GitHub and don't need this setup.

## Manual Testing Checklist

Test the items relevant to your change using a separate test vault. Enable debug mode when diagnosing a failure.

### Fresh Install and Model Setup

- Use a new test vault with no existing Copilot settings. Confirm the plugin starts and guides you to configure your own model or coding agent.
- Configure a provider with your own API key, a local Ollama / LM Studio model, or an available coding agent account. Confirm model selection and ordinary chat work.
- Do not reset settings in a vault containing the user's working configuration.

### Chat and Context

- Send messages, switch models, stop a response, reopen saved chats, and verify earlier turns remain available.
- Add notes with `[[note title]]` or the context picker, including Markdown, Canvas, and Bases files where supported.
- Attach an image and ask a model that supports images to describe it.
- Verify project Markdown context and project tag selections reach the selected model.
- With one coding agent selected, verify its own note search, file reading, and local PDF reading capabilities where supported by that agent.
- Check ordinary answer citations and links to notes.

### Settings

- Add, edit, select, and delete a custom model.
- Check the settings affected by your change, including reload persistence and the empty configuration state.
- Verify custom skills remain available to the selected coding agent.

### Commands and Quick Ask

- Select note text and apply a built-in command, such as translation, and a custom command.
- Open Quick Ask and confirm it uses the configured model and selected text.
- Try a `/` custom prompt and verify templating with `{folder}` and `{#tag1, #tag2}`.
- Check any commands added, updated, or affected by your change.

## Getting Help

- **GitHub Issues**: [Open an issue](https://github.com/ItsDalk-Lane/Scribe/issues) for bugs and feature requests.

Thank you for contributing to Scribe!
