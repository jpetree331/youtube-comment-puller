// Server-side YouTube Data API helpers. This module is imported only by the
// API route (never by a client component), so the key it receives never ships
// to the browser. It contains no `process.env` reads itself — the caller passes
// the key in — which keeps the parsing/fetching logic easy to reason about.

import type { CommentItem } from "./types";

const API = "https://www.googleapis.com/youtube/v3/";

// Max commentThreads pages to fetch (100 comments each). Fixed at 3 by default
// to preserve the original "≤300 comments in relevance order" ranking window.
const DEFAULT_PAGES = 3;
const MAX_PAGES = 3;

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

/** Fetch the video title (non-fatal — returns "" on any failure). */
export async function fetchTitle(id: string, key: string): Promise<string> {
  try {
    const r = await fetch(
      `${API}videos?part=snippet&id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`,
    );
    const j = await r.json();
    if (j?.items?.[0]?.snippet?.title) return j.items[0].snippet.title as string;
  } catch {
    // ignore — title is optional
  }
  return "";
}

/**
 * Fetch up to `pages` pages of top-level comments (relevance order), flatten
 * them, sort by like count descending, and return the top 10.
 */
export async function fetchTopComments(
  id: string,
  key: string,
  pages: number = DEFAULT_PAGES,
): Promise<CommentItem[]> {
  const maxPages = Math.min(Math.max(Math.floor(pages) || DEFAULT_PAGES, 1), MAX_PAGES);
  const all: CommentItem[] = [];
  let pageToken = "";

  for (let p = 0; p < maxPages; p++) {
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

  all.sort((a, b) => b.likes - a.likes);
  return all.slice(0, 10);
}
