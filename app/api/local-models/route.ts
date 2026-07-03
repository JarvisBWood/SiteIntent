import { NextResponse } from "next/server";

import { MODEL_CONFIG } from "@/lib/llm/model-config";

export async function GET() {
  return NextResponse.json({
    models: [
      { id: MODEL_CONFIG.worker, role: "worker", name: "Worker", description: "Crawl, page analysis, competitor discovery" },
      { id: MODEL_CONFIG.judge, role: "judge", name: "Judge", description: "Consensus scoring aggregator" },
      ...MODEL_CONFIG.analysis.map((id) => ({ id, role: "analysis", name: "Analysis", description: "Independent rankability scorer" }))
    ],
    provider: "openrouter"
  });
}
