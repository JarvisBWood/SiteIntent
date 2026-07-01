import { NextResponse } from "next/server";

import { isAuthError, requireRequestSession } from "@/lib/auth";
import { loadAppState } from "@/lib/app-state";
import { getWebsitesReportFromState } from "@/lib/reports";

export async function GET() {
  try {
    await requireRequestSession();
    return NextResponse.json({ report: getWebsitesReportFromState(await loadAppState()) });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load websites." },
      { status: 500 }
    );
  }
}
