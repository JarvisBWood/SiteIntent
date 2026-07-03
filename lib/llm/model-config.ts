import {
  DEFAULT_WEB_SEARCH_ANALYSIS_MODELS,
  DEFAULT_WEB_SEARCH_MODEL,
  coerceWebSearchCapableModel,
  coerceWebSearchCapableModels
} from "@/lib/llm/web-search-models";

const parseModels = (env: string | undefined, fallback: string): string[] =>
  (env ?? fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const MODEL_CONFIG = {
  worker: coerceWebSearchCapableModel(process.env.SITEINTENT_WORKER_MODEL, DEFAULT_WEB_SEARCH_MODEL),
  judge: coerceWebSearchCapableModel(process.env.SITEINTENT_JUDGE_MODEL, DEFAULT_WEB_SEARCH_MODEL),
  analysis: coerceWebSearchCapableModels(
    parseModels(
      process.env.SITEINTENT_ANALYSIS_MODELS,
      DEFAULT_WEB_SEARCH_ANALYSIS_MODELS.join(",")
    )
  )
} as const;
