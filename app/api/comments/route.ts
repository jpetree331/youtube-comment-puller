// POST /api/comments — the security boundary of this app.
//
// The browser calls THIS route; only this route calls googleapis.com. The
// YouTube key is read from process.env here and never leaves the server. If any
// change would surface the key client-side, it does not belong in this file.

import { NextResponse } from "next/server";
import { parseVideoId, fetchComments, fetchVideoMeta, YouTubeApiError } from "@/lib/youtube";
import type { DeckResponse, PullMode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // never cache — depends on live env + body

const PULL_MODES: PullMode[] = ["likes", "youtube", "random"];

interface RequestBody {
  input?: string;
  passcode?: string;
  count?: number;
  mode?: PullMode;
}

/** Belt-and-suspenders: strip the key from any text before it reaches the client. */
function redact(message: string, key: string): string {
  return key ? message.split(key).join("[redacted]") : message;
}

export async function POST(req: Request) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    // Clear message, no stack trace, no hint at the key's contents.
    return NextResponse.json(
      { error: "Server API key not configured. Set YOUTUBE_API_KEY in the environment." },
      { status: 500 },
    );
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    body = {};
  }

  // Optional lightweight passcode gate. Skipped entirely when APP_PASSCODE is unset.
  if (process.env.APP_PASSCODE && body.passcode !== process.env.APP_PASSCODE) {
    return NextResponse.json({ error: "Unauthorized — passcode required or incorrect." }, { status: 401 });
  }

  const id = parseVideoId(typeof body.input === "string" ? body.input : "");
  if (!id) {
    return NextResponse.json({ error: "Couldn't read a video ID from that." }, { status: 400 });
  }

  const count = typeof body.count === "number" ? body.count : undefined;
  const mode: PullMode = PULL_MODES.includes(body.mode as PullMode)
    ? (body.mode as PullMode)
    : "likes";

  try {
    const [comments, meta] = await Promise.all([
      fetchComments(id, key, { count, mode }),
      fetchVideoMeta(id, key),
    ]);

    if (!comments.length) {
      return NextResponse.json(
        { error: "No comments found (they may be disabled on this video)." },
        { status: 404 },
      );
    }

    const payload: DeckResponse = {
      title: meta.title || id,
      videoId: id,
      comments,
      commentCount: meta.commentCount,
    };
    return NextResponse.json(payload);
  } catch (e) {
    if (e instanceof YouTubeApiError) {
      return NextResponse.json({ error: redact(e.message, key) }, { status: e.status });
    }
    return NextResponse.json({ error: "Unexpected error fetching comments." }, { status: 500 });
  }
}
