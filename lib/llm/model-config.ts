const parseModels = (env: string | undefined, fallback: string): string[] =>
  (env ?? fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const MODEL_CONFIG = {
  worker: process.env.SITEINTENT_WORKER_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct",
  judge: process.env.SITEINTENT_JUDGE_MODEL ?? "openai/gpt-5.4-mini",
  analysis: parseModels(
    process.env.SITEINTENT_ANALYSIS_MODELS,
    "openai/gpt-5.4-mini,anthropic/claude-4-sonnet,google/gemini-2.5-flash"
  ),
} as const;
