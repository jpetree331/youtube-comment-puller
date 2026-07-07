// Client-side persistence for pulled decks and the passcode, backed by
// localStorage. On the real Vercel domain this is durable (unlike the Claude
// artifact sandbox the original HTML had to tiptoe around). Every access is
// guarded so SSR / private-mode / disabled-storage never throws.

import type { CommentItem, PullMode } from "./types";

export interface DeckIndexEntry {
  id: string;
  title: string;
  at: number;
}

// Extra context about how a deck was pulled, cached so a reopened deck shows the
// right total/mode without another API call.
export interface DeckMeta {
  commentCount?: number | null;
  mode?: PullMode;
  count?: number;
}

export interface StoredDeck extends DeckMeta {
  title: string;
  comments: CommentItem[];
  at: number;
}

const INDEX_KEY = "deck_index";
const PASSCODE_KEY = "cd_passcode";
const ZOOM_KEY = "cd_zoom";
const INDEX_CAP = 40;
const deckKey = (id: string) => `deck:${id}`;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage full or unavailable — non-fatal
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // non-fatal
  }
}

/** Most-recent-first list of previously pulled decks. */
export function loadIndex(): DeckIndexEntry[] {
  const raw = safeGet(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DeckIndexEntry[]) : [];
  } catch {
    return [];
  }
}

/** Cache a pulled deck (with how it was pulled) and move it to the top of the recent index. */
export function saveDeck(
  id: string,
  title: string,
  comments: CommentItem[],
  meta: DeckMeta = {},
): DeckIndexEntry[] {
  const at = Date.now();
  safeSet(deckKey(id), JSON.stringify({ title, comments, at, ...meta } satisfies StoredDeck));

  const index = [
    { id, title: title || id, at },
    ...loadIndex().filter((x) => x.id !== id),
  ].slice(0, INDEX_CAP);

  safeSet(INDEX_KEY, JSON.stringify(index));
  return index;
}

/** Reopen a cached deck by video ID (null if it was never saved / evicted). */
export function getDeck(id: string): StoredDeck | null {
  const raw = safeGet(deckKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredDeck;
  } catch {
    return null;
  }
}

export function getPasscode(): string {
  return safeGet(PASSCODE_KEY) ?? "";
}

export function setPasscode(value: string): void {
  safeSet(PASSCODE_KEY, value);
}

export function clearPasscode(): void {
  safeRemove(PASSCODE_KEY);
}

/** Comment-text zoom factor (1 = 100%). Persisted across sessions. */
export function getZoom(): number {
  const v = Number(safeGet(ZOOM_KEY));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export function setZoom(value: number): void {
  safeSet(ZOOM_KEY, String(value));
}
