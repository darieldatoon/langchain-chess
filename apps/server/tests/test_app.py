from fastapi.testclient import TestClient

from langchain_chess_server.app import app, create_app, ui_config
from langchain_chess_server.graph import model_limit


def test_ui_config_exposes_schema_and_defaults():
    body = ui_config()
    assert body["graph"] == "chess"
    assert body["defaults"]["policy"] == "hybrid"
    properties = body["schema"]["properties"]
    assert properties["threshold"]["default"] == 0.9
    assert "langgraph_nodes" in properties["k"]


def test_routes_without_a_build():
    client = TestClient(create_app(static_dir=None))
    assert client.get("/ui/config").status_code == 200
    redirect = client.get("/ui", follow_redirects=False)
    assert redirect.status_code == 307
    assert redirect.headers["location"] == "/ui/"
    assert client.get("/ui/").status_code == 404


def test_the_model_limit_route(env):
    model_limit.cache_clear()
    client = TestClient(create_app(static_dir=None))
    known = client.get("/ui/model-limit", params={"model": "langsmith:baseten/zai-org/GLM-5.3"})
    assert known.json() == {"max_input_tokens": 1_048_000 - 32000}
    unknown = client.get("/ui/model-limit", params={"model": "kimi-k3"})
    assert unknown.json() == {"max_input_tokens": None}
    assert client.get("/ui/model-limit").status_code == 422


def test_static_build_is_served(tmp_path):
    (tmp_path / "index.html").write_text("<h1>chess</h1>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    client = TestClient(create_app(static_dir=tmp_path))
    assert client.get("/ui/").text == "<h1>chess</h1>"
    assert client.get("/ui/assets/app.js").status_code == 200


def test_module_app():
    assert app.title == "langchain-chess ui"
