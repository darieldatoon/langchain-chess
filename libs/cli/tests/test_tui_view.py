import chess

from langchain_chess_cli.tui.view import (
    board_of,
    cost_text,
    describe_settings,
    move_list,
    ply_details,
    status_text,
)
from langchain_chess_systemone.settings import ChessContext

BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"


def call(cost, complete=True):
    return {"cost_usd": cost, "cost_complete": complete}


def test_cost_text():
    assert cost_text([]) == "—"
    assert cost_text([call(0.00125)]) == "$0.0013"
    assert cost_text([call(0.001), call(None)]) == "≥$0.0010"


def ply(index, san, source="llm", turn_id=None, meta=None, model=None):
    return {
        "ply": index,
        "san": san,
        "uci": "",
        "source": source,
        "turn_id": turn_id,
        "latency_ms": 1500.0,
        "model": model,
        "meta": meta or {},
    }


def test_move_list_from_a_black_to_move_root():
    values = {
        "start_fen": BLACK_TO_MOVE,
        "plies": [ply(0, "c5", turn_id="t"), ply(1, "Nf3", source="external"), ply(2, "d6")],
        "turns": [{"id": "t", "calls": [call(0.5)]}],
    }
    assert move_list(values) == "1... c5 (LLM $0.5000)\n2. Nf3 (you)  d6 (LLM)"
    assert move_list({}) == "No moves yet."


def test_ply_details_with_systemone():
    meta = {
        "status": "shortlist",
        "gate": "margin",
        "signal": 0.2,
        "threshold_used": 0.9,
        "finalist_conditional": True,
        "shortlist": [{"uci": "e7e5", "probability": 0.6}],
    }
    values = {
        "moves": ["e2e4", "e7e5"],
        "plies": [
            ply(0, "e4", source="external"),
            ply(1, "e5", turn_id="t", meta={"SystemOneMiddleware": meta}, model="m"),
        ],
        "turns": [{"id": "t", "calls": [call(0.01)], "illegal_attempts": 2}],
    }
    text = ply_details(values)
    assert "e5 by LLM (m)" in text
    assert "illegal attempts: 2" in text
    assert "System 1 suggested; its top moves:" in text
    assert "  e5 60%" in text
    played = {
        **meta,
        "status": "played",
        "shortlist": [],
        "top": [{"uci": "e7e5", "probability": 0.97}],
    }
    values["plies"][1]["meta"] = {"SystemOneMiddleware": played}
    values["plies"][1]["uci"] = "e7e5"
    text = ply_details(values)
    assert "System 1 played; its top moves:" in text
    assert " ▸e5 97%" in text  # the move played is marked
    skipped = {"status": "skipped", "error": "down"}
    values["plies"][1]["meta"] = {"SystemOneMiddleware": skipped}
    assert "System 1 skipped: down" in ply_details(values)
    values["turns"] = []
    assert "cost —" in ply_details(values)
    assert ply_details({}) == "The agent hasn't moved yet."


def test_status_text():
    white = chess.WHITE
    assert status_text({}, human=white, running=False, failed=None) == "Your move."
    assert status_text({}, human=chess.BLACK, running=False, failed=None).startswith("Press")
    assert status_text({"moves": ["e2e4"]}, human=white, running=False, failed=None) == (
        "The agent's move."
    )
    assert "thinking" in status_text({}, human=white, running=True, failed=None)
    pending = {"turns": [{"status": "pending"}]}
    assert status_text(pending, human=white, running=False, failed=None).endswith("to retry.")
    over = {"outcome": {"kind": "draw", "reason": "stalemate"}}
    assert (
        status_text(over, human=white, running=False, failed=None) == "Draw by stalemate. 1/2-1/2"
    )


def test_board_of_and_options():
    assert board_of({"moves": ["e2e4"]}).fen().split()[1] == "b"
    assert describe_settings(ChessContext()) == (
        "semif-qwen3.5-4b + langsmith:baseten/zai-org/GLM-5.3-Flash"
    )
    assert (
        describe_settings(ChessContext(policy="llm", reasoning_effort="medium"))
        == "langsmith:baseten/zai-org/GLM-5.3-Flash (medium)"
    )
    assert describe_settings(ChessContext(policy="systemone")).startswith("System 1 alone")
