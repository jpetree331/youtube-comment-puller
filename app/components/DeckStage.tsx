import type { CommentItem } from "@/lib/types";
import { CommentCard } from "./CommentCard";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

interface Props {
  variant: "main" | "focus";
  deckId: string;
  comment: CommentItem | null;
  index: number;
  total: number;
  zoom: number;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Prev-arrow · card · next-arrow, shared by the main deck view and the
 * full-window focus overlay. `variant` only swaps the wrapper classes; the nav
 * wiring and card are identical. The card key includes the deck id and variant
 * so switching decks or entering focus mounts a fresh card (resetting the
 * avatar-error state and replaying the pop animation).
 */
export function DeckStage({ variant, deckId, comment, index, total, zoom, onPrev, onNext }: Props) {
  const hasDeck = comment != null;
  const isFocus = variant === "focus";

  return (
    <div className={isFocus ? "focus-stage" : "stage"}>
      <button
        className="nav"
        onClick={onPrev}
        disabled={!hasDeck || index === 0}
        aria-label="Previous comment"
      >
        <ChevronLeftIcon />
      </button>

      <div className={isFocus ? "focus-card" : `cardhold${hasDeck ? "" : " empty"}`}>
        {hasDeck ? (
          <CommentCard
            key={`${variant}:${deckId}:${index}`}
            comment={comment}
            index={index}
            total={total}
            zoom={zoom}
          />
        ) : (
          <div className="placeholder">
            <div className="big">No deck loaded</div>
            <div className="lil">Paste a video above and pull its top comments.</div>
          </div>
        )}
      </div>

      <button
        className="nav"
        onClick={onNext}
        disabled={!hasDeck || index === total - 1}
        aria-label="Next comment"
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}
