import { NextResponse } from "next/server";

import { fetchWebsiteFavicon } from "@/lib/favicon";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const websiteUrl = searchParams.get("url") ?? "";

    if (!websiteUrl) {
      return NextResponse.json({ error: "A website URL is required." }, { status: 400 });
    }

    const faviconUrl = await fetchWebsiteFavicon(websiteUrl);
    return NextResponse.json({ faviconUrl });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to resolve favicon." },
      { status: 500 }
    );
  }
}
