import { NextResponse } from "next/server";

import { isAuthError, requireRequestSession } from "@/lib/auth";
import { loadAppState } from "@/lib/app-state";
import { getProjectRecommendationsReportFromState } from "@/lib/reports";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireRequestSession();
    const { projectId } = await context.params;
    const report = getProjectRecommendationsReportFromState(await loadAppState(), projectId);
    if (!report) {
      return NextResponse.json({ error: "Project or scan not found." }, { status: 404 });
    }

    return NextResponse.json({ report });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load recommendations." },
      { status: 500 }
    );
  }
}
