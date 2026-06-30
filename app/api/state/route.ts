import { NextResponse } from "next/server";

import { ensureSqliteState, saveStateToSqlite } from "@/lib/sqlite-state";
import type { SiteIntentSessionState } from "@/lib/site-state";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ state: ensureSqliteState() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load state." },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { state?: SiteIntentSessionState };
    if (!body.state) {
      return NextResponse.json({ error: "State payload is required." }, { status: 400 });
    }

    saveStateToSqlite(body.state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save state." },
      { status: 500 }
    );
  }
}
