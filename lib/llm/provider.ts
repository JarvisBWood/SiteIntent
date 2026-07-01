export type SiteIntentProvider = "local" | "openai";

export function getSiteIntentProvider(): SiteIntentProvider {
  const explicitProvider = (process.env.SITEINTENT_AI_PROVIDER ?? process.env.SITEINTENT_SCORING_PROVIDER ?? "")
    .trim()
    .toLowerCase();

  if (explicitProvider === "openai") {
    return "openai";
  }

  if (explicitProvider === "local") {
    return "local";
  }

  return "local";
}

export function shouldUseLocalProvider() {
  return getSiteIntentProvider() === "local";
}

export function isOpenAIModelName(model: string | null | undefined) {
  const normalized = model?.trim().toLowerCase() ?? "";
  return /^(gpt-|o[1345](?:[\.-]|$)|chatgpt-|codex-)/.test(normalized);
}
