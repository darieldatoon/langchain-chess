import math

import pytest

from langchain_chess_systemone.validate import MalformedChoice, validate_choice

OPTIONS = ("e2e4", "d2d4", "g1f3")


def test_ranks_ties_by_option_order_and_fills_missing_labels():
    result = validate_choice(OPTIONS, {"d2d4": 0.5, "g1f3": 0.5}, 0.3)
    assert [(c.uci, c.probability) for c in result.ranked] == [
        ("d2d4", 0.5),
        ("g1f3", 0.5),
        ("e2e4", 0.0),
    ]
    assert result.confidence == 0.3


def test_small_drift_is_renormalized():
    result = validate_choice(OPTIONS, {"e2e4": 0.6, "d2d4": 0.25, "g1f3": 0.1505}, 0.5)
    assert math.isclose(sum(c.probability for c in result.ranked), 1.0)


@pytest.mark.parametrize(
    ("probabilities", "confidence", "match"),
    [
        ({"e2e4": 1.2, "d2d4": -0.2}, 0.5, "within"),
        ({"e2e4": float("nan"), "d2d4": 1.0}, 0.5, "within"),
        ({"e2e4": 0.0, "d2d4": 0.0}, 0.5, "sum to"),
        ({"e2e4": 6.0, "d2d4": 2.5, "g1f3": 1.5}, 0.5, "within"),
        ({"e2e4": 0.5, "d2d4": 0.4}, 0.5, "sum to"),
        ({"e2e4": 1.0, "a2a3": 0.0}, 0.5, "not options"),
        ({"e2e4": 1.0}, float("nan"), "confidence"),
        ({"e2e4": 1.0}, 1.5, "confidence"),
    ],
)
def test_malformed_choices(probabilities, confidence, match):
    with pytest.raises(MalformedChoice, match=match):
        validate_choice(OPTIONS, probabilities, confidence)


def test_two_decimal_rounding_is_tolerated_per_option():
    options = tuple(f"m{i}" for i in range(33))
    rounded = {uci: 0.03 for uci in options}  # sums to 0.99
    result = validate_choice(options, rounded, 0.5)
    assert math.isclose(sum(c.probability for c in result.ranked), 0.99)
    with pytest.raises(MalformedChoice, match="sum to"):
        validate_choice(options[:3], {"m0": 0.5, "m1": 0.4, "m2": 0.3}, 0.5)
    with pytest.raises(MalformedChoice, match="sum to"):
        validate_choice(options[:3], {"m0": 0.5, "m1": 0.4, "m2": 0.0501}, 0.5)


def test_a_rounded_away_shortfall_is_not_scaled_up():
    options = tuple(f"m{i}" for i in range(33))
    result = validate_choice(options, {"m0": 0.85}, 0.5)
    assert result.ranked[0].probability == 0.85


def test_all_zero_is_rejected_however_many_options():
    options = tuple(f"m{i}" for i in range(200))
    with pytest.raises(MalformedChoice, match="sum to"):
        validate_choice(options, {}, 0.5)
