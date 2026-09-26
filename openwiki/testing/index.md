# Files

- [Testing conventions](testing-conventions.md) - How the repo tests both halves. Python (pytest with xdist and importlib mode) and JS (Vitest through vp) both have to reach 100% line and branch coverage. Tests use shared fakes rather than mocks. The TUI has Textual snapshot tests. Live tests are opt-in, cost money and run against the real LLM Gateway and a real langgraph dev. A fastchess UCI smoke match covers the engine protocol.
