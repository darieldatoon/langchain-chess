// A reviewed game as PGN: its grades as NAGs and evaluations. Pure.
import {
  fenOrStart,
  type ChessValues,
  type Opening,
  type PgnGame,
  type PgnMeta,
} from "@langchain-chess/chess-ui";
import { sideLabel, type Game } from "./games";
import type { GameReview } from "./review";
import { recordsByPly } from "./values";

export function reviewPgn(
  game: Game,
  values: ChessValues,
  review: GameReview | null,
  opening: Opening | null,
): { game: PgnGame; meta: PgnMeta } {
  const plies = values.plies ?? [];
  const moves = values.moves ?? [];
  return {
    game: {
      startFen: fenOrStart(values.start_fen),
      moves,
      // A missing record's SAN is replayed.
      sans: recordsByPly(plies, moves.length).map((p) => p?.san),
      outcome: values.outcome ?? null,
      opening,
      // The evaluation after each move: evals are one per position, the start included.
      grades: review?.plies.map((p, i) => ({ quality: p.quality, eval: review.evals[i + 1] })),
    },
    meta: {
      site: "LangSmith",
      date: new Date(game.startedAt),
      white: sideLabel(game, plies, "white"),
      black: sideLabel(game, plies, "black"),
      comment: `${game.matchup} · Thread ${game.threadId}`,
    },
  };
}
