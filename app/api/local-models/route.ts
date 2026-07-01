import { NextResponse } from "next/server";

import { isCloudflareRuntime } from "@/lib/cloudflare-runtime";

export async function GET() {
  try {
    if (isCloudflareRuntime()) {
      return NextResponse.json({
        models: [],
        error: "Local Ollama models are available only in offline local development."
      });
    }

    const baseUrl = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/api/tags`, {
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}.`);
    }

    const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
    const models = [...new Set((payload.models ?? []).flatMap((item) => [item.name, item.model]).filter(Boolean))];

    return NextResponse.json({
      models
    });
  } catch (error) {
    return NextResponse.json(
      {
        models: [],
        error: error instanceof Error ? error.message : "Unable to load local models."
      },
      { status: 200 }
    );
  }
}
