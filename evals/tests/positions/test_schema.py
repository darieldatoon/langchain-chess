import re

import chess

from langchain_chess.grading import Cp, Mate, eval_json
from langchain_chess_evals.positions.examples import Reference, Row
from langchain_chess_evals.positions.schema import INPUTS_SCHEMA, OUTPUTS_SCHEMA, UCI_PATTERN

ROW = Row(
    id="g-010",
    split="dev",
    start_fen=chess.STARTING_FEN,
    moves=("e2e4", "e7e5"),
    legal=("g1f3", "a2a3", "e1e2"),
    reference=Reference(
        {"g1f3": Cp(40), "a2a3": Cp(0), "e1e2": Mate(3, "black")}, ("g1f3", "a2a3", "e1e2")
    ),
    metadata={},
)


def test_the_schemas_cover_exactly_what_a_row_writes():
    for schema, data in ((INPUTS_SCHEMA, ROW.inputs()), (OUTPUTS_SCHEMA, ROW.reference.json())):
        assert set(schema["properties"]) == set(data)
        assert set(schema["required"]) == set(data)
        assert schema["additionalProperties"] is False


def test_uci_pattern():
    assert all(re.fullmatch(UCI_PATTERN, m) for m in ("e2e4", "e7e8q", "a7b8n"))
    assert not any(re.fullmatch(UCI_PATTERN, m) for m in ("e2e9", "Nf3", "e7e8k", "0000"))


def test_every_eval_shape_matches_one_branch():
    cp, mate = OUTPUTS_SCHEMA["properties"]["evals"]["additionalProperties"]["oneOf"]
    for e in ROW.reference.evals.values():
        data = eval_json(e)
        branch = cp if isinstance(e, Cp) else mate
        assert set(data) == set(branch["required"])
