// Client-side persistence for pulled decks and the passcode, backed by
// localStorage. On the real Vercel domain this is durable (unlike the Claude
// artifact sandbox the original HTML had to tiptoe around). Every access is
// guarded so SSR / private-mode / disabled-storage never throws.

import type { CommentItem, PullMode } from "./types";

// One Recent-dropdown row. Decks are cached per video + pull mode, so the same
// video pulled two different ways keeps two separate, distinguishable entries.
export interface DeckIndexEntry {
  key: string; // full localStorage key of the deck payload (deck:<id>:<mode>)
  id: string;
  title: string;
  mode: PullMode;
  count: number; // number of cards in the deck
  commentCount?: number | null;
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
const deckKey = (id: string, mode: PullMode) => `deck:${id}:${mode}`;

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

/** Normalize an index row, upgrading legacy {id,title,at} entries (pre-modes). */
function normalizeEntry(x: unknown): DeckIndexEntry | null {
  if (!x || typeof x !== "object") return null;
  const e = x as Record<string, unknown>;
  const at = typeof e.at === "number" ? e.at : 0;

  // Current format: explicit storage key + mode.
  if (typeof e.key === "string" && typeof e.mode === "string") {
    return {
      key: e.key,
      id: typeof e.id === "string" ? e.id : "",
      title: typeof e.title === "string" ? e.title : "",
      mode: e.mode as PullMode,
      count: typeof e.count === "number" ? e.count : 0,
      commentCount: typeof e.commentCount === "number" ? e.commentCount : null,
      at,
    };
  }

  // Legacy format {id,title,at}: stored under deck:<id>, always a "likes" pull.
  if (typeof e.id === "string") {
    return {
      key: `deck:${e.id}`,
      id: e.id,
      title: typeof e.title === "string" ? e.title : e.id,
      mode: "likes",
      count: 0,
      commentCount: null,
      at,
    };
  }
  return null;
}

/** Most-recent-first list of previously pulled decks. */
export function loadIndex(): DeckIndexEntry[] {
  const raw = safeGet(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEntry).filter((x): x is DeckIndexEntry => x !== null);
  } catch {
    return [];
  }
}

/** Cache a pulled deck (keyed by video + mode) and move it to the top of the index. */
export function saveDeck(
  id: string,
  title: string,
  comments: CommentItem[],
  meta: DeckMeta = {},
): DeckIndexEntry[] {
  const at = Date.now();
  const mode: PullMode = meta.mode ?? "likes";
  const key = deckKey(id, mode);
  safeSet(key, JSON.stringify({ title, comments, at, ...meta } satisfies StoredDeck));

  const entry: DeckIndexEntry = {
    key,
    id,
    title: title || id,
    mode,
    count: comments.length,
    commentCount: meta.commentCount ?? null,
    at,
  };
  // Dedup by video + mode: re-pulling the same video the same way updates in
  // place; a different mode keeps its own entry.
  const index = [entry, ...loadIndex().filter((x) => !(x.id === id && x.mode === mode))].slice(
    0,
    INDEX_CAP,
  );

  safeSet(INDEX_KEY, JSON.stringify(index));
  return index;
}

/** Reopen a cached deck by its index-entry key (null if never saved / evicted). */
export function getDeck(key: string): StoredDeck | null {
  const raw = safeGet(key);
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
