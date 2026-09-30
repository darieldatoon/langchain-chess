// A game as PGN, and the Lichess link that opens it. Pure. chess.js can write headers and
// comments but not NAGs, so the movetext is written here; tests read it back with chess.js.
import { fullmoveNumber, normalizeFen, replay, sideToMove } from "./chess";
import type { Opening } from "./openings";
import { START_FEN, type Eval, type Outcome, type Quality } from "./types";

export interface PgnGame {
  startFen: string;
  /** UCI, the whole recorded game whatever the reader is looking at. */
  moves: readonly string[];
  /** The recorded SAN per ply; a missing one is replayed. */
  sans?: readonly (string | undefined)[];
  outcome: Outcome | null;
  opening: Opening | null;
  /** Review only, per ply: the move's grade and the evaluation after it. */
  grades?: readonly ({ quality: Quality; eval: Eval } | undefined)[];
}

export interface PgnMeta {
  site: string;
  /** Null gives "????.??.??". */
  date: Date | null;
  white: string;
  black: string;
  /** The game's leading comment. */
  comment: string | null;
}

const NAGS: Partial<Record<Quality, string>> = { inaccuracy: "$6", mistake: "$2", blunder: "$4" };
const WIDTH = 80;

const header = (value: string) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
const comment = (text: string) =>
  `{${text
    .replaceAll("{", "(")
    .replaceAll("}", ")")
    .replace(/\s*\n\s*/g, " ")}}`;

export function pgnResult(outcome: Outcome | null): string {
  if (!outcome) return "*";
  if (outcome.kind === "draw") return "1/2-1/2";
  return outcome.winner === "white" ? "1-0" : "0-1";
}

function pgnDate(date: Date | null): string {
  if (!date) return "????.??.??";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`;
}

/** Pawns to two decimals from White's side, or `#3` / `#-3` for a mate. */
export function evalTag(e: Eval): string | null {
  if ("cp" in e) return `[%eval ${(e.cp / 100).toFixed(2)}]`;
  if (e.mate === 0) return null;
  return `[%eval #${e.winner === "white" ? "" : "-"}${e.mate}]`;
}

/** A comment breaks at its spaces, but an `[%eval ...]` command stays whole. */
const words = (token: string) =>
  token.startsWith("{") ? token.match(/\{?\[%[^\]]*\]\}?|\S+/g)! : [token];

function wrap(tokens: readonly string[]): string {
  const lines: string[] = [];
  let line = "";
  for (const token of tokens.flatMap(words)) {
    if (line && line.length + 1 + token.length > WIDTH) {
      lines.push(line);
      line = token;
    } else {
      line = line ? `${line} ${token}` : token;
    }
  }
  // The result token is always last, so the final line is never empty.
  lines.push(line);
  return lines.join("\n");
}

export function toPgn(game: PgnGame, meta: PgnMeta): string {
  const root = normalizeFen(game.startFen);
  const result = pgnResult(game.outcome);
  const headers: [string, string][] = [
    ["Event", "LangChain Chess"],
    ["Site", meta.site],
    ["Date", pgnDate(meta.date)],
    ["Round", "-"],
    ["White", meta.white],
    ["Black", meta.black],
    ["Result", result],
    ...(root === START_FEN
      ? []
      : ([
          ["SetUp", "1"],
          ["FEN", root],
        ] as [string, string][])),
    ["Termination", game.outcome ? "Normal" : "Unterminated"],
    ["Annotator", "LangChain Chess"],
  ];

  const replayed = replay(root, game.moves).sans;
  const opening = game.opening && `${game.opening.eco} ${game.opening.name}`;
  const tokens: string[] = [];
  // One comment per position: chess.js, which the tests read back with, rejects two in a row.
  let notes: string[] = [];
  const flush = () => {
    if (notes.length === 0) return false;
    tokens.push(comment(notes.join(" ")));
    notes = [];
    return true;
  };
  if (meta.comment) notes.push(meta.comment);
  if (opening && game.opening?.reachedIndex === 0) notes.push(opening);
  const first = fullmoveNumber(root);
  const offset = sideToMove(root) === "black" ? 1 : 0;
  // A Black move is numbered `N...` at the start and after any comment, as PGN readers expect.
  let numbered = false;
  game.moves.forEach((uci, i) => {
    if (flush()) numbered = false;
    const slot = i + offset;
    const number = first + Math.floor(slot / 2);
    if (slot % 2 === 0) tokens.push(`${number}.`);
    else if (!numbered) tokens.push(`${number}...`);
    numbered = true;
    tokens.push(game.sans?.[i] ?? replayed[i] ?? uci);
    const grade = game.grades?.[i];
    const nag = grade && NAGS[grade.quality];
    if (nag) tokens.push(nag);
    const tag = grade && evalTag(grade.eval);
    if (tag) notes.push(tag);
    if (opening && game.opening?.reachedIndex === i + 1) notes.push(opening);
  });
  flush();
  tokens.push(result);

  const head = headers.map(([key, value]) => `[${key} "${header(value)}"]`).join("\n");
  return `${head}\n\n${wrap(tokens)}\n`;
}

export interface LichessLink {
  url: string;
  /** The game was too long for a link, so it opens the position instead. */
  fallback: boolean;
}

/** Over this, a link is too long to open reliably. */
export const LICHESS_URL_LIMIT = 8000;

export function lichessUrl(pgn: string, fen: string): LichessLink {
  const url = `https://lichess.org/analysis/pgn/${encodeURIComponent(pgn)}`;
  if (url.length <= LICHESS_URL_LIMIT) return { url, fallback: false };
  return { url: `https://lichess.org/analysis/${fen.replaceAll(" ", "_")}`, fallback: true };
}

/** Copies text, and says whether it worked: Macaw's CopyButton swallows a refusal. */
export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard,
): Promise<boolean> {
  try {
    await clipboard!.writeText(text);
    return true;
  } catch {
    return false;
  }
}
