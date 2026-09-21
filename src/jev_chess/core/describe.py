"""Render MoveFacts as deterministic text. Templates only; no model involved.

Phrase order is fixed so the same facts always produce the same string. Rich style is
the default for Jev option descriptions because prior art found description richness
to be the largest single quality lever.
"""

from jev_chess.core.types import DescriptionStyle, MoveFacts


def _tactical_phrases(facts: MoveFacts) -> list[str]:
    phrases: list[str] = []
    if facts.is_mate:
        phrases.append("checkmate")
    elif facts.gives_check:
        phrases.append("gives check")
    if facts.captured is not None:
        suffix = " en passant" if facts.is_en_passant else ""
        phrases.append(f"captures {facts.captured} ({facts.capture_value}){suffix}")
    if facts.see_gain < 0:
        phrases.append(f"loses material in the exchange ({facts.see_gain})")
    elif facts.see_gain > 0:
        phrases.append(f"wins material in the exchange (+{facts.see_gain})")
    return phrases


def _safety_phrase(facts: MoveFacts) -> str:
    if facts.attackers_after == 0:
        return "square safe"
    defended = f"defended {facts.defenders_after}x" if facts.defenders_after else "undefended"
    return f"square attacked {facts.attackers_after}x, {defended}"


def _movement_phrase(facts: MoveFacts) -> str:
    if facts.castle is not None:
        return f"castles {facts.castle}, king to {facts.to_square}"
    text = f"{facts.piece} {facts.from_square} to {facts.to_square}"
    if facts.promotion is not None:
        text += f", promotes to {facts.promotion}"
    return text


def describe(facts: MoveFacts, style: DescriptionStyle = "rich") -> str:
    if style == "terse":
        tactical = _tactical_phrases(facts)
        return f"{facts.san}: {tactical[0]}" if tactical else facts.san
    parts = [_movement_phrase(facts), *_tactical_phrases(facts), _safety_phrase(facts)]
    return f"{facts.san}: " + ", ".join(parts)


def describe_all(facts: tuple[MoveFacts, ...], style: DescriptionStyle = "rich") -> dict[str, str]:
    """UCI to description, ready to use as Jev Choice criteria."""
    return {f.uci: describe(f, style) for f in facts}
