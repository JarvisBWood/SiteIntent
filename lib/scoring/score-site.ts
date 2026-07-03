import OpenAI from "openai";

import { generateJsonWithLocalSearch } from "@/lib/llm/local-web-scoring";
import { MODEL_CONFIG } from "@/lib/llm/model-config";
import { createRemoteLLMClient } from "@/lib/llm/remote";
import { isOpenAIModelName, shouldUseRemoteProvider } from "@/lib/llm/provider";
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
  type RankabilityScorecard
} from "@/lib/scoring/types";

const DEFAULT_MODEL = MODEL_CONFIG.worker;
const FALLBACK_MODEL = "openai/gpt-5.4-mini";
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

  if (shouldUseRemoteProvider()) {
    return scoreWebsiteWithLocalModel(input, selectedModel);
  }

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (isOpenAIModelName(selectedModel)) {
    if (openAiApiKey) {
      return scoreWebsiteWithOpenAIModel(input, selectedModel);
    }

    return scoreWebsiteWithLocalModel(input, getLocalRankabilityModel());
  }

  return scoreWebsiteWithLocalModel(input, selectedModel);
}

export async function scoreWebsiteWithJudgeModel(
  scan: ProjectScanRun,
  categoryModel: CategoryModel,
  factorScorecards: Array<{ model: string; scorecard: RankabilityScorecard }>
): Promise<RankabilityScorecard | null> {
  const judgeModel = MODEL_CONFIG.judge;

  const scoringProfile = factorScorecards.map((f) => ({
    model: f.model,
    summary: f.scorecard.summary,
    overall: f.scorecard.weightedTotalScore,
    factors: Object.fromEntries(
      RANKABILITY_FACTORS.map((factor) => [
        factor.id,
        f.scorecard.factorScores?.[factor.id] ?? null
      ])
    )
  }));

  const systemPrompt = [
    "You are a neutral scoring judge. Given independent rankability assessments from multiple AI models, produce a final consensus scorecard.",
    "Weight each model's assessment equally unless one provides significantly stronger evidence.",
    "Return only valid JSON matching the required schema."
  ].join(" ");

  const userPrompt = [
    `Website: ${scan.projectName} (${scan.websiteUrl})`,
    `Category: ${categoryModel.category}`,
    `Context: ${categoryModel.context}`,
    "",
    "Below are the independent assessments from each analysis model:",
    JSON.stringify(scoringProfile, null, 2),
    "",
    "Produce a final consensus scorecard. For each factor, synthesize the evidence from all models. The overall score should reflect the combined assessment.",
    buildRankabilityJsonContract()
  ].join("\n");

  const client = createRemoteLLMClient({ defaultModel: judgeModel });
  const result = await client.generate<RawRankabilityResponse>({
    model: judgeModel,
    responseFormat: "json",
    responseSchema: RANKABILITY_RESPONSE_SCHEMA,
    temperature: 0.1,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });

  if (!result.ok) {
    return null;
  }

  const scorecard = normalizeRankabilityScorecard(result.content, scan);
  scorecard.model = judgeModel;
  return scorecard;
}

async function scoreWebsiteWithLocalModel(
  input: ScoreWebsiteInput,
  model: string
): Promise<{
  scorecard: RankabilityScorecard | null;
  error: string | null;
}> {
  try {
    const response = await generateJsonWithLocalSearch<RawRankabilityResponse>({
      model,
      responseSchema: RANKABILITY_RESPONSE_SCHEMA,
      systemPrompt: [
        "You are scoring website rankability for AI recommendations.",
        "Use the provided stored crawl plus the collected web search evidence for current external validation.",
        "Return only JSON matching the required shape.",
        "Do not invent URLs or sources.",
        "Score each fixed factor independently.",
        "Do not reward a website for the same evidence in multiple factors unless it genuinely applies to both.",
        "Treat product fit, materials, features, menus, service range, compliance, and category-specific details as part of website_content_relevance_completeness.",
        "The app will calculate weighted totals. Do not calculate the final weighted score."
      ].join(" "),
      userPrompt: `${buildScorePrompt(input.scan, input.categoryModel, input.competitorAnalyses, input.targetIntentModel)}\n\n${buildRankabilityJsonContract()}`,
      searchQueries: buildRankabilitySearchQueries(input.scan, input.categoryModel, input.targetIntentModel),
      maxResultsPerQuery: 6,
      maxAttempts: 3,
      temperature: 0.1
    });

    const scorecard = normalizeRankabilityScorecard(response.content, {
      model: response.model,
      usesWebSearch: response.searchRuns.some((run) => run.results.length > 0)
    });

    if (!scorecard) {
      return {
        scorecard: null,
        error: "Unable to normalize local rankability scoring response."
      };
    }

    scorecard.warnings = uniqueStrings([...scorecard.warnings, ...response.warnings]);
    return {
      scorecard,
      error: null
    };
  } catch (error) {
    return {
      scorecard: null,
      error: error instanceof Error ? error.message : "Unable to score website rankability with the local model."
    };
  }
}

async function scoreWebsiteWithOpenAIModel(
  input: ScoreWebsiteInput,
  model: string
): Promise<{
  scorecard: RankabilityScorecard | null;
  error: string | null;
}> {
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    return scoreWebsiteWithLocalModel(input, model);
  }

  try {
    const client = new OpenAI({ apiKey: openAiApiKey });
    const response = await createResponseWithModelFallback(client, {
      model,
      input: [
        {
          role: "system",
          content: [
            "You are scoring website rankability for AI recommendations.",
            "Use web search for current external evidence.",
            "Return only JSON matching the provided schema.",
            "Do not invent URLs or sources.",
            "Score each fixed factor independently.",
            "Do not reward a website for the same evidence in multiple factors unless it genuinely applies to both.",
            "Treat product fit, materials, features, menus, service range, compliance, and category-specific details as part of website_content_relevance_completeness.",
            "The app will calculate weighted totals. Do not calculate the final weighted score."
          ].join(" ")
        },
        {
          role: "user",
          content: buildScorePrompt(input.scan, input.categoryModel, input.competitorAnalyses, input.targetIntentModel)
        }
      ],
      tools: [
        {
          type: "web_search" as const,
          user_location: buildWebSearchUserLocation(input.targetIntentModel)
        }
      ],
      tool_choice: "required",
      text: {
        format: {
          type: "json_schema",
          name: "siteintent_rankability_score",
          strict: true,
          schema: RANKABILITY_RESPONSE_SCHEMA
        }
      }
    });

    const parsed = parseResponseJson(response);
    const scorecard = normalizeRankabilityScorecard(parsed, {
      model: response.model || model,
      usesWebSearch: containsWebSearchCall(response)
    });

    return {
      scorecard,
      error: scorecard ? null : "Unable to normalize website scoring response."
    };
  } catch (error) {
    return {
      scorecard: null,
      error: error instanceof Error ? error.message : "Unable to score website rankability."
    };
  }
}

async function createResponseWithModelFallback(client: OpenAI, request: OpenAI.Responses.ResponseCreateParamsNonStreaming) {
  try {
    return await client.responses.create(request);
  } catch (error) {
    if (isModelNotFound(error) && request.model !== FALLBACK_MODEL) {
      return client.responses.create({
        ...request,
        model: FALLBACK_MODEL
      });
    }
    throw error;
  }
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

function getLocalRankabilityModel() {
  return process.env.SITEINTENT_RANKABILITY_LOCAL_MODEL || process.env.SITEINTENT_AI_MODEL || process.env.OLLAMA_MODEL || "llama3.1:8b";
}

function getRankabilityModel() {
  return process.env.SITEINTENT_RANKABILITY_LOCAL_MODEL || process.env.SITEINTENT_RANKABILITY_MODEL || process.env.SITEINTENT_AI_MODEL || "gpt-5-mini";
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

function parseResponseJson(response: { output_text?: string; output?: unknown[] }) {
  const text = response.output_text || extractTextFromOutput(response.output);
  if (!text) {
    throw new Error("OpenAI response did not include output text.");
  }

  return JSON.parse(stripJsonFence(text));
}

function extractTextFromOutput(output: unknown[] | undefined) {
  if (!Array.isArray(output)) {
    return "";
  }

  const texts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = (item as { content?: unknown[] }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        texts.push(part.text);
      }
    }
  }

  return texts.join("\n").trim();
}

function containsWebSearchCall(response: { output?: unknown[] }) {
  return Array.isArray(response.output)
    ? response.output.some((item) => item && typeof item === "object" && (item as { type?: string }).type === "web_search_call")
    : false;
}

function stripJsonFence(value: string) {
  return value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
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

function isModelNotFound(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "model_not_found"
  );
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
