# langchain-chess-server

The `chess` graph and the `/ui` routes for the LangGraph Agent Server, locally (`langgraph dev`)
and on LangSmith Deployments. Private: it is deployed, not installed.

## Run it

After the [repository setup](../../README.md#set-up), from the repo root:

```sh
mise run dev                                                       # server + web UI
uv run --all-packages langgraph dev --no-browser --port 2024      # the server alone
```

`langgraph dev` reads the root [`langgraph.json`](../../langgraph.json) and loads `.env` through
it. Check it is up with `curl http://127.0.0.1:2024/ok`.

| Route | What it serves |
|---|---|
| The Agent Server API | Threads, runs and assistants for the `chess` graph. Studio uses it too. |
| `GET /ui/config` | The `ChessContext` JSON schema and its defaults |
| `GET /ui/model-limit?model=<spec>` | `{"max_input_tokens": <int or null>}`: the web UI offers Summarize only with a limit |
| `/ui/` | The built web UI. A 404 until `mise run build` has run; `mise run dev` serves it from Vite instead. |

## Call it

Each run's settings pick the opponent. They come from the assistant's `context`, then any keys
present in the run's `configurable`, which win (an explicit `null` clears a nullable knob). Every
field has a default, so no settings plays the hybrid SemIf + GLM-5.3 Flash agent.

```python
from langgraph_sdk import get_sync_client

client = get_sync_client(url="http://127.0.0.1:2024")
thread = client.threads.create()
client.runs.wait(
    thread["thread_id"],
    "chess",
    input={"messages": [{"role": "user", "content": "e2e4"}]},
    config={"configurable": {"policy": "llm", "model": "langsmith:baseten/zai-org/GLM-5.3-Flash"}},
)
print(client.threads.get_state(thread["thread_id"])["values"]["plies"][-1]["san"])
```

The game's first turn records its resolved settings in the thread as `setup` (every key of its
settings version), so any client can continue the game. It is never rewritten: a later run
with other settings plays with them, and `setup` still names the first turn's. The web UI sends
`setup` back with every move, so its games keep one opponent. A run rejected before it opens a
turn records nothing, and a thread from before `setup` never gains one.

`ChessContext` in [`libs/systemone`](../../libs/systemone/langchain_chess_systemone/settings.py)
documents every setting: `policy` (`llm`, `systemone`, `hybrid`), `model`, `reasoning_effort`,
`move_list`, `memory`, `systemone_model`, `threshold`, `k`, `top_p`, `gate`, `draw_claims` and the
rest. Assistant context and `configurable` are each migrated from their settings version, then
merged with `configurable` winning; an explicit null resets a setting to its default, and unknown
keys are ignored. A source without a `version` is read as the current version, as Studio saves one.

`model_kwargs` from a run or an assistant is limited on the server to arguments that reach the
gateway's request: `temperature`, `top_p`, `max_tokens` (or `max_output_tokens`,
`max_completion_tokens`), `reasoning_effort`, `reasoning`, `verbosity` and `extra_body`. Inside
`extra_body`, provider tools and the account's resources (`tools`, `tool_choice`,
`previous_response_id`, `conversation`, `prompt`) are held back too: the gateway attaches the
deployment's key to whatever the request asks for. Run metadata records the values sent, such as
the effort `model_kwargs` set; `setup` keeps `model_kwargs` as given.

Settings switch nodes off but never remove them: `policy="llm"` keeps a SystemOne node that does
nothing, and `memory=False` a summarization node that does nothing. The server rebuilds the
graph without the run's settings to read or update a thread and to describe the graph (Studio,
`assistants/{id}/graph`), and that build must match the one that ran or the thread's pending
tasks come back wrong. Only a run builds a model or System 1 client, so reads need no keys.

## Configuration

`ServerSettings` reads the shell first, then `.env`:

| Variable | Needed for |
|---|---|
| `LANGSMITH_GATEWAY_API_KEY` | LLM calls through the gateway (`.env.example` sets it from `LC_GATEWAY_KEY`) |
| `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL` | System 1 (the `systemone` and `hybrid` policies). Without them those runs fail before writing anything. |

A key that is set but empty stops the server. That is what `${LC_GATEWAY_KEY}` expands to when
the shell variable is missing, and langchain-core would otherwise fall back to the tracing key.

## Deploy

Deploying needs Docker (with buildx) running locally: the image is built on your machine.
CI deploys `langchain-chess-app` on pushes to `main` that change the agent
([`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)). It needs two repository
secrets: `LANGSMITH_API_KEY` (to deploy) and `LC_GATEWAY_KEY` (written into the revision's
secrets). By hand:

```sh
mise run deploy   # builds the web UI into langchain_chess_server/static, then `langgraph deploy`
uv run --all-packages langgraph build -t langchain-chess:smoke   # check the image builds
```

- **Image build.** The image builds from the uv workspace and its lockfile
  (`langgraph.json` `source.kind = "uv"`). langgraph-cli 0.4.31 copies only the root
  `pyproject.toml` before `uv export`, so `dockerfile_lines` adds each member's `pyproject.toml`:
  keep that list in step with the workspace members.
- **Workspace sources** live only in the root `pyproject.toml`. Each member is installed on its
  own in the image, and a member-level `workspace = true` source fails there.

## Test

```sh
uv run --all-packages pytest apps/server --no-cov -q
```

`test_server.py` runs the graph under an offline `langgraph dev`; nothing it runs reaches a model.
`mise run test:e2e` builds the web UI and plays a game in Chromium against `langgraph dev` with a
fake model ([`tests/e2e`](tests/e2e)), checking a setup's settings reach the agent. Install the
browser once with `uv run playwright install chromium`.
