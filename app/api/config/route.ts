// GET /api/config — exposes only whether a passcode is required, so the client
// can decide whether to surface the passcode field. Leaks a boolean, nothing else.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ passcodeRequired: Boolean(process.env.APP_PASSCODE) });
}
