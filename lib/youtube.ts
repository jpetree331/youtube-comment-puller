// Server-side YouTube Data API helpers. This module is imported only by the
// API route (never by a client component), so the key it receives never ships
// to the browser. It contains no `process.env` reads itself — the caller passes
// the key in — which keeps the parsing/fetching logic easy to reason about.

import type { CommentItem, PullMode } from "./types";

const API = "https://www.googleapis.com/youtube/v3/";

// commentThreads returns up to 100 comments per page. We fetch a pool of up to
// MAX_POOL_PAGES (≤300 comments in YouTube's relevance order) and then rank,
// keep-in-order, or shuffle it depending on the requested mode.
const MAX_POOL_PAGES = 3;
const MAX_COUNT = 100;
const DEFAULT_COUNT = 10;

/** Clamp a requested comment count to the supported 1..100 range. */
export function clampCount(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(1, v));
}

/** Fisher–Yates shuffle (returns a new array; does not mutate the input). */
function shuffle<T>(input: readonly T[]): T[] {
  const a = [...input];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Error thrown when YouTube returns an `error` payload. Carries an HTTP status
 * so the route can surface an appropriate, readable code to the client.
 */
export class YouTubeApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "YouTubeApiError";
    this.status = status;
  }
}

/**
 * Extract an 11-char YouTube video ID from a raw URL or ID string.
 * Mirrors the reference HTML's parser: bare IDs, youtu.be, watch?v=,
 * /shorts/, /embed/, /live/, /v/, then a final 11-char regex fallback.
 * Returns "" when nothing usable is found (route turns this into a 400).
 */
export function parseVideoId(raw: string): string {
  raw = (raw || "").trim();
  if (!raw) return "";

  // Bare ID (canonical length is 11).
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;

  try {
    const u = new URL(raw);
    if (u.hostname.includes("youtu.be")) {
      return u.pathname.slice(1).split("/")[0];
    }
    const v = u.searchParams.get("v");
    if (v) return v;
    const parts = u.pathname.split("/");
    const i = parts.findIndex((p) => ["shorts", "embed", "live", "v"].includes(p));
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
  } catch {
    // Not a URL — fall through to the regex scan.
  }

  const m = raw.match(/[A-Za-z0-9_-]{11}/);
  return m ? m[0] : "";
}

/**
 * Map a YouTube API `error` payload to a readable message + HTTP status.
 * Never echoes the raw message for key-related failures (defensive; the route
 * also redacts the key from any message before it reaches the client).
 */
function mapYouTubeError(payload: unknown): YouTubeApiError {
  const err = (payload as { error?: { message?: string; errors?: { reason?: string }[] } }).error;
  const rawMsg = err?.message ?? "YouTube API error.";
  // Match reasons case-insensitively so both the legacy camelCase codes
  // (keyInvalid, commentsDisabled) and the newer SCREAMING_SNAKE ones
  // (API_KEY_INVALID) are handled.
  const reason = (err?.errors?.[0]?.reason ?? "").toLowerCase();
  const msg = rawMsg.toLowerCase();

  // Comments disabled — check first; it's the most specific 403.
  if (reason.includes("commentsdisabled") || (reason.includes("comment") && msg.includes("disabled"))) {
    return new YouTubeApiError("Comments are disabled on this video.", 422);
  }
  // Key / configuration problems — never echo YouTube's raw text.
  if (reason.includes("key") || reason === "forbidden" || msg.includes("api key not valid")) {
    return new YouTubeApiError(
      "The server's YouTube API key was rejected. Check the key and its API restrictions.",
      502,
    );
  }
  // Quota / rate limiting.
  if (reason.includes("quota") || reason.includes("ratelimit")) {
    return new YouTubeApiError("YouTube API quota exceeded — try again later.", 429);
  }
  // Video missing.
  if (reason.includes("videonotfound") || reason.includes("notfound")) {
    return new YouTubeApiError("No video found for that ID.", 404);
  }
  return new YouTubeApiError(rawMsg, 502);
}

/**
 * Fetch the video title + total comment count (non-fatal — returns safe
 * defaults on any failure; commentCount is null when unknown or comments off).
 */
export async function fetchVideoMeta(
  id: string,
  key: string,
): Promise<{ title: string; commentCount: number | null }> {
  try {
    const r = await fetch(
      `${API}videos?part=snippet,statistics&id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`,
    );
    const j = await r.json();
    const item = j?.items?.[0];
    if (item) {
      const title = (item.snippet?.title as string) ?? "";
      const raw = item.statistics?.commentCount;
      const commentCount = raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
      return { title, commentCount };
    }
  } catch {
    // ignore — meta is optional
  }
  return { title: "", commentCount: null };
}

/** Fetch up to `pages` pages of top-level comments in YouTube's relevance order. */
async function fetchPool(id: string, key: string, pages: number): Promise<CommentItem[]> {
  const all: CommentItem[] = [];
  let pageToken = "";

  for (let p = 0; p < pages; p++) {
    const url =
      `${API}commentThreads?part=snippet&videoId=${encodeURIComponent(id)}` +
      `&maxResults=100&order=relevance` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "") +
      `&key=${encodeURIComponent(key)}`;

    const r = await fetch(url);
    const j = await r.json();
    if (j?.error) throw mapYouTubeError(j);

    for (const it of j.items ?? []) {
      const c = it?.snippet?.topLevelComment?.snippet;
      if (!c) continue;
      all.push({
        name: c.authorDisplayName ?? "Unknown",
        avatar: c.authorProfileImageUrl ?? "",
        text: c.textOriginal ?? c.textDisplay ?? "",
        likes: c.likeCount ?? 0,
        when: c.publishedAt ?? "",
      });
    }

    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }

  return all;
}

/**
 * Fetch comments for a video and select `count` of them according to `mode`:
 *   - "likes":   re-sort the pool by like count (most-hearted first)
 *   - "youtube": keep YouTube's own relevance order (exactly what the site shows)
 *   - "random":  shuffle the pool
 *
 * "youtube" only needs enough pages to cover `count`; the ranked and random
 * modes fetch the full pool so the selection is drawn from more comments.
 */
export async function fetchComments(
  id: string,
  key: string,
  opts: { count?: number; mode?: PullMode } = {},
): Promise<CommentItem[]> {
  const count = clampCount(opts.count);
  const mode: PullMode = opts.mode ?? "likes";

  const pages =
    mode === "youtube" ? Math.min(Math.ceil(count / 100), MAX_POOL_PAGES) : MAX_POOL_PAGES;

  const pool = await fetchPool(id, key, pages);

  const ordered =
    mode === "likes"
      ? [...pool].sort((a, b) => b.likes - a.likes)
      : mode === "random"
        ? shuffle(pool)
        : pool; // "youtube" — leave relevance order untouched

  return ordered.slice(0, count);
}
