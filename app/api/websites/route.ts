import { NextResponse } from "next/server";

import { getWebsitesReport } from "@/lib/sqlite-queries";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ report: getWebsitesReport() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load websites." },
      { status: 500 }
    );
  }
}
