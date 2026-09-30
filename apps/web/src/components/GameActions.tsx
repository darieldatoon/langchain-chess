import { Button } from "@langchain/macaw-components/Button";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { Text } from "@langchain/macaw-components/Text";
import { ArrowsDownUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowsDownUp";
import { FlagIcon } from "@phosphor-icons/react/dist/ssr/Flag";
import { HandshakeIcon } from "@phosphor-icons/react/dist/ssr/Handshake";
import { outcomeLine, TOUCH_TARGET, type Outcome, type Side } from "@langchain-chess/chess-ui";
import { useEffect, useState, type ReactNode } from "react";
import { resultHeadline } from "../format";

interface ActionsProps {
  /** Phones: icons with labels as names and tooltips, to fit the bar. */
  compact: boolean;
  canResign: boolean;
  canOfferDraw: boolean;
  /** A draw offer in flight. */
  offering: boolean;
  /** The answer to this position's draw offer, until the next move. */
  answer: string | null;
  onResign: () => void;
  onOfferDraw: () => void;
  onFlip: () => void;
}

/** ⚑ Resign, ½ Offer draw and ⇅ Flip. Resigning asks first, in place: Lichess's two-step. */
export function GameActions({
  compact,
  canResign,
  canOfferDraw,
  offering,
  answer,
  onResign,
  onOfferDraw,
  onFlip,
}: ActionsProps) {
  const [confirming, setConfirming] = useState(false);
  if (confirming && !canResign) setConfirming(false);
  useEffect(() => {
    if (!confirming) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirming(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  if (confirming) {
    return (
      <div
        role="group"
        aria-label="confirm resignation"
        className="flex flex-wrap items-center gap-space-2"
      >
        <Text variant="sm" weight="medium" as="span">
          Resign this game?
        </Text>
        <div className="flex flex-wrap gap-space-2">
          <Button
            color="error"
            size="sm"
            className={TOUCH_TARGET}
            onClick={() => {
              setConfirming(false);
              onResign();
            }}
          >
            Confirm resignation
          </Button>
          <Button
            variant="outlined"
            color="secondary"
            size="sm"
            className={TOUCH_TARGET}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const action = (icon: typeof FlagIcon, label: string, onClick: () => void, disabled: boolean) =>
    compact ? (
      <IconButton
        icon={icon}
        label={label}
        size="md"
        variant="outlined"
        color="secondary"
        className={TOUCH_TARGET}
        disabled={disabled}
        onClick={onClick}
      />
    ) : (
      <Button
        variant="plain"
        color="secondary"
        size="sm"
        leftDecorator={icon}
        className={TOUCH_TARGET}
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </Button>
    );
  const row = (
    <div className="flex flex-wrap items-center gap-space-1" aria-label="game actions">
      {action(FlagIcon, "Resign", () => setConfirming(true), !canResign)}
      {action(HandshakeIcon, "Offer draw", onOfferDraw, !canOfferDraw || offering)}
      {action(ArrowsDownUpIcon, compact ? "Flip board" : "Flip", onFlip, false)}
    </div>
  );
  const status = offering ? "Offering a draw…" : answer;
  return (
    <div className="flex flex-col gap-space-1">
      {row}
      {status && (
        <Text variant="sm" color="secondary" role="status">
          {status}
        </Text>
      )}
    </div>
  );
}

interface OverProps {
  /** Null for a game this browser can only show: no side, no rematch. */
  humanSide: Side | null;
  onRematch: () => void;
  onNewGame: () => void;
  /** More actions, after New game: Analyze on Lichess. */
  children?: ReactNode;
}

/** The result from the reader's side, then why: the table's first line once the game is over. */
export function ResultHeadline({ outcome, humanSide }: { outcome: Outcome; humanSide: Side }) {
  return (
    <Text variant="sm" as="p" aria-label="headline" className="px-space-1">
      <strong>{resultHeadline(outcome, humanSide)}</strong> · {outcomeLine(outcome)}
    </Text>
  );
}

/** After the game, the action row gives way to a stack: Rematch first, as Lichess's follow-up. */
export function GameOver({ humanSide, onRematch, onNewGame, children }: OverProps) {
  return (
    <div aria-label="game over">
      <div className="flex flex-col items-stretch gap-space-2">
        {humanSide && (
          <Button color="primary" size="sm" className={TOUCH_TARGET} onClick={onRematch}>
            Rematch
          </Button>
        )}
        <Button
          variant="outlined"
          color="secondary"
          size="sm"
          className={TOUCH_TARGET}
          onClick={onNewGame}
        >
          New game
        </Button>
        {children}
      </div>
    </div>
  );
}
