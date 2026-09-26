#!/usr/bin/env bash
# Usage: superseded.sh WORKFLOW TESTED MAIN. Prints the files changed from TESTED to MAIN that
# match WORKFLOW's on.push.paths, read from MAIN's copy. Any output means a newer run of that
# workflow deploys the target, so TESTED must not.
set -euo pipefail

workflow="$1"
tested="$2"
main="$3"
pathspecs=()
while IFS= read -r path; do
  # glob magic gives `**` and `*` the same meaning as GitHub's path filters.
  pathspecs+=(":(glob)$path")
done < <(git show "$main:$workflow" | yq '.on.push.paths[]')
git diff --name-only "$tested" "$main" -- "${pathspecs[@]}"
