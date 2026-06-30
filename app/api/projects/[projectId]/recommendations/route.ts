import { NextResponse } from "next/server";

import { getProjectRecommendationsReport } from "@/lib/sqlite-queries";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const report = getProjectRecommendationsReport(projectId);
    if (!report) {
      return NextResponse.json({ error: "Project or scan not found." }, { status: 404 });
    }

    return NextResponse.json({ report });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load recommendations." },
      { status: 500 }
    );
  }
}
