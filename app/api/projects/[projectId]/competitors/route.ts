import { NextResponse } from "next/server";

import { isAuthError, requireRequestSession } from "@/lib/auth";
import { loadAppState } from "@/lib/app-state";
import { getProjectCompetitorReportFromState } from "@/lib/reports";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireRequestSession();
    const { projectId } = await context.params;
    const report = getProjectCompetitorReportFromState(await loadAppState(), projectId);
    if (!report) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    return NextResponse.json({ report });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load competitor report." },
      { status: 500 }
    );
  }
}
