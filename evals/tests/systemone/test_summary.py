import pytest

from langchain_chess_evals.systemone.scoring import ROW_METRICS
from langchain_chess_evals.systemone.summary import (
    GATE_THRESHOLDS,
    Scored,
    calibration,
    gate_table,
    groups,
    headline_table,
    summarize,
)


def scored(correct, *, band="<1200", phase="opening", legal=20, margin=0.5, confidence=0.5):
    scores: dict[str, float | None] = dict.fromkeys(ROW_METRICS, 0.0)
    scores |= {"recall@1": float(correct), "finalist_recall": None}
    return Scored(scores, band, phase, legal, {"margin": margin, "confidence": confidence})


ROWS = [
    scored(True, legal=10, margin=0.95),
    scored(True, band="2400+", margin=0.91),
    scored(False, phase="endgame", margin=0.2),
    scored(False, band="2400+", margin=None, confidence=None),
]


def test_groups():
    found = groups(ROWS)
    assert len(found["all"]) == 4
    assert len(found["band=2400+"]) == 2
    assert found["band=1600-1999"] == []
    assert len(found["phase=endgame"]) == 1
    assert len(found["legal<=16"]) == 1
    assert len(found["legal>16"]) == 3


def test_gate_table_counts_every_move_in_the_share_kept():
    table = gate_table(ROWS, "margin")
    assert table["gate.margin>=0.9.kept"] == 0.5
    assert table["gate.margin>=0.9.accuracy"] == 1.0
    assert table["gate.margin>=0.5.kept"] == 0.5
    assert table["gate.margin>=0.95.kept"] == 0.25
    assert len(table) == 2 * len(GATE_THRESHOLDS)
    empty = gate_table([], "margin")
    assert set(empty.values()) == {None}


def test_calibration_puts_certainty_in_the_last_decile():
    rows = [
        scored(True, confidence=1.0),
        scored(False, confidence=0.05),
        scored(True, confidence=0.07),
    ]
    table = calibration(rows, "confidence")
    assert table["calibration.confidence.0.9-1.0.n"] == 1.0
    assert table["calibration.confidence.0.9-1.0.accuracy"] == 1.0
    assert table["calibration.confidence.0.0-0.1.n"] == 2.0
    assert table["calibration.confidence.0.0-0.1.accuracy"] == 0.5
    assert table["calibration.confidence.0.5-0.6.accuracy"] is None


def test_summarize_splits_every_metric():
    summary = summarize(ROWS)
    assert summary["n|all"] == 4.0
    assert summary["recall@1|all"] == 0.5
    assert summary["recall@1|band=2400+"] == 0.5
    assert summary["recall@1|band=1600-1999"] is None
    assert summary["recall@1|legal<=16"] == 1.0
    assert summary["finalist_recall|all"] is None
    assert summary["gate.margin>=0.9.kept|legal>16"] == pytest.approx(1 / 3)
    assert "gate.margin>=0.9.kept|band=2400+" not in summary
    assert summary["calibration.confidence.0.4-0.5.n|all"] == 0.0
    assert summary["calibration.confidence.0.5-0.6.n|all"] == 3.0


def test_headline_table():
    table = headline_table([("jev-rich", "https://x", summarize(ROWS)), ("bare", None, {})])
    lines = table.splitlines()
    assert lines[0].startswith("| Run | recall@1 | recall@5 |")
    assert lines[2].startswith("| [jev-rich](https://x) | 50.0% | 0.0% |")
    assert "| 0 |" in lines[2]
    assert lines[3].startswith("| bare | - | - |")
