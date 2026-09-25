import pytest

from langchain_chess_systemone.tournament import (
    FINAL,
    MAX_QUESTIONS,
    Batch,
    drive,
    plan,
    quotas,
    split_heats,
)
from langchain_chess_systemone.types import Answers, Aux
from langchain_chess_systemone.validate import validate_choice


def moves(n):
    return [f"m{i:03d}" for i in range(n)]


def answer_first_listed(batch: Batch) -> Answers:
    """Each Choice prefers its options in listed (shuffled) order."""
    choices = {}
    for spec in batch.choices:
        weights = list(range(len(spec.options), 0, -1))
        total = sum(weights)
        probs = {u: w / total for u, w in zip(spec.options, weights, strict=True)}
        choices[spec.name] = validate_choice(spec.options, probs, 0.5)
    return Answers(choices=choices, aux=Aux(eval_score=3.0) if batch.with_aux else Aux())


def run(options, cap, seed=7):
    batches: list[Batch] = []

    def ask(batch):
        assert len(batch.choices) <= MAX_QUESTIONS
        for spec in batch.choices:
            assert 2 <= len(spec.options) <= cap
        batches.append(batch)
        return answer_first_listed(batch)

    return drive(plan(options, cap, seed), ask), batches


def test_split_heats_is_balanced():
    assert [len(h) for h in split_heats(moves(30), 16)] == [15, 15]
    assert [len(h) for h in split_heats(moves(33), 16)] == [11, 11, 11]
    assert [len(h) for h in split_heats(moves(3), 2)] == [2, 1]
    assert [m for heat in split_heats(moves(218), 16) for m in heat] == moves(218)


def test_quotas():
    assert quotas(2, 16) == [8, 8]
    assert quotas(3, 16) == [6, 5, 5]
    assert quotas(5, 4) == [1, 1, 1, 1, 1]


def test_thirty_moves_at_a_cap_of_sixteen():
    result, batches = run(moves(30), 16)
    heats, final = batches
    assert [len(spec.options) for spec in heats.choices] == [15, 15]
    assert not heats.with_aux
    assert final.with_aux
    assert [spec.name for spec in final.choices] == [FINAL]
    assert len(final.choices[0].options) == 16
    tournament = result.tournament
    assert tournament["rounds"] == 2
    assert len(tournament["finalists"]) == 16
    assert result.aux.eval_score == 3.0
    by_uci = {m["uci"]: m for m in tournament["moves"]}
    assert len(by_uci) == 30
    finalists = [m for m in tournament["moves"] if m["finalist"]]
    assert {m["stages"][0]["heat"] for m in finalists} == {1, 2}
    assert all(len(m["stages"]) == 2 for m in finalists)
    eliminated = [m for m in tournament["moves"] if not m["finalist"]]
    assert all(len(m["stages"]) == 1 and m["stages"][0]["rank"] > 8 for m in eliminated)


def test_a_bye_is_recorded_and_never_sent():
    result, batches = run(moves(3), 2)
    assert [len(s.options) for s in batches[0].choices] == [2]
    byes = [m for m in result.tournament["moves"] if m["stages"][0]["bye"]]
    assert len(byes) == 1
    assert byes[0]["stages"][0]["probability"] == 1.0


def test_small_caps_recurse_and_terminate():
    result, batches = run(moves(20), 4)
    assert len(batches) >= 3
    assert result.tournament["rounds"] == len(batches)
    assert len(result.final.ranked) <= 4


def test_many_heats_are_split_across_requests():
    result, batches = run(moves(200), 3)
    first_round = [b for b in batches if b.choices[0].name.startswith("heat_1_")]
    assert len(first_round) == 3  # 67 heats in chunks of 32
    assert result.tournament["max_options"] == 3


def test_the_shuffle_is_seeded():
    a, _ = run(moves(30), 16, seed=1)
    b, _ = run(moves(30), 16, seed=1)
    c, _ = run(moves(30), 16, seed=2)
    assert a.tournament == b.tournament
    assert a.tournament["finalists"] != c.tournament["finalists"]


@pytest.mark.parametrize("n", [17, 31, 64, 218])
def test_the_final_always_fits(n):
    result, batches = run(moves(n), 16)
    assert len(batches[-1].choices[0].options) <= 16
    assert sum(m["finalist"] for m in result.tournament["moves"]) == len(
        result.tournament["finalists"]
    )
