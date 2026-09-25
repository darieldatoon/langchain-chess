"""Errors raised by the chess agent."""


class ChessContractError(RuntimeError):
    """A middleware broke the extension contract, or the agent was misconfigured."""


class ContextBudgetError(RuntimeError):
    """The provider rejected a move request as too long for the model's context window."""
