---
type: configuration schema
title: Settings and model arguments
description: The versioned CoreSettings/ChessContext opponent schema (currently version 3) shared by the agent server, CLI, web app and evals. Covers migrate/resolve and merge order (assistant context, then configurable, with null meaning reset), the recorded setup, how model_kwargs are checked on each surface, codegen into packages/chess-ui, how the web app stores, sanitizes and sends settings, opponent settings files, and the server's environment ServerSettings.
tags: [settings, chess-context, versioning, model-kwargs, codegen, json-schema, web-settings, server-settings, oauth]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-13T19:10:14.398Z
sources:
  - id: openwiki-source-d6b546398e3b1c03ecb0494a
    resource: repo://apps/server/langchain_chess_server/auth.py
  - id: openwiki-source-9e73cfc78a8aeac72fc36a15
    resource: repo://apps/server/langchain_chess_server/codegen.py
  - id: openwiki-source-65aad166aa88a58cc7a8319a
    resource: repo://apps/server/langchain_chess_server/context.py
  - id: openwiki-source-88d085345a1ecd09c61f7ab0
    resource: repo://apps/server/langchain_chess_server/game_setup.py
  - id: openwiki-source-c9b903d37e22daedc4499a4b
    resource: repo://apps/server/langchain_chess_server/graph.py
  - id: openwiki-source-e3b0d2af80ee0702b2be4a6b
    resource: repo://apps/server/langchain_chess_server/settings.py
  - id: openwiki-source-bae425afdb2f1082f5506562
    resource: repo://apps/server/tests/test_codegen.py
  - id: openwiki-source-0486059a508cedacd209f083
    resource: repo://apps/server/tests/test_context.py
  - id: openwiki-source-f3c191b904053bff31100758
    resource: repo://apps/server/tests/test_settings.py
  - id: openwiki-source-122f779bf6eb18ae91667e7f
    resource: repo://apps/web/src/components/NewGameDialog.tsx
  - id: openwiki-source-3cb426dd15d324cb1ef8679d
    resource: repo://apps/web/src/settings.ts
  - id: openwiki-source-be4a82601d4a0ee9e1634703
    resource: repo://apps/web/src/setup.ts
  - id: openwiki-source-1076e2fa932ac0d1c637b001
    resource: repo://apps/web/src/storage.ts
  - id: openwiki-source-611421396243f4b643f6d94a
    resource: repo://apps/web/src/useGame.ts
  - id: openwiki-source-264ef72e4bd65e85aa988d5b
    resource: repo://apps/web/tests/settings.test.ts
  - id: openwiki-source-aa3e6650e2e2db69113e88b1
    resource: repo://evals/experiments/opponents/jev-terse.json
  - id: openwiki-source-1e593e9ea3114c009929aa6d
    resource: repo://evals/langchain_chess_evals/systemone/experiment.py
  - id: openwiki-source-b97343132cd8bf8377dc9677
    resource: repo://libs/chess/langchain_chess/model_arguments.py
  - id: openwiki-source-cbaaf1981eee0f537632c225
    resource: repo://libs/chess/langchain_chess/settings.py
  - id: openwiki-source-a20a927671d49f88ead9466e
    resource: repo://libs/chess/tests/test_model_arguments.py
  - id: openwiki-source-abe54986bd51a87223916132
    resource: repo://libs/cli/langchain_chess_cli/main.py
  - id: openwiki-source-595fa5f62bc6bdbfd212eed8
    resource: repo://libs/cli/langchain_chess_cli/options.py
  - id: openwiki-source-bbdfa6833034539bd8fcefff
    resource: repo://libs/systemone/langchain_chess_systemone/schema.py
  - id: openwiki-source-21de6a067affac443ab60933
    resource: repo://libs/systemone/langchain_chess_systemone/settings.py
  - id: openwiki-source-86dda03c2529753312560daf
    resource: repo://libs/systemone/tests/fixtures/settings-cases.json
  - id: openwiki-source-5879d0ac89e370d9b678cbd5
    resource: repo://libs/systemone/tests/test_settings.py
  - id: openwiki-source-72b5d686f860ea86c8592080
    resource: repo://mise.toml
  - id: openwiki-source-c81a61ad418f9c19c518d61d
    resource: repo://packages/chess-ui/src/settings.ts
generated: { by: "openwiki/0.9.0", at: "2026-11-13T19:10:14.398Z" }
---

# Settings, versions and model arguments

Every game's opponent is described by one settings object, `ChessContext`. The agent server, the CLI (TUI and UCI), the web app and the evals all read it. The schema is defined once in Python and versioned. It is then generated into JSON Schema and TypeScript, so the browser checks values the same way the server does. The server serves no settings endpoint. Frontends get the settings only through the generated files compiled into `packages/chess-ui`.

## Layers of the schema

- **`Settings`** (`libs/chess/langchain_chess/settings.py`) is the pydantic base class. Its config is `extra="forbid", frozen=True, strict=True`. Strict means there is no coercion: `"5"` is not accepted as `5`. The web app's checks come from the schema, and JavaScript has no loose `"5" == 5` equality either. Instances are immutable.
- **`CoreSettings`** holds the LLM core: `model` (default `DEFAULT_MODEL`, which is `langsmith:baseten/zai-org/GLM-5.3-Flash`), `model_kwargs`, `reasoning_effort`, `system_prompt`, `show_fen`, `show_board`, `move_list`, `memory` and `draw_claims`.
- **`SystemOneSettings`** (`libs/systemone/langchain_chess_systemone/settings.py`) holds the System 1 ranker and gate:
  - `systemone_model` (default `typesafe/jev-latest`, Jev)
  - `style`, `with_eval`, `with_nouls`
  - `gate`, `threshold`, `tournament_threshold`
  - `k`, from 1 to `CHOICE_LIMIT`
  - `top_p`
  - `seed`, bounded to ±(2^53−1) so a browser can hold it exactly.

  `k` and `seed` accept whole-number floats such as `5.0`, because JSON cannot tell those apart from integers.
- **`ChessContext`** combines a head with the two groups above. The head is `version: Literal[3]` plus `policy`, which is one of `llm`, `systemone` or `hybrid` (default `hybrid`).

Each field is declared through the `setting(...)` helper. The helper attaches:

- a description, used by Studio and the CLI;
- `langgraph_nodes`, the nodes Studio highlights;
- `x-label` and `x-help`, the web app's name and tooltip for the setting.

Tests require every label to be unique and every tooltip to be plain text that ends in a full stop.

The graph's `context_schema` is not `ChessContext` but `ChessContextInput`. That is a lenient `TypedDict` in which every key is optional and nullable. LangGraph builds the context from it without validation, so an assistant saved by an older version still runs. The real validation happens in `resolve`.

## Versions and migration

`VERSION` is currently 3. `DEFAULTS` freezes the keys and defaults of versions 1, 2 and 3. A released entry must never be edited. `MIGRATIONS[n]` carries version *n*'s keys to version *n+1*:

- **1→2, `_adds_prompt_and_model_options`**: only adds keys (`model_kwargs`, `system_prompt`, `show_fen`, `show_board`).
- **2→3, `_retires_semif`**: makes Jev the default System 1, because the gateway no longer serves SemIf's models. Any `systemone_model` that starts with `semif-` is rewritten to `typesafe/jev-latest`. This applies to both partial and complete settings. A partial that omits the key gets the new Jev default rather than the old one.

Any schema change must bump `VERSION`. That covers a key added, renamed or removed, a changed default, or a changed meaning. Each migration step takes a `complete` flag:

- For **partial** settings (a file or source that sets only some keys), a step writes only what it must. Writing an added key's default would override a source merged underneath. A step that changes a default must normally write the old default into a partial that omits the key. The 2→3 step deliberately doesn't, because the old default can no longer play.
- For **complete** (recorded) settings, the step fills in the added keys' defaults.

`version_of` requires a positive-integer `version`. It rejects any version newer than the reader with a `SettingsError` ("upgrade it"). `migrate(data, unknown="error"|"drop", complete=...)` removes `version`, rejects or drops keys that version doesn't know, and applies every step up to `VERSION`.

Entry points:

| Function | Reads | Rules |
|---|---|---|
| `load(data)` / `load_file(path)` | settings files (JSON) | `version` required, every other key optional, unknown keys are an error |
| `load_recorded(data)` | settings a game recorded | must contain exactly its version's keys, otherwise "damaged"; migrated with `complete=True` |
| `resolve(*sources)` | migrated partial sources | merged in order with later sources winning; keys set to `None` are dropped before validation, which resets them to the default |
| `dump(settings)` | a `ChessContext` | every key of the current version as JSON; this is what a game records |

The null-means-reset rule works because every nullable setting defaults to null.

### The recorded `setup`

`GameSetupMiddleware` (`apps/server/langchain_chess_server/game_setup.py`) writes `dump(context)` into the thread's `setup` state key. It does this only on the run that opened the game's first turn, and never again. A later run plays with its own settings, but `setup` still names the first turn's settings. A thread created before `setup` existed never gains one. Clients read `setup` with `load_recorded`/`loadRecorded` so they can continue a game from its thread alone. See [state-record](state-record.md).

## Server resolution: assistant context, then `configurable`

```mermaid
flowchart TD
    A["assistant context via runtime.execution_runtime"] --> S1["_source: add version if missing, migrate with unknown=drop"]
    B["config configurable"] --> S2["_source: add version if missing, migrate with unknown=drop"]
    S1 --> R["resolve: context first, configurable wins, nulls dropped"]
    S2 --> R
    R --> V["ChessContext.model_validate, strict"]
    V --> G["build_graph with server model_kwargs rules"]
```
*How `make_graph` turns a run's two setting sources into one validated `ChessContext`.*

`resolve_context(config, runtime)` in `apps/server/langchain_chess_server/context.py`:

1. Reads the assistant context from `runtime.execution_runtime.context`, which can be a model or a dict, and then `config["configurable"]`.
2. Treats a source with no `version` (or a null one) as the current version, because Studio saves assistants without one. This is only safe while each version keeps the old keys readable. A version that renames or removes a key must decide how to read versionless sources. A versionless source is read as version 3 and skips the 2→3 step, so a versionless source that still names a `semif-` model is not rewritten to Jev.
3. Migrates each source with `unknown="drop"`, so server-owned keys such as `thread_id` are ignored.
4. Resolves in the order context, then configurable. A key omitted from `configurable` keeps the assistant's value. An explicit `null` resets the key to its default, so a run can clear an assistant's `top_p`. Validation happens after the merge. A bad value fails the run up front with a `ValidationError`, and a newer `version` fails it with a `SettingsError`.

`make_graph` calls this only when the call carries an execution runtime. Reads, updates and introspection get the settings-free `shape()` graph instead. See [agent-server](../integrations/agent-server.md).

## Web app: storing, sanitizing and sending settings

The web app (`apps/web`) gets the settings' types, checks, defaults, labels and version table from `@langchain-chess/chess-ui`, which re-exports the generated module. It never asks the server for them. `apps/web/src/settings.ts` adds a thin layer on top:

- **`apiUrl(env)`** returns the deployment URL set at build time in `VITE_API_URL`. If that is unset or empty, it falls back to `DEV_API_URL` (`http://localhost:2024`, the `langgraph dev` server).
- **`CONTEXT_CHECKS`** maps each `SETTING_KEYS` entry to `isSetting(key, value)`, the generated type and range check.
- **`sanitizeContext(stored)`** reads untrusted stored values of any subset. First it runs `migrateSettings(..., { unknown: "drop" })`. If there is no readable version, or the version is newer than the app's, it trusts nothing. Each remaining key is then kept only if `isSetting` accepts it on its own. Otherwise that key falls back to `DEFAULT_CONTEXT`, so an obsolete or corrupt entry can't reach a run.
- **`recordedContext(stored)`** wraps `loadRecorded`. It returns `null` instead of throwing when a recorded context has a missing, unknown or invalid key, because filling in a default would play a different game.
- **`configurableOf(context)`** builds `{ version: SETTINGS_VERSION, ...every SETTING_KEYS value }` in order. It drops any non-setting key such as `human_side`.

```mermaid
flowchart TD
    LS["localStorage langchain-chess:setup"] --> SS["sanitizeSetup: sanitizeContext per field"]
    SS --> M["matchupOf: pickers plus knobs, server model_kwargs check"]
    M --> CTX["ChessContext"]
    TH["thread setup"] --> RC["recordedContext: loadRecorded or null"]
    RC --> GR["gameOf: GameRecord context"]
    CTX --> GR
    GR --> CO["configurableOf: version plus every key"]
    CO --> RUN["stream.submit config.configurable"]
```
*How the web app turns stored setups and recorded threads into the `configurable` it sends.*

**Storage.** `apps/web/src/storage.ts` stores the new-game setup under the `localStorage` key `langchain-chess:setup`. The setup holds the pickers plus the "knobs", meaning every setting except `version`, `policy`, `model` and `systemone_model`. `storedSetup` stamps it with `version: SETTINGS_VERSION`. `sanitizeSetup` reads it back field by field through `sanitizeContext`. A stored setup with no version falls back to the defaults. A game's own settings are not stored in the browser. They live in the thread's `setup`.

**Building a context.** `matchupOf` (`apps/web/src/setup.ts`) derives `policy` from the pickers: no LLM gives `systemone`, System 1 off gives `llm`, and both give `hybrid`. Before it allows a game, it checks `model_kwargs` against the **`server`** surface. Settings files can be imported with `loadSettings` (`importedSetup`). The new-game dialog exports the chosen context as `opponent.json` through `configurableOf`.

**Sending.** `gameOf` takes the context from `recordedContext(values.setup)`. If the thread has none yet, it uses the new game's chosen context, and otherwise returns `null`. `useGame` sends `configurableOf(record.context)` as `config.configurable` on every submit, with `metadata: { surface: "web" }`. Because every key is present, web runs fully override any assistant context. See [web-frontends](../architecture/web-frontends.md).

## CLI and eval surfaces

- **CLI** (`libs/cli`): `_settings` loads `--config` through `load_file`, or starts from the defaults. It parses `--model-kwargs` as JSON and then calls `overlay(settings, flags, resets)`. `overlay` first sets each key named by `--reset` back to its default. It then applies every flag that was given (a flag left out is `None` and ignored) and validates again. An unknown reset key, or `version`, raises `SettingsError`. The UCI engine also loads a settings file through `load_file`. `run_config` puts `dump(settings)` and `sent(settings)` into trace metadata.
- **Opponent settings files** are partial settings files. For example, `evals/experiments/opponents/jev-terse.json` is just `{"version": 3, "systemone_model": "typesafe/jev-latest", "style": "terse"}`, and every missing key takes its version's default. A System 1 experiment TOML entry can name one with `opponent` instead of `model`/`style`, but not both. Only the file's ranker fields are used: `systemone_model`, `style`, `with_eval` and `with_nouls`. The eval CLI also accepts an opponent file. See [system-one-evals](../workflows/system-one-evals.md).

## `model_kwargs`: checked, resolved, per surface

`model_kwargs` are extra constructor arguments for `init_chat_model`. They take precedence over the settings, which take precedence over the app's defaults. `libs/chess/langchain_chess/model_arguments.py` is pure and owns the rules:

- **Held back on every surface** (`held_back`):
  - model names (`MODEL_NAMES`), because the `model` setting names, prices and sizes calls;
  - agent-owned keys (`AGENT_OWNED`: `input`, `messages`, `instructions`, `stream`, …);
  - app-owned constructor keys at the top level (`APP_OWNED`: `model_kwargs`, `model_provider`, `name`, `profile`, …);
  - anything that matches `CONNECTION_PATTERN` (key/secret/token/header/url/base/…), including inside `extra_body`. The exceptions are the output-limit names and `prompt_cache_key`.
- **Held back only on the `server` surface**:
  - `ACCOUNT_RESOURCES` (`tools`, `tool_choice`, `previous_response_id`, `conversation`, `prompt`);
  - any top-level key outside the `SERVER_ALLOWED` allowlist (`temperature`, `top_p`, `max_tokens`/`max_output_tokens`/`max_completion_tokens`, `reasoning_effort`, `reasoning`, `verbosity`, `extra_body`).

  Keys inside `extra_body` are not subject to the allowlist, but the account-resource and connection checks still apply to them.
- **Shape checks** (`problems`):
  - `extra_body` and `reasoning` must be objects.
  - Aliases must agree. `reasoning_effort` and `reasoning.effort` form one group, and the three output-limit names form another. `True` and `1` count as different values.
  - The effort must be a non-empty string, and the output limit must be a positive integer (a whole-number float is accepted).

`model_arguments(model_kwargs, reasoning_effort=..., surface=...)` drops null values and raises `ModelArgumentsError` on any problem. It returns a `ModelArguments` with three parts:

- `kwargs`: the aliases collapsed to one name. The effort is merged into a `reasoning` object if one was given, and is otherwise sent as `reasoning_effort`.
- `max_tokens`: the output limit, if any.
- `reasoning_effort`: the effort the request actually carries. If `extra_body.reasoning` is present, it replaces the whole object.

Where each surface checks:

- The `CoreSettings.model_kwargs` validator runs the **`local`** rules. So no `ChessContext` anywhere can hold arguments that are forbidden everywhere.
- The server builds the model with `arguments(settings, "server")` in `server_model` and records `sent(settings, "server")` as graph metadata. The CLI and evals use `default_model`, which applies the `local` rules.
- The web app mirrors `held_back` and `problems` in `packages/chess-ui/src/settings.ts`. `isSetting` uses the `local` rules. The new-game setup (`matchupOf` and `parseKwargs` in `apps/web/src/setup.ts`) also checks against `"server"` before it starts a game.

For how the resolved arguments reach the gateway and affect token accounting, see [models-gateway-and-cost](models-gateway-and-cost.md). An output limit set only inside `extra_body` isn't seen, so memory may summarize too late.

## Codegen into `packages/chess-ui`

`python -m langchain_chess_server.codegen <dir>`, run as `mise run generate:settings`, writes three files into `packages/chess-ui/src/generated`:

- `settings.schema.json`: `settings_schema()`, the resolved `ChessContext`, with every key required.
- `opponent.schema.json`: `input_schema()`, which describes a settings file. Only `version` is required, as an enum of the known versions (1, 2, 3). Every other key also accepts `null` and keeps its default, and `additionalProperties` is false.
- `settings.ts`, which contains:
  - `SETTINGS_VERSION` (currently 3);
  - the enum types and the `ChessContext` interface;
  - `SETTING_SPECS`, the per-key checks (type, enum values, ranges, nullability);
  - `SETTING_LABELS` and `SETTING_HELP`;
  - `DEFAULT_CONTEXT`;
  - `VERSION_DEFAULTS`, built from `DEFAULTS`;
  - `MODEL_KWARGS_RULES`, the rule sets exported from `model_arguments.py`.

The hand-written `packages/chess-ui/src/settings.ts` builds on those generated values. Its `migrateSettings`, `resolveSettings`, `loadSettings` and `loadRecorded` mirror `migrate`, `resolve`, `load` and `load_recorded`, including both migration steps. `libs/systemone/tests/fixtures/settings-cases.json` is a shared fixture (`files`, `recorded`, `values`) that holds the Python and TypeScript readers to the same answers. A test requires its `values` to cover every setting.

## Server environment settings (`ServerSettings`)

Separate from the per-game `ChessContext`, the agent server reads deployment-level settings from its environment through `ServerSettings` (`apps/server/langchain_chess_server/settings.py`). This is a pydantic-settings class. It reads the shell first and `.env` second, and ignores variables it doesn't declare. Model credentials are not part of it: the chat model reads the providers' own variables (or `LANGSMITH_GATEWAY*`) itself. None of its variables is required.

| Variable | Used for | Blank value |
|---|---|---|
| `LANGSMITH_GATEWAY_API_KEY` | read only to reject a blank value | error |
| `TYPESAFE_API_KEY` | System 1 ranker | error |
| `TYPESAFE_BASE_URL` | System 1 ranker | error |
| `OAUTH_CLIENT_ID` | "Sign in with LangSmith" access policy | unset |
| `ALLOWED_ORGANIZATION_ID` | "Sign in with LangSmith" access policy | unset |

Blank values are handled in two different ways:

- **Keys: blank is an error.** If one of the gateway or TypeSafe variables is set to an empty or whitespace-only value, construction fails with a `ValidationError` ("is set but empty; unset it or give it a value"). This matters because the `.env` template expands `LANGSMITH_GATEWAY_API_KEY=${LC_GATEWAY_KEY}` to `""` when the shell variable is missing, and langchain-core would then quietly fall back to the tracing key. The variables themselves are optional. However, `typesafe()` raises `ValueError` ("System 1 needs …") when either TypeSafe variable is unset. Only the policies that run System 1 call it, through the server's pooled ranker.
- **OAuth settings: blank means unset.** `OAUTH_CLIENT_ID` and `ALLOWED_ORGANIZATION_ID` are stripped, and an empty result becomes `None`. The deploy workflow writes both before the OAuth app exists, and an unset value only causes sign-in tokens to be refused. `auth.py` builds its `AccessPolicy` from these two values. A policy with either value unset refuses every token, so the deployment then accepts only LangSmith API keys. See [langsmith-sign-in](../integrations/langsmith-sign-in.md).

## Rules a change must keep

- Keep settings strict. The only coercion allowed is the explicit whole-float handling for `k` and `seed` (and `version`).
- Bump `VERSION` for any schema change, and add a frozen `DEFAULTS` entry and a `MIGRATIONS` step. Mirror the step in `packages/chess-ui/src/settings.ts`. Versionless server sources are read as the current version, so a version that renames or removes keys must say how to read them.
- A migration for partial settings must not write an added key's defaults.
- Regenerate with `mise run generate:settings`. `test_the_committed_files_are_current` fails when the generated files are stale. The web app then picks up the new version, specs and defaults with no server change.
- Keep the server allowlist for `model_kwargs`. A new top-level argument reaches the server only after it is added to `SERVER_ALLOWED`. The change then reaches the web app through codegen.
- Give every new field a `setting(...)` with a unique label and a plain tooltip. Add valid and invalid cases to `settings-cases.json`.

## Focused tests

- `libs/systemone/tests/test_settings.py`: file and recorded cases, per-key value cases, the defaults frozen to match the model, migrate and resolve semantics, immutability, and the lenient input schema.
- `apps/server/tests/test_context.py`: merge order, null reset, versionless sources, bounds, and rejection of newer versions.
- `libs/chess/tests/test_model_arguments.py`: precedence, collapsing aliases, `extra_body.reasoning` replacement, and the hold-backs that apply everywhere and on the server only, checked against captured gateway bodies.
- `apps/server/tests/test_codegen.py`: the committed files are current, and both schemas have the right required keys.
- `apps/web/tests/settings.test.ts`: `sanitizeContext` rejects bad values key by key and trusts nothing that is versionless or newer; `recordedContext` refuses incomplete records; `apiUrl` falls back to `DEV_API_URL`; `configurableOf` sends exactly the `ChessContext` keys with `version` 3.
