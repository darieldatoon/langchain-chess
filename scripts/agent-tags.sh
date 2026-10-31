#!/usr/bin/env bash
# Tags the positions dataset and the agent's tracing projects to the langchain-chess agent, so
# they appear under it in LangSmith. `mise run agent:tag`; CI runs it after every deploy.
# Needs LANGSMITH_API_KEY for the agent's workspace (or LANGSMITH_PROFILE locally).
set -euo pipefail

AGENT=langchain-chess
DATASET=langchain-chess-positions

api() { langsmith --format json api "$@"; }

agent=$(api "agents/$AGENT")
tag_value_id=$(jq -er .tag_value_id <<<"$agent")

tag() {
  api workspaces/current/taggings \
    --body "$(jq -nc --arg t "$tag_value_id" --arg type "$1" --arg id "$2" \
      '{tag_value_id: $t, resource_type: $type, resource_id: $id}')" >/dev/null
  echo "tagged $1 $2"
}

# The dataset first: tagging it also tags its experiments, past and future.
dataset_id=$(api "datasets?name=$DATASET" | jq -r '.[0].id // empty')
if [[ -n "$dataset_id" ]]; then
  tag dataset "$dataset_id"
else
  echo "no $DATASET dataset yet; run mise run eval:positions:upload, then this again"
fi

for session in $(jq -r '.environments[].tracer_session_id' <<<"$agent"); do
  tag project "$session"
done
