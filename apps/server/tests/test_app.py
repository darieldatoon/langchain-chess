import importlib.util
from pathlib import Path

from fastapi.testclient import TestClient

from langchain_chess_server import graph as graph_module
from langchain_chess_server.app import app, create_app
from langchain_chess_server.graph import model_limit


def test_the_model_route(env):
    model_limit.cache_clear()
    client = TestClient(create_app())
    known = client.get("/model-facts", params={"model": "langsmith:baseten/zai-org/GLM-5.3"})
    assert known.json() == {"max_input_tokens": 1_048_000 - 64000, "takes_effort": True}
    haiku = client.get(
        "/model-facts", params={"model": "langsmith:anthropic/claude-haiku-4-5-20251001"}
    )
    assert haiku.json()["takes_effort"] is False
    unknown = client.get("/model-facts", params={"model": "kimi-k3"})
    assert unknown.json() == {"max_input_tokens": None, "takes_effort": True}
    assert client.get("/model-facts").status_code == 422


def test_module_app():
    assert app.title == "langchain-chess"


def test_shutdown_closes_the_clients_of_the_graph_langgraph_loads(env):
    # langgraph.json names graph.py by path; the server imports it under a generated name.
    path = Path(graph_module.__file__)
    spec = importlib.util.spec_from_file_location("apps__server__graph", path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    assert loaded is not graph_module
    with TestClient(create_app()):
        classifier = loaded._classifier(
            "typesafe/jev-latest", "k", "https://gateway.smith.langchain.com"
        )
    assert classifier.client.is_closed
    assert classifier.async_client.is_closed
