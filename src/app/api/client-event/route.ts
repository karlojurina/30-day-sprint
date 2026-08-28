import { NextRequest, NextResponse } from "next/server";

/**
 * Sink for client-side diagnostics.
 *
 * Everything that broke for the 2026-08 login incident happened in the browser,
 * so none of it reached Vercel logs and every diagnosis depended on a student
 * sending screenshots. This gives the client one place to say what it saw.
 *
 * Deliberately unauthenticated: the sessions we most need to hear from are the
 * ones whose session just got deleted. Nothing here is trusted or stored — it
 * is logged and dropped. Payload is capped so it can't be used to spam logs.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const line = JSON.stringify(body).slice(0, 600);
    // console.error so it surfaces at warning level in Vercel's log view.
    console.error(`[client-event] ${line}`);
  } catch {
    // A malformed beacon is not worth a 500 — the client can't act on it.
  }
  return new NextResponse(null, { status: 204 });
}
