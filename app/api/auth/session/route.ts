import { NextResponse } from "next/server";

import { getRequestSession } from "@/lib/auth";

export async function GET() {
  return NextResponse.json({ session: await getRequestSession() });
}

