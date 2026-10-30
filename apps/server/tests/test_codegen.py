from pathlib import Path

from langchain_chess_server import codegen
from langchain_chess_systemone.schema import input_schema, settings_schema

GENERATED = Path(__file__).resolve().parents[3] / "packages" / "chess-ui" / "src" / "generated"


def test_the_committed_files_are_current():
    for name, content in codegen.files().items():
        assert (GENERATED / name).read_text() == content, (
            f"{name} is stale: run `mise run generate:settings`"
        )


def test_main_writes_every_file(tmp_path):
    codegen.main([str(tmp_path / "out")])
    assert sorted(p.name for p in (tmp_path / "out").iterdir()) == sorted(codegen.files())


def test_the_resolved_schema_requires_every_key_and_the_file_only_the_version():
    resolved, file = settings_schema(), input_schema()
    assert resolved["required"] == list(resolved["properties"])
    assert file["required"] == ["version"]
    assert file["properties"]["version"]["enum"] == [1, 2, 3]
    assert {"type": "null"} in file["properties"]["k"]["anyOf"]
    assert file["properties"]["k"]["default"] == 5
    assert file["additionalProperties"] is False
