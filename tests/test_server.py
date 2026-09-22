from pathlib import Path

from fastapi.testclient import TestClient

from jev_chess.server.app import GRAPH_IDS, app, create_app, ui_config


def test_ui_config_exposes_schema_and_defaults() -> None:
    body = ui_config()
    assert body["graphs"] == list(GRAPH_IDS)
    assert body["game_graph"] == "game"
    assert body["defaults"]["policy"] == "hybrid"
    assert body["schema"]["properties"]["threshold"]["default"] == 0.9


def test_routes_without_a_build() -> None:
    client = TestClient(create_app(static_dir=None))
    assert client.get("/ui/config").status_code == 200
    redirect = client.get("/ui", follow_redirects=False)
    assert redirect.status_code == 307
    assert redirect.headers["location"] == "/ui/"
    assert client.get("/ui/").status_code == 404


def test_static_build_is_served(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<h1>jev</h1>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    client = TestClient(create_app(static_dir=tmp_path))
    assert client.get("/ui/").text == "<h1>jev</h1>"
    assert client.get("/ui/assets/app.js").status_code == 200
    assert client.get("/ui/config").json()["game_graph"] == "game"


def test_module_app_is_a_fastapi_instance() -> None:
    assert app.title == "jev-chess ui"
