#!/usr/bin/env bash
# Prepares a git worktree: tools, dependencies, git hooks, and the main checkout's gitignored
# .env. Run by the t3.json "Setup worktree" script; safe to run by hand and to re-run.
set -euo pipefail

worktree="$(git rev-parse --show-toplevel)"
cd "$worktree"
# T3 Code passes the main checkout; by hand, the common git dir's parent is the same place.
main="${T3CODE_PROJECT_ROOT:-$(cd "$(git rev-parse --git-common-dir)/.." && pwd)}"

# mise trusts config files per path, and every worktree is a new path.
mise trust --quiet
mise install --quiet

# A symlink, so a rotated key reaches every worktree. Never replace a worktree's own .env.
if [[ "$(cd "$main" && pwd -P)" != "$(pwd -P)" ]]; then
  for file in .env; do
    if [[ ! -e "$main/$file" ]]; then
      echo "note: $main/$file not found; copy .env.example to $file before live runs" >&2
    elif [[ -e "$file" && ! -L "$file" ]]; then
      echo "note: keeping this worktree's own $file" >&2
    else
      ln -sfn "$main/$file" "$file"
    fi
  done
fi

mise run setup
