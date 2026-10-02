"""The web app's Macaw colours as two Textual themes, `langchain` (dark) and `langchain-light`.

Textual can't read the web app's CSS variables, so each value is copied by hand; the comment
names the Macaw token or the `packages/chess-ui/src/styles.css` variable it comes from.
"""

from textual.theme import Theme

DARK_BOARD = {
    # Darker than the web's --board-light (--border-strong, #cbd5e1): block-art pieces have no
    # outline, so white ones need a mid-tone square to stand on. Do not lighten it.
    "board-light": "#a9b6c8",
    "board-dark": "#519deb",  # --board-dark: --bg-brand 60% into --border-strong
    "board-last-move": "#e7ce8e",  # --board-last-move
    "board-selected": "#0078f1",  # --bg-brand; the web fills it at 45% over the square
    "board-check": "#f04438",  # --bg-error-strong
    # No web equivalent: the web app has no keyboard cursor, and rings its capture targets.
    "board-cursor": "#c5b4f0",  # --text-purple
    "board-capture": "#fec84b",  # --bg-warning-strong
    "board-target": "#09090f",  # --board-move-dot: --bg-surface-level-1
    "board-white-piece": "#ffffff",
    "board-black-piece": "#09090f",  # --bg-surface-level-1
    "board-label": "#cbd5e1",  # --text-tertiary
    # Who played each move, as the move list's SOURCE_CLASSES (packages/chess-ui).
    "move-systemone": "#0c336a",  # --bg-brand-subtle
    "move-systemone-text": "#5fbef8",  # --text-brand-primary
    "move-llm": "#190d38",  # --bg-purple
    "move-llm-text": "#c5b4f0",  # --text-purple
    "move-forced": "#1b2030",  # --bg-surface-level-3
    "move-forced-text": "#e2e8f0",  # --text-secondary
    "move-active": "#0078f1",  # ACTIVE_MOVE: --bg-brand
    "move-active-text": "#ffffff",  # --text-brand-on-fill
}

LIGHT_BOARD = {
    # The dark board's light square, for the same reason: white pieces vanish on #edf2f7.
    "board-light": "#a9b6c8",
    "board-dark": "#6ba9e9",  # --board-dark: --bg-brand 55% into --bg-surface-level-3
    "board-last-move": "#fef0c7",  # --board-last-move: --bg-warning-subtle
    "board-selected": "#006ddd",  # --bg-brand; the web fills it at 35% over the square
    "board-check": "#d92d20",  # --bg-error-strong
    "board-cursor": "#e3d9ff",  # --bg-purple
    "board-capture": "#cd6002",  # --bg-warning-strong
    "board-target": "#0f172a",  # --board-move-dot: --text-primary
    "board-white-piece": "#ffffff",
    "board-black-piece": "#0f172a",  # --text-primary
    "board-label": "#475569",  # --text-tertiary
    "move-systemone": "#e5f4ff",  # --bg-brand-subtle
    "move-systemone-text": "#0d3d77",  # --text-brand-primary
    "move-llm": "#e3d9ff",  # --bg-purple
    "move-llm-text": "#3b2560",  # --text-purple
    "move-forced": "#edf2f7",  # --bg-surface-level-3
    "move-forced-text": "#334155",  # --text-secondary
    "move-active": "#006ddd",  # ACTIVE_MOVE: --bg-brand
    "move-active-text": "#ffffff",  # --text-brand-on-fill
}

DARK = Theme(
    name="langchain",
    primary="#0078f1",  # --bg-brand
    secondary="#5fbef8",  # --text-brand-primary
    accent="#c5b4f0",  # --text-purple
    warning="#fec84b",  # --bg-warning-strong
    error="#f04438",  # --bg-error-strong
    success="#75e0a7",  # --bg-success-strong
    foreground="#f5f8fb",  # --text-primary
    background="#09090f",  # --bg-surface-level-1
    surface="#111521",  # --bg-surface-level-2
    panel="#1b2030",  # --bg-surface-level-3
    dark=True,
    variables={
        **DARK_BOARD,
        "border": "#393f55",  # --border-primary
        "text-muted": "#cbd5e1",  # --text-tertiary
    },
)

LIGHT = Theme(
    name="langchain-light",
    primary="#006ddd",  # --bg-brand
    secondary="#0d3d77",  # --text-brand-primary
    accent="#3b2560",  # --text-purple
    warning="#cd6002",  # --bg-warning-strong
    error="#d92d20",  # --bg-error-strong
    success="#079455",  # --bg-success-strong
    foreground="#0f172a",  # --text-primary
    background="#ffffff",  # --bg-surface-level-1
    surface="#f5f8fb",  # --bg-surface-level-2
    panel="#edf2f7",  # --bg-surface-level-3
    dark=False,
    variables={
        **LIGHT_BOARD,
        "border": "#cbd5e1",  # --border-primary
        "text-muted": "#475569",  # --text-tertiary
    },
)

THEMES = (DARK, LIGHT)
