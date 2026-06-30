import OpenAI from "openai";

import type { CategoryModel, CompetitorAnalysis } from "@/lib/models";
import type { ProjectScanRun, WebsiteScanPage } from "@/lib/scan/types";
import {
  RANKABILITY_FACTORS,
  RANKABILITY_SCORING_PROFILE_ID,
  RANKABILITY_WEIGHTS,
  type RankabilityFactorId,
  type RankabilityFactorScore,
  type RankabilityScorecard
} from "@/lib/scoring/types";

const DEFAULT_MODEL = process.env.SITEINTENT_RANKABILITY_MODEL || "gpt-5-mini";
const FALLBACK_MODEL = "gpt-5.4-mini";
const WEB_SEARCH_TOOL = {
  type: "web_search" as const,
  user_location: {
    type: "approximate" as const,
    country: "AU",
    region: "New South Wales",
    city: "Sydney",
    timezone: "Australia/Sydney"
  }
};

type ScoreWebsiteInput = {
  scan: ProjectScanRun;
  categoryModel: CategoryModel;
  competitorAnalyses: CompetitorAnalysis[];
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

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    return {
      scorecard: null,
      error: "OPENAI_API_KEY is required for Rankability scoring."
    };
  }

  try {
    const client = new OpenAI({ apiKey: openAiApiKey });
    const response = await createResponseWithModelFallback(client, {
      model: DEFAULT_MODEL,
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
          content: buildScorePrompt(input.scan, input.categoryModel, input.competitorAnalyses)
        }
      ],
      tools: [WEB_SEARCH_TOOL],
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
      model: response.model || DEFAULT_MODEL,
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
  competitorAnalyses: CompetitorAnalysis[]
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
    `User context: ${buildUserContext(categoryModel)}`,
    `Website name: ${scan.projectName}`,
    `Website URL: ${scan.websiteUrl}`,
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

function buildUserContext(categoryModel: CategoryModel) {
  return `${categoryModel.customer} evaluating ${categoryModel.category} options in Australia`;
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
