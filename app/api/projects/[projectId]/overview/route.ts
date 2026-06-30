import { NextResponse } from "next/server";

import { getProjectOverviewReport } from "@/lib/sqlite-queries";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const report = getProjectOverviewReport(projectId);
    if (!report) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    return NextResponse.json({ report });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load project overview." },
      { status: 500 }
    );
  }
}
