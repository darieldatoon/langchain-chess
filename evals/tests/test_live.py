"""Against the real LLM Gateway: `uv run --all-packages --env-file .env pytest -m live --no-cov`."""

import uuid

import chess
import pytest
from langsmith import Client

from langchain_chess.grading import Cp, Mate
from langchain_chess_evals.positions.examples import Reference, Row
from langchain_chess_evals.positions.schema import INPUTS_SCHEMA, OUTPUTS_SCHEMA
from langchain_chess_evals.positions.upload import upload
from langchain_chess_evals.systemone.target import make_target
from langchain_chess_systemone import GatewayRanker

pytestmark = pytest.mark.live


async def test_the_target_ranks_a_real_position_with_semif():
    board = chess.Board()
    legal = [m.uci() for m in board.legal_moves]
    outputs = await make_target(GatewayRanker("semif-qwen3.5-4b"))(
        {"start_fen": board.fen(), "moves": [], "legal": legal}
    )
    assert outputs["error"] is None
    # 20 legal moves: SemIf holds 16, so a tournament ran
    assert outputs["tournament"] is True
    assert set(outputs["finalists"]) <= set(legal)
    assert outputs["ranked"][0]["uci"] in outputs["finalists"]


def test_langsmith_enforces_the_dataset_schemas():
    client = Client()
    name = f"langchain-chess-positions-live-{uuid.uuid4().hex[:8]}"
    row = Row(
        id="live-010",
        split="dev",
        start_fen=chess.STARTING_FEN,
        moves=("e2e4",),
        legal=("e7e5", "d8h4"),
        reference=Reference({"e7e5": Cp(-20), "d8h4": Mate(5, "white")}),
        metadata={"band": "<1200"},
    )
    manifest = {
        "source": {"months": [{"month": "2018-06"}]},
        "engine": {"name": "live", "settings": {}},
    }
    try:
        done = upload([row], manifest, client, dataset=name, tag="v1")
        stored = client.read_dataset(dataset_name=name)
        assert (stored.inputs_schema, stored.outputs_schema) == (INPUTS_SCHEMA, OUTPUTS_SCHEMA)
        broken = {**row.example(), "id": str(uuid.uuid4())}
        broken["outputs"] = {**broken["outputs"], "ranked": ["not-a-move"]}
        with pytest.raises(Exception, match="422"):
            client.create_examples(dataset_id=done.dataset_id, examples=[broken])
    finally:
        client.delete_dataset(dataset_name=name)
