// The web game as PGN. Pure.
import type { Opening, PgnGame, PgnMeta, Side, TurnRecord } from "@langchain-chess/chess-ui";
import { changedKnobs, opponentLabel, type GameRecord } from "./setup";

export interface ExportSource {
  startFen: string;
  moves: readonly string[];
  plies: readonly { san: string }[];
  turns: readonly TurnRecord[];
  outcome: PgnGame["outcome"];
  record: GameRecord | null;
  threadId: string | null;
}

/** A side's name on its strip and in the PGN: "You", the opponent, or its colour. */
export function playerName(record: GameRecord | null, side: Side): string {
  if (!record) return side === "white" ? "White" : "Black";
  return side === record.side ? "You" : opponentLabel(record.context);
}

export function pgnOf(
  game: ExportSource,
  opening: Opening | null,
  site: string,
): { game: PgnGame; meta: PgnMeta } {
  const started = game.turns[0]?.calls[0]?.called_at;
  const comment = [
    ...(game.record
      ? [opponentLabel(game.record.context), ...changedKnobs(game.record.context)]
      : []),
    ...(game.threadId ? [`Thread ${game.threadId}`] : []),
  ].join(" · ");
  return {
    game: {
      startFen: game.startFen,
      moves: game.moves,
      sans: game.plies.map((p) => p.san),
      outcome: game.outcome,
      opening,
    },
    meta: {
      site,
      date: started ? new Date(started) : null,
      white: playerName(game.record, "white"),
      black: playerName(game.record, "black"),
      comment: comment || null,
    },
  };
}

/** `langchain-chess-<thread>.pgn`, or without the thread before it has one. */
export function pgnFileName(threadId: string | null): string {
  return threadId ? `langchain-chess-${threadId}.pgn` : "langchain-chess.pgn";
}
