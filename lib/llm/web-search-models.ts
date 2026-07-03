const WEB_SEARCH_CAPABLE_MODELS = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"] as const;

const WEB_SEARCH_CAPABLE_MODEL_SET = new Set<string>(WEB_SEARCH_CAPABLE_MODELS);

export const DEFAULT_WEB_SEARCH_MODEL = "gpt-5.4-mini";
export const DEFAULT_WEB_SEARCH_ANALYSIS_MODELS = ["gpt-5.4-mini", "gpt-5.4"] as const;

export function getWebSearchCapableModels() {
  return [...WEB_SEARCH_CAPABLE_MODELS];
}

export function isWebSearchCapableModel(model: string | null | undefined) {
  const normalized = normalizeModelId(model);
  return Boolean(normalized && WEB_SEARCH_CAPABLE_MODEL_SET.has(normalized));
}

export function coerceWebSearchCapableModel(model: string | null | undefined, fallback = DEFAULT_WEB_SEARCH_MODEL) {
  const normalized = normalizeModelId(model);
  return normalized && WEB_SEARCH_CAPABLE_MODEL_SET.has(normalized) ? normalized : fallback;
}

export function coerceWebSearchCapableModels(models: Array<string | null | undefined>, fallback = DEFAULT_WEB_SEARCH_ANALYSIS_MODELS) {
  const normalized = models
    .map((model) => normalizeModelId(model))
    .filter((model): model is string => Boolean(model))
    .filter((model, index, values) => values.indexOf(model) === index)
    .filter((model) => WEB_SEARCH_CAPABLE_MODEL_SET.has(model));

  return normalized.length ? normalized : [...fallback];
}

function normalizeModelId(model: string | null | undefined) {
  return model?.trim().toLowerCase() ?? "";
}
