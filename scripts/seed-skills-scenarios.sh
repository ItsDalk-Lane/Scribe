#!/usr/bin/env bash
# Seed the test vault with predefined skill scenarios.
#
# Each scenario uses a unique, scenario-prefixed skill name so the Skills
# tab makes the state obvious at a glance and so `--clean` can reliably
# remove only the seeded files.
#
# Usage:
#   COPILOT_TEST_VAULT_PATH=/path/to/vault scripts/seed-skills-scenarios.sh
#   COPILOT_TEST_VAULT_PATH=/path/to/vault scripts/seed-skills-scenarios.sh --clean
#   COPILOT_TEST_VAULT_PATH=/path/to/vault scripts/seed-skills-scenarios.sh --list
#
# Flags:
#   --clean   Remove every seeded scenario, then exit. Does not seed.
#   --reseed  --clean followed by a fresh seed (default behavior of a
#             second run is also a clean reseed — flag is just explicit).
#   --list    Print which scenarios are currently present on disk, then exit.

set -euo pipefail

# ----- args --------------------------------------------------------------

MODE="seed"
for arg in "$@"; do
  case "$arg" in
    --clean)  MODE="clean" ;;
    --reseed) MODE="reseed" ;;
    --list)   MODE="list" ;;
    -h|--help)
      sed -n '2,21p' "$0"
      exit 0
      ;;
    *)
      echo "error: unknown flag: $arg" >&2
      exit 1
      ;;
  esac
done

# ----- vault path --------------------------------------------------------

if [[ -z "${COPILOT_TEST_VAULT_PATH:-}" ]]; then
  echo "error: COPILOT_TEST_VAULT_PATH is not set." >&2
  echo "       Set it to the absolute path of an Obsidian vault." >&2
  exit 1
fi

VAULT="$COPILOT_TEST_VAULT_PATH"
if [[ ! -d "$VAULT/.obsidian" ]]; then
  echo "error: $VAULT does not look like an Obsidian vault (no .obsidian/)." >&2
  exit 1
fi

# Folders (must match agentSkillsDirAbs() inputs in the plugin).
CANONICAL_DIR="$VAULT/copilot/skills"
CLAUDE_DIR="$VAULT/.claude/skills"

# Scenario names — each one exercises a row in §14 of the design doc.
# Keep the prefix `seed-` so `--clean` can find every seeded skill.
S_CANONICAL_ONLY="seed-canonical-only"           # §14.1
S_CANONICAL_SHARED="seed-canonical-shared"       # §14.11 (reconciliation)
S_PROJECT_CLAUDE="seed-project-claude-only"      # §14.2 (single, claude)
S_STALE_PROJECT="seed-stale-project-copy"        # canonical wins over stray project
S_PROJECT_WITH_SUPPORT="seed-project-with-helpers" # exercises full-dir hash (support file)

ALL_SCENARIOS=(
  "$S_CANONICAL_ONLY"
  "$S_CANONICAL_SHARED"
  "$S_PROJECT_CLAUDE"
  "$S_STALE_PROJECT"
  "$S_PROJECT_WITH_SUPPORT"
)

# ----- helpers -----------------------------------------------------------

# Write a SKILL.md file with the given frontmatter.
# Args: dest_dir, name, description, enabled_agents (csv, may be empty), body
write_skill() {
  local dest="$1" name="$2" desc="$3" agents="$4" body="$5"
  mkdir -p "$dest"
  cat > "$dest/SKILL.md" <<EOF
---
name: $name
description: $desc
metadata:
  copilot-enabled-agents: "$agents"
---
$body
EOF
}

# Project-managed skills do not need the copilot-enabled-agents key
# (the design infers enabled agents from folder location), but writing
# an explicit empty string keeps the file valid under both the old and
# new discovery paths and matches what agents typically emit.
write_project_skill() {
  local dest="$1" name="$2" desc="$3" body="$4"
  write_skill "$dest" "$name" "$desc" "" "$body"
}

# Create a relative symlink from an agent skills folder back to the canonical
# folder. Mirrors what SkillManager.symlinks does on toggleAgent.
# Args: link_path (absolute), canonical_target_dir_abs
make_canonical_symlink() {
  local link="$1" target="$2"
  mkdir -p "$(dirname "$link")"
  # `ln -s` with a target path is straightforward; we use a relative
  # target so the symlink survives if the vault is moved.
  local link_parent target_rel
  link_parent="$(dirname "$link")"
  # Compute relative path from link_parent to target.
  target_rel="$(python3 -c "import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))" "$target" "$link_parent")"
  rm -rf "$link"
  ln -s "$target_rel" "$link"
}

scenario_present() {
  local name="$1"
  [[ -d "$CANONICAL_DIR/$name" ]] \
    || [[ -e "$CLAUDE_DIR/$name" ]]
}

remove_scenario() {
  local name="$1"
  rm -rf "$CANONICAL_DIR/$name"
  # `-e` on a symlink follows the link; use `-L` (or just rm -f) so we
  # blow away stale symlinks too.
  if [[ -L "$CLAUDE_DIR/$name" || -e "$CLAUDE_DIR/$name" ]]; then
    rm -rf "$CLAUDE_DIR/$name"
  fi
}

clean_all() {
  echo "==> Cleaning seeded scenarios in $VAULT"
  for s in "${ALL_SCENARIOS[@]}"; do
    if scenario_present "$s"; then
      echo "    - remove $s"
      remove_scenario "$s"
    fi
  done
}

list_all() {
  echo "==> Scenarios present in $VAULT"
  local any=0
  for s in "${ALL_SCENARIOS[@]}"; do
    local locs=()
    [[ -d "$CANONICAL_DIR/$s" ]] && locs+=("canonical")
    if [[ -L "$CLAUDE_DIR/$s" ]]; then locs+=("claude(symlink)")
    elif [[ -d "$CLAUDE_DIR/$s" ]]; then locs+=("claude")
    fi
    if [[ ${#locs[@]} -gt 0 ]]; then
      any=1
      printf "    %-40s  %s\n" "$s" "$(IFS=,; echo "${locs[*]}")"
    fi
  done
  if [[ $any -eq 0 ]]; then echo "    (none)"; fi
}

# ----- mode dispatch -----------------------------------------------------

case "$MODE" in
  list)
    list_all
    exit 0
    ;;
  clean)
    clean_all
    exit 0
    ;;
  reseed)
    clean_all
    ;;
  seed)
    # If anything is already seeded, prefer a clean reseed so the script
    # is idempotent and predictable rather than half-merging into old state.
    for s in "${ALL_SCENARIOS[@]}"; do
      if scenario_present "$s"; then
        echo "==> Existing seeded scenarios found — performing clean reseed."
        clean_all
        break
      fi
    done
    ;;
esac

# ----- seed --------------------------------------------------------------

echo "==> Seeding scenarios in $VAULT"

# §14.1 — canonical-only, no agents enabled.
write_skill \
  "$CANONICAL_DIR/$S_CANONICAL_ONLY" \
  "$S_CANONICAL_ONLY" \
  "Lives only in the canonical folder; no agents enabled." \
  "" \
  "# Canonical only

This skill exists only under copilot/skills/ and has zero enabled agents.
Use it to verify the baseline canonical row renders without any migration UI."
echo "    + canonical-only          $CANONICAL_DIR/$S_CANONICAL_ONLY"

# §14.11 — canonical with symlinks (reconciliation invariant).
write_skill \
  "$CANONICAL_DIR/$S_CANONICAL_SHARED" \
  "$S_CANONICAL_SHARED" \
  "Canonical skill enabled for Claude with a project symlink." \
  "claude" \
  "# Canonical shared

Enabled for Claude to exercise the symlink lifecycle and reconciliation."
make_canonical_symlink "$CLAUDE_DIR/$S_CANONICAL_SHARED" "$CANONICAL_DIR/$S_CANONICAL_SHARED"
echo "    + canonical-shared        canonical + symlink at .claude"

# §14.2 — project-single (claude only).
write_project_skill \
  "$CLAUDE_DIR/$S_PROJECT_CLAUDE" \
  "$S_PROJECT_CLAUDE" \
  "Project-managed skill that lives only in the Claude project folder." \
  "# Project, claude only

Should show as enabled for Claude with an 'in .claude/skills' indicator."
echo "    + project-single (claude) $CLAUDE_DIR/$S_PROJECT_CLAUDE"

# Canonical + stray project copy with the same name. Canonical wins
# in discovery; reconciliation will eventually remove the project copy.
write_skill \
  "$CANONICAL_DIR/$S_STALE_PROJECT" \
  "$S_STALE_PROJECT" \
  "Canonical version of a skill that also has a stray real directory in .claude." \
  "" \
  "# Canonical, with stray project copy

A real (non-symlink) directory exists at .claude/skills/$S_STALE_PROJECT.
Discovery drops the project row; reconciliation will clean up the stray."
write_project_skill \
  "$CLAUDE_DIR/$S_STALE_PROJECT" \
  "$S_STALE_PROJECT" \
  "Stray real directory; should be reconciled away." \
  "# Stale project copy

Real directory under .claude/skills/ that conflicts with a canonical
skill of the same name. Should not appear as a separate row."
echo "    + stale project copy      canonical + real dir in .claude"

# Project-managed skill with a support file (exercises full directory hash).
write_project_skill \
  "$CLAUDE_DIR/$S_PROJECT_WITH_SUPPORT" \
  "$S_PROJECT_WITH_SUPPORT" \
  "Project skill that ships a helper file alongside SKILL.md." \
  "# Project with helper

This skill has a supporting file (reference.md). Verify that migrating
it to the shared folder preserves the support file as well as SKILL.md."
cat > "$CLAUDE_DIR/$S_PROJECT_WITH_SUPPORT/reference.md" <<'EOF'
# Reference

Helper content used by the skill. This file must stay with SKILL.md
when the skill moves to the shared folder.
EOF
echo "    + project + support file  .claude (with reference.md)"

# ----- summary -----------------------------------------------------------

echo
echo "Seeded ${#ALL_SCENARIOS[@]} scenarios. Reload the Skills tab to view."
echo
echo "Next steps:"
echo "  - In Obsidian, run: 'Copilot: Open Copilot Chat' then go to Settings → Skills."
echo "  - Use '$0 --list'  to see what is on disk."
echo "  - Use '$0 --clean' to remove all seeded scenarios."
echo "  - Re-run '$0' for a clean reseed."
