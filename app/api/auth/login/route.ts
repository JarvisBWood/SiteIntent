import { NextResponse } from "next/server";

import { signInWithPassword } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    if (!body.email?.trim() || !body.password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const session = await signInWithPassword(body.email, body.password);
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sign in." },
      { status: 401 }
    );
  }
}

