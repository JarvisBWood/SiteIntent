import { generateJsonWithProviderSearch } from "@/lib/llm/web-json";
import {
  getProviderForModel,
  normalizeProviderModelSelection,
  type ProviderModelSelection
} from "@/lib/llm/provider-models";
import { buildLocationAwareContext, buildLocationSearchTerms, buildWebSearchUserLocation } from "@/lib/location-targeting";
import type { CategoryModel, CompetitorAnalysis } from "@/lib/models";
import type { ProjectScanRun, WebsiteScanPage } from "@/lib/scan/types";
import type { TargetIntentModel } from "@/lib/site-state";
import {
  RANKABILITY_FACTORS,
  RANKABILITY_SCORING_PROFILE_ID,
  RANKABILITY_WEIGHTS,
  type RankabilityFactorId,
  type RankabilityFactorScore,
  type RankabilityProviderResult,
  type RankabilityScorecard
} from "@/lib/scoring/types";

const DEFAULT_MODEL = process.env.SITEINTENT_RANKABILITY_MODEL || "gpt-5.4-mini";
type ScoreWebsiteInput = {
  scan: ProjectScanRun;
  categoryModel: CategoryModel;
  competitorAnalyses: CompetitorAnalysis[];
  targetIntentModel?: TargetIntentModel;
  model?: string;
};

type RawFactorScore = {
  score?: unknown;
  confidence?: unknown;
  could_verify_signal?: unknown;
  evidence?: unknown;
  sources?: unknown;
};

type RawRankabilityResponse = {
  website?: { name?: unknown; url?: unknown };
  category?: unknown;
  context?: unknown;
  factor_scores?: Partial<Record<RankabilityFactorId, RawFactorScore>>;
  summary?: unknown;
  warnings?: unknown;
};

const RANKABILITY_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["website", "category", "context", "factor_scores", "summary", "warnings"],
  properties: {
    website: {
      type: "object",
      additionalProperties: false,
      required: ["name", "url"],
      properties: {
        name: { type: "string" },
        url: { type: "string" }
      }
    },
    category: { type: "string" },
    context: { type: "string" },
    factor_scores: {
      type: "object",
      additionalProperties: false,
      required: RANKABILITY_FACTORS.map((factor) => factor.id),
      properties: Object.fromEntries(
        RANKABILITY_FACTORS.map((factor) => [
          factor.id,
          {
            type: "object",
            additionalProperties: false,
            required: ["score", "confidence", "could_verify_signal", "evidence", "sources"],
            properties: {
              score: { type: "number", minimum: 0, maximum: 100 },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              could_verify_signal: { type: "boolean" },
              evidence: { type: "string" },
              sources: {
                type: "array",
                items: { type: "string" },
                maxItems: 8
              }
            }
          }
        ])
      )
    },
    summary: { type: "string" },
    warnings: {
      type: "array",
      items: { type: "string" },
      maxItems: 8
    }
  }
};

export async function scoreWebsite(input: ScoreWebsiteInput): Promise<{
  scorecard: RankabilityScorecard | null;
  error: string | null;
}> {
  const pages = input.scan.websiteScanPages.filter((page) => page.includeInScoring);
  if (!pages.length) {
    return {
      scorecard: null,
      error: "No included pages were available for scoring."
    };
  }

  const selectedModel = input.model ?? getRankabilityModel();
  const provider = getProviderForModel(selectedModel);
  if (!provider) {
    return { scorecard: null, error: `Unsupported scoring model: ${selectedModel}` };
  }

  return scoreWebsiteWithProviderModel(input, provider, selectedModel);
}

export async function scoreWebsiteAcrossModels(
  input: Omit<ScoreWebsiteInput, "model"> & { models: Partial<ProviderModelSelection> }
): Promise<{
  scorecard: RankabilityScorecard | null;
  results: RankabilityProviderResult[];
  error: string | null;
}> {
  const selections = normalizeProviderModelSelection(input.models);
  const results: RankabilityProviderResult[] = [];

  for (const [provider, model] of Object.entries(selections) as Array<[keyof ProviderModelSelection, string]>) {
    const result = await scoreWebsiteWithProviderModel(input, provider, model);
    results.push({
      provider,
      model,
      scorecard: result.scorecard,
      error: result.error
    });
  }

  const scorecards = results.map((result) => result.scorecard).filter((result): result is RankabilityScorecard => Boolean(result));
  return {
    scorecard: mergeRankabilityScorecards(scorecards),
    results,
    error: scorecards.length ? null : results.map((result) => result.error).filter(Boolean).join(" | ") || "All provider models failed."
  };
}

async function scoreWebsiteWithProviderModel(
  input: ScoreWebsiteInput,
  provider: ReturnType<typeof getProviderForModel> extends infer T ? Exclude<T, null> : never,
  model: string
): Promise<{
  scorecard: RankabilityScorecard | null;
  error: string | null;
}> {
  try {
    const response = await generateJsonWithProviderSearch<RawRankabilityResponse>({
      provider,
      model,
      systemPrompt: [
        "You are scoring website rankability for AI recommendations.",
        "Use web search for current external evidence.",
        "Return only JSON matching the provided schema.",
        "Do not invent URLs or sources.",
        "Score each fixed factor independently.",
        "Do not reward a website for the same evidence in multiple factors unless it genuinely applies to both.",
        "Treat product fit, materials, features, menus, service range, compliance, and category-specific details as part of website_content_relevance_completeness.",
        "The app will calculate weighted totals. Do not calculate the final weighted score."
      ].join(" "),
      userPrompt: `${buildScorePrompt(input.scan, input.categoryModel, input.competitorAnalyses, input.targetIntentModel)}\n\n${buildRankabilityJsonContract()}`,
      responseSchema: RANKABILITY_RESPONSE_SCHEMA,
      temperature: 0.1,
      userLocation: buildWebSearchUserLocation(input.targetIntentModel)
    });

    const scorecard = normalizeRankabilityScorecard(response.content, {
      model: response.model,
      usesWebSearch: response.usesWebSearch
    });

    return {
      scorecard,
      error: scorecard ? null : `Unable to normalize ${provider} website scoring response.`
    };
  } catch (error) {
    return {
      scorecard: null,
      error: error instanceof Error ? error.message : `Unable to score website rankability with ${provider}.`
    };
  }
}

export function mergeRankabilityScorecards(scorecards: RankabilityScorecard[]) {
  if (!scorecards.length) {
    return null;
  }

  const factorScores = {} as Record<RankabilityFactorId, RankabilityFactorScore>;

  for (const factor of RANKABILITY_FACTORS) {
    const factorSet = scorecards.map((scorecard) => scorecard.factorScores[factor.id]);
    const averageScore = roundOne(average(factorSet.map((entry) => entry.score)));
    factorScores[factor.id] = {
      score: averageScore,
      weight: factor.weight,
      weightedContribution: roundOne(averageScore * (factor.weight / 100)),
      confidence: averageConfidence(factorSet.map((entry) => entry.confidence)),
      couldVerifySignal: factorSet.filter((entry) => entry.couldVerifySignal).length >= Math.ceil(factorSet.length / 2),
      evidence: `Merged from ${scorecards.map((scorecard) => scorecard.model).join(", ")}.`,
      sources: uniqueStrings(factorSet.flatMap((entry) => entry.sources)).slice(0, 8)
    };
  }

  return {
    model: "multi-model-average",
    scoringProfileId: RANKABILITY_SCORING_PROFILE_ID,
    usesWebSearch: scorecards.every((scorecard) => scorecard.usesWebSearch),
    weightedTotalScore: roundOne(
      RANKABILITY_FACTORS.reduce((sum, factor) => sum + factorScores[factor.id].weightedContribution, 0)
    ),
    factorScores,
    summary: `Merged average across ${scorecards.map((scorecard) => scorecard.model).join(", ")}.`,
    warnings: uniqueStrings(scorecards.flatMap((scorecard) => scorecard.warnings))
  } satisfies RankabilityScorecard;
}

export function normalizeRankabilityScorecard(
  value: unknown,
  options?: { model?: string; usesWebSearch?: boolean }
): RankabilityScorecard | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as RawRankabilityResponse;
  const factorPayload = payload.factor_scores;
  if (!factorPayload || typeof factorPayload !== "object") {
    return null;
  }

  const factorScores = {} as Record<RankabilityFactorId, RankabilityFactorScore>;

  for (const factor of RANKABILITY_FACTORS) {
    const rawFactor = factorPayload[factor.id];
    if (!rawFactor || typeof rawFactor !== "object") {
      return null;
    }

    const score = clampScore(rawFactor.score);
    const weight = RANKABILITY_WEIGHTS[factor.id];
    factorScores[factor.id] = {
      score,
      weight,
      weightedContribution: roundOne(score * (weight / 100)),
      confidence: normalizeConfidence(rawFactor.confidence),
      couldVerifySignal: Boolean(rawFactor.could_verify_signal),
      evidence: normalizeEvidence(rawFactor.evidence, factor.label),
      sources: normalizeSources(rawFactor.sources)
    };
  }

  return {
    model: options?.model || DEFAULT_MODEL,
    scoringProfileId: RANKABILITY_SCORING_PROFILE_ID,
    usesWebSearch: Boolean(options?.usesWebSearch),
    weightedTotalScore: roundOne(
      RANKABILITY_FACTORS.reduce((sum, factor) => sum + factorScores[factor.id].weightedContribution, 0)
    ),
    factorScores,
    summary: typeof payload.summary === "string" ? payload.summary.trim() : "",
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.map((warning) => String(warning).trim()).filter(Boolean)
      : []
  };
}

function buildScorePrompt(
  scan: ProjectScanRun,
  categoryModel: CategoryModel,
  competitorAnalyses: CompetitorAnalysis[],
  targetIntentModel?: TargetIntentModel
) {
  const includedPages = scan.websiteScanPages.filter((page) => page.includeInScoring);
  const homepage = includedPages.find((page) => page.pageType === "homepage") ?? includedPages[0] ?? null;
  const keyPages = includedPages
    .filter((page) => page !== homepage)
    .filter((page) => isKeyPage(page))
    .slice(0, 6);
  const supportingPages = includedPages
    .filter((page) => page !== homepage && !keyPages.some((candidate) => candidate.normalizedUrl === page.normalizedUrl))
    .slice(0, 6);

  const factorInstructions = RANKABILITY_FACTORS.map(
    (factor) => `- ${factor.id}: ${factor.description} Weight ${factor.weight}%.`
  ).join("\n");

  const competitorContext = competitorAnalyses.length
    ? competitorAnalyses
        .slice(0, 4)
        .map((analysis) => `${analysis.url} | ${analysis.positioning} | outcomes: ${analysis.outcomes.join(", ")}`)
        .join("\n")
    : "No competitor context supplied.";

  return [
    `Category: ${categoryModel.category}`,
    `User context: ${buildUserContext(categoryModel, targetIntentModel)}`,
    `Website name: ${scan.projectName}`,
    `Website URL: ${scan.websiteUrl}`,
    targetIntentModel?.isLocationSpecific
      ? `Location targeting: ${buildLocationSearchTerms(targetIntentModel).join(" | ")}`
      : "Location targeting: Broad Australia-wide category comparison",
    "",
    "Score this website for Rankability.",
    "Use the fixed factors exactly as provided.",
    "For each factor return:",
    "- a 0-100 score",
    "- confidence: high, medium, or low",
    "- whether the signal could be verified",
    "- evidence",
    "- source URLs",
    "",
    "Fixed factors",
    factorInstructions,
    "",
    "Stored crawl snapshot",
    `Scored pages: ${includedPages.length}`,
    "",
    "Homepage",
    homepage ? summarizePage(homepage, 1200) : "No homepage page record available.",
    "",
    "Key pages",
    keyPages.length ? keyPages.map((page, index) => `${index + 1}. ${summarizePage(page, 700)}`).join("\n\n") : "No key pages selected.",
    "",
    "Supporting pages",
    supportingPages.length
      ? supportingPages.map((page, index) => `${index + 1}. ${summarizePage(page, 380)}`).join("\n\n")
      : "No supporting pages selected.",
    "",
    "Category context",
    `Customer: ${categoryModel.customer}`,
    `Problem: ${categoryModel.problem}`,
    `Expected concepts: ${categoryModel.expectedConcepts.slice(0, 8).join(", ") || "none"}`,
    `Expected outcomes: ${categoryModel.expectedOutcomes.slice(0, 8).join(", ") || "none"}`,
    `Shared signals: ${categoryModel.sharedSignals.slice(0, 8).join(", ") || "none"}`,
    "",
    "Competitor context",
    competitorContext
  ].join("\n");
}

function buildUserContext(categoryModel: CategoryModel, targetIntentModel?: TargetIntentModel) {
  return buildLocationAwareContext(categoryModel.customer, categoryModel.category, targetIntentModel, "evaluating");
}

function buildRankabilitySearchQueries(scan: ProjectScanRun, categoryModel: CategoryModel, targetIntentModel?: TargetIntentModel) {
  const domain = normalizeDomain(scan.websiteUrl);
  const locationTerms = buildLocationSearchTerms(targetIntentModel);

  return uniqueStrings([
    ...locationTerms.map((location) => `${scan.projectName} ${categoryModel.category} ${location}`),
    ...locationTerms.map((location) => `${domain} ${categoryModel.category} ${location}`),
    `${scan.projectName} reviews`,
    `${scan.projectName} pricing`,
    `${scan.projectName} case study OR testimonial`,
    `${scan.projectName} award OR directory`
  ]);
}

function getRankabilityModel() {
  return process.env.SITEINTENT_RANKABILITY_MODEL || "gpt-5.4-mini";
}

function buildRankabilityJsonContract() {
  return [
    "Return valid JSON with these top-level keys: website, category, context, factor_scores, summary, warnings.",
    "website must include: name, url.",
    `factor_scores must include exactly these keys: ${RANKABILITY_FACTORS.map((factor) => factor.id).join(", ")}.`,
    "Each factor must include: score (0-100), confidence (high|medium|low), could_verify_signal (boolean), evidence (string), sources (array of URLs).",
    "warnings must be an array of short strings."
  ].join("\n");
}

function summarizePage(page: WebsiteScanPage, excerptLimit: number) {
  const headings = page.headings.slice(0, 6).map((heading) => `${heading.level}:${heading.text}`).join(" | ") || "n/a";
  const excerpt = page.mainText.replace(/\s+/g, " ").trim().slice(0, excerptLimit);
  return [
    `URL: ${page.url}`,
    `Type: ${page.pageType}`,
    `Title: ${page.pageTitle || "n/a"}`,
    `Meta title: ${page.metaTitle || "n/a"}`,
    `Meta description: ${page.metaDescription || "n/a"}`,
    `H1: ${page.h1 || "n/a"}`,
    `Headings: ${headings}`,
    `Excerpt: ${excerpt || "n/a"}`
  ].join("\n");
}

function isKeyPage(page: WebsiteScanPage) {
  const path = safePath(page.url);
  return (
    page.pageType === "homepage" ||
    page.pageType === "pricing" ||
    page.pageType === "product" ||
    /pricing|product|feature|solution|service|store|module|demo|contact|book/i.test(path)
  );
}

function normalizeConfidence(value: unknown): "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function normalizeEvidence(value: unknown, label: string) {
  return typeof value === "string" && value.trim() ? value.trim() : `${label} evidence was not returned.`;
}

function normalizeSources(value: unknown) {
  return Array.isArray(value)
    ? value.map((source) => String(source).trim()).filter(Boolean).slice(0, 8)
    : [];
}

function clampScore(value: unknown) {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return roundOne(Math.min(100, Math.max(0, numeric)));
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageConfidence(values: Array<"high" | "medium" | "low">): "high" | "medium" | "low" {
  const score = average(values.map((value) => (value === "high" ? 3 : value === "medium" ? 2 : 1)));
  if (score >= 2.5) {
    return "high";
  }
  if (score >= 1.5) {
    return "medium";
  }
  return "low";
}

function safePath(value: string) {
  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function normalizeDomain(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return value.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
