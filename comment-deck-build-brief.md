# Build Brief — Comment Deck (hosted / Vercel version)

## Context

I have a working single-file browser tool (`comment-deck.html`) that pulls the top 10 comments (by like count) from a YouTube video and displays them as a pageable card deck for reading aloud on camera. It runs entirely client-side and holds a YouTube Data API key in browser storage.

I want to port it to a **hosted Next.js app deployed on Vercel**. The single most important change is architectural: **the YouTube API key must live server-side as an environment variable and never reach the browser.** The frontend must call our own API route, which calls YouTube. Everything else about the app's behavior and look should be preserved.

If I hand you the existing `comment-deck.html`, treat it as the reference implementation for the **UI and visual design** — preserve those exactly and only change the architecture described below. If I don't, rebuild the UI from the design spec at the bottom of this brief.

## Stack decision

Use **Next.js (App Router) + TypeScript**, deployed to Vercel. Rationale: one deploy for both the UI and the serverless API route, and hiding the key behind a route handler is trivial and idiomatic. (Vite + standalone Vercel serverless functions would also work and is closer to my life-dashboard stack, but Next.js App Router is less config for this UI+API combo. Only fall back to Vite if you hit a real blocker.)

## Recon (do first, report findings, then proceed)

- Node version and package manager available (npm / pnpm / yarn). Match whatever's already standard in my environment.
- Whether this is greenfield or dropping into an existing repo. Assume greenfield unless told otherwise — scaffold a fresh Next.js App Router + TypeScript project.
- Vercel CLI presence / whether I'm logged in (`vercel whoami`). Don't deploy yourself; prep for me to deploy.

## Build

**1. Environment / secrets**
- `YOUTUBE_API_KEY` — server-only, read via `process.env`. Never prefix with `NEXT_PUBLIC_`. Put it in `.env.local` for dev and document that it must be set in the Vercel dashboard for prod.
- Optional `APP_PASSCODE` — if set, the API route requires a matching value (passed as a header or query param from the client, entered once and kept in localStorage). This is a lightweight guard so a public Vercel URL doesn't let strangers burn my YouTube quota. If the env var is unset, skip the check entirely. Also leave a comment noting Vercel Deployment Protection as the heavier alternative.

**2. API route — `app/api/comments/route.ts`**
This is the security-critical piece; implement it faithfully.
- Accepts a `videoId` (already-parsed) or a raw URL/ID (parse server-side — reuse the parsing logic from the HTML: bare 11-char IDs, `youtu.be/…`, `watch?v=…`, `/shorts/…`, `/embed/…`, `/live/…`, else regex-match an 11-char token).
- Reads the key from `process.env.YOUTUBE_API_KEY`. If missing, return a clear 500 with a message (not a stack trace).
- If `APP_PASSCODE` is set, reject with 401 unless the request supplies the correct passcode.
- Fetches up to **3 pages** of `commentThreads` (`part=snippet`, `maxResults=100`, `order=relevance`), following `nextPageToken`. Also fetches the video title via `videos?part=snippet&id=…`.
- For each top-level comment, extract: `authorDisplayName`, `authorProfileImageUrl`, `textOriginal` (fall back to `textDisplay`), `likeCount`, `publishedAt`.
- Sort all collected comments by `likeCount` descending, slice the **top 10**, and return JSON: `{ title, videoId, comments: [...] }`.
- Handle YouTube's `error` payloads (quota exceeded, invalid key, comments disabled) and surface a readable message with an appropriate status code. Never leak the key in any error text.

Reference shape for the route (adapt to final types/runtime):

```ts
// app/api/comments/route.ts  — sketch, not final
export async function POST(req: Request) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return json({ error: "Server API key not configured." }, 500);

  const { input, passcode } = await req.json();
  if (process.env.APP_PASSCODE && passcode !== process.env.APP_PASSCODE)
    return json({ error: "Unauthorized." }, 401);

  const id = parseVideoId(input);
  if (!id) return json({ error: "Couldn't read a video ID." }, 400);

  const [comments, title] = await Promise.all([
    fetchTopComments(id, key), // ≤3 pages, sort by likeCount desc, slice(0,10)
    fetchTitle(id, key),
  ]);
  return json({ title, videoId: id, comments });
}
```

**3. Frontend — `app/page.tsx` (client component)**
- Same UI and interactions as the browser version: paste a video URL or ID → "Pull top 10" → card deck. **The browser must never call googleapis.com directly** — it calls `POST /api/comments` and renders the returned JSON.
- Preserve all interactions: prev/next arrow buttons, **keyboard left/right** paging, clickable dots, the mono `03 / 10` counter, the `#N of 10` rank badge, the heart + like count, avatar with initial-letter fallback on image error, and the **"Copy all 10"** button that dumps a plain-text numbered list (`N. Name (X likes)` + comment) for teleprompter use.
- **Recent videos + deck cache:** on the real domain, `localStorage` is fine (this isn't the Claude artifact sandbox). Keep a `deck_index` list (id, title, timestamp, cap ~40) and cache each pulled deck under `deck:<id>` so the "Recent" dropdown reopens past pulls instantly and offline. Same behavior as the HTML's `window.storage` version — just swap `window.storage` for `localStorage`.
- Passcode (only if `APP_PASSCODE` is used): a one-time field, stored in `localStorage`, sent with each API call. Keep it out of the way when not configured.
- Escape/render all comment text safely (use React's default text rendering — do not `dangerouslySetInnerHTML`).

**4. Config**
- `.env.local` with `YOUTUBE_API_KEY=` (and optional `APP_PASSCODE=`), plus `.env.example` documenting both.
- `README.md`: how to get a YouTube Data API v3 key, restrict it to that API, set env vars locally and in Vercel, run dev, and deploy.

## Verify (do this, don't skip)

- Run locally (`next dev` or `vercel dev`) with a real key in `.env.local`. Pull a real video, page through with arrows and keyboard, click dots, and test "Copy all 10."
- **Prove the key is hidden:** in the browser DevTools Network tab, confirm the only comment-related outbound calls go to `/api/comments`, never to `googleapis.com`. Grep the built client bundle and page source for the key string and for `googleapis` — neither should appear client-side.
- Test failure paths: bad/short video ID, a video with comments disabled, and (if you can simulate it) a missing key → each should show a clean message, not a crash or a stack trace.
- Confirm the app builds cleanly (`next build`) with no type errors.
- Leave me a short note on deploy steps (set env vars in Vercel dashboard → deploy → retest on the live URL). Do not deploy on my behalf.

## Divergence rules (preserve these)

- **Visual design is fixed** — palette, fonts, card/deck aesthetic, badges, counter, dots, nav, copy button. Match the existing `comment-deck.html` exactly. Do not restyle or "improve" the look.
- **Ranking logic is fixed** — ≤300 comments in relevance order, re-sorted by like count, top 10. If you want to make the page depth configurable, add it as an optional param with the default unchanged; don't alter the default behavior.
- **Key handling is the whole point** — if any approach would expose the key client-side, reject that approach.

## Autonomy clause

Work the full Recon → Build → Verify cycle without stopping to ask for confirmation on ordinary decisions. Make reasonable choices, state the ones that matter in your summary, and keep going. Only pause if you hit a genuine ambiguity, a destructive action, or a security tradeoff that isn't covered above. Report Recon findings and final Verify results; otherwise proceed to a working, buildable app.

---

### Design spec (only needed if the HTML reference isn't provided)

- **Palette:** `--bg:#17111f`, `--bg2:#1f1729`, `--card:#271d34`, `--card2:#2f2340`, `--ink:#f4eff5`, `--muted:#a99bb5`, `--faint:#6f6280`, `--amber:#f5b942` (primary/spotlight), `--mint:#5ce0c6` (likes/active), `--coral:#ff6b8a` (heart), lines `rgba(255,255,255,0.08)` / `0.14`. Background is a dark plum-ink with a soft radial glow top-right.
- **Type:** Bricolage Grotesque (display: title, commenter names), Inter (body/comment text), Space Mono (counter, timestamps, labels). Load from Google Fonts.
- **Signature element:** a stacked "deck of cards" — two faint offset card shapes behind the active card — with a `#N of 10` pill badge overhanging the top-left corner, so it reads as flipping through a physical stack of fan messages. Comment text is large (~1.15rem) and highly readable for reading on camera.
- **Layout:** header (logo mark + "Comment Deck" + "Top 10 · by likes" + gear/settings) → video input + Pull button → Recent dropdown → stage (round prev arrow · card · round next arrow) → footer (dots · mono counter · Copy all 10) → status line.
- **Quality floor:** responsive to mobile, visible keyboard focus, `prefers-reduced-motion` respected.
