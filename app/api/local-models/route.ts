import { NextResponse } from "next/server";

import { MODEL_CONFIG } from "@/lib/llm/model-config";
import {
  getProviderModelOptionsByProvider,
  type ProviderModelOption
} from "@/lib/llm/provider-models";
import { getWebSearchCapableModels } from "@/lib/llm/web-search-models";

export async function GET() {
  const providers = getProviderModelOptionsByProvider();

  return NextResponse.json({
    models: [
      {
        id: MODEL_CONFIG.worker,
        role: "worker",
        name: "Worker",
        description: "Hosted OpenAI model used for page analysis and scan orchestration"
      },
      {
        id: MODEL_CONFIG.judge,
        role: "judge",
        name: "Judge",
        description: "Hosted OpenAI model used for the final consensus scorecard"
      },
      ...MODEL_CONFIG.analysis.map((id) => ({
        id,
        role: "analysis",
        name: "Analysis",
        description: "Hosted OpenAI model used for independent rankability scoring with native web search"
      }))
    ],
    provider: "openai",
    webSearchCapableModels: getWebSearchCapableModels(),
    providerOptions: providers satisfies Record<"openai" | "anthropic" | "google", ProviderModelOption[]>
  });
}
