#!/usr/bin/env bash
# Runs OpenWiki with its model calls on the LLM Gateway and its traces in their own project.
# The mise wiki:* tasks call this. Locally the keys come from .env and LC_GATEWAY_KEY in your
# shell; the workflow passes the same names from repository secrets.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export OPENWIKI_PROVIDER=anthropic
export OPENWIKI_MODEL_ID=claude-opus-5-5
export ANTHROPIC_BASE_URL=https://gateway.smith.langchain.com/anthropic
export ANTHROPIC_API_KEY="${LC_GATEWAY_KEY:?export LC_GATEWAY_KEY, the LLM Gateway key}"
# Read by the LangSmith connector (openwiki/.langsmith.json names it) and by tracing.
export OPENWIKI_LANGSMITH_API_KEY="${LANGSMITH_API_KEY:?set LANGSMITH_API_KEY in .env}"
# Both spellings: .env sets LANGSMITH_* for the app, and OpenWiki documents LANGCHAIN_*.
export LANGSMITH_TRACING=true LANGCHAIN_TRACING_V2=true
export LANGSMITH_PROJECT=langchain-chess-openwiki LANGCHAIN_PROJECT=langchain-chess-openwiki
# .env names the app's agent; with a project set too, the SDK would trace nothing.
unset LANGSMITH_AGENT_ID LANGSMITH_AGENT_ENVIRONMENT
export OPENWIKI_TELEMETRY_DISABLED=1

exec openwiki "$@"
