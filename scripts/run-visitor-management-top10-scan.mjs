#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import OpenAI from "openai";

const OUTPUT_DIR = path.resolve(process.cwd(), "research-results");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "visitor-management-top10-scan.json");
const MODEL =
  process.env.VISITOR_MGMT_MODEL ||
  process.env.SITEINTENT_DISCOVERABILITY_MODEL ||
  process.env.SITEINTENT_RANKABILITY_MODEL ||
  "gpt-5-mini";
const TOP_N = 10;
const API_TIMEOUT_MS = 180000;

const WEB_SEARCH_TOOL = {
  type: "web_search",
  user_location: {
    type: "approximate",
    country: "AU",
    region: "New South Wales",
    city: "Sydney",
    timezone: "Australia/Sydney"
  }
};

const DISCOVERY_WEIGHTS = {
  search_result_presence: 20,
  source_path_diversity: 25,
  third_party_source_strength: 25
};
const DISCOVERY_WEIGHT_TOTAL = Object.values(DISCOVERY_WEIGHTS).reduce((sum, weight) => sum + weight, 0);

const QUESTION_TEMPLATES = [
  "What are the top 10 visitor management system websites or providers for an Australian business?",
  "Recommend the top 10 visitor management system websites or providers for an Australian business.",
  "Which 10 visitor management system websites or providers would you shortlist for an Australian business?",
  "Give me the top 10 visitor management system websites or providers for an Australian business.",
  "If you had to choose 10 visitor management system websites or providers for an Australian business, which would you include?"
];

const DISCOVERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["top_candidates", "summary"],
  properties: {
    summary: { type: "string" },
    top_candidates: {
      type: "array",
      minItems: TOP_N,
      maxItems: TOP_N,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rank", "name", "website", "reason", "entity_match_clarity_score", "discovery_sources"],
        properties: {
          rank: { type: "integer", minimum: 1, maximum: TOP_N },
          name: { type: "string" },
          website: { type: "string" },
          reason: { type: "string" },
          entity_match_clarity_score: { type: "number", minimum: 0, maximum: 100 },
          discovery_sources: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["source_name", "source_domain", "source_type", "source_url", "influence", "evidence_found"],
              properties: {
                source_name: { type: "string" },
                source_domain: { type: "string" },
                source_type: { type: "string" },
                source_url: { type: "string" },
                influence: { type: "string", enum: ["high", "medium", "low"] },
                evidence_found: { type: "string" }
              }
            }
          }
        }
      }
    }
  }
};

const RANKABILITY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["factor_scores", "summary", "warnings"],
  properties: {
    factor_scores: {
      type: "object",
      additionalProperties: false,
      required: [
        "website_content_relevance_completeness",
        "reviews_customer_reputation",
        "third_party_authority_external_validation",
        "on_site_trust_signals",
        "location_availability_service_coverage",
        "price_value_clarity"
      ],
      properties: Object.fromEntries(
        [
          "website_content_relevance_completeness",
          "reviews_customer_reputation",
          "third_party_authority_external_validation",
          "on_site_trust_signals",
          "location_availability_service_coverage",
          "price_value_clarity"
        ].map((factor) => [
          factor,
          {
            type: "object",
            additionalProperties: false,
            required: ["score", "confidence", "could_verify_signal", "evidence", "sources"],
            properties: {
              score: { type: "number", minimum: 0, maximum: 100 },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              could_verify_signal: { type: "boolean" },
              evidence: { type: "string" },
              sources: { type: "array", items: { type: "string" }, maxItems: 8 }
            }
          }
        ])
      )
    },
    summary: { type: "string" },
    warnings: { type: "array", items: { type: "string" }, maxItems: 8 }
  }
};

const RANKABILITY_WEIGHTS = {
  website_content_relevance_completeness: 30,
  reviews_customer_reputation: 5,
  third_party_authority_external_validation: 30,
  on_site_trust_signals: 20,
  location_availability_service_coverage: 5,
  price_value_clarity: 10
};

await loadRootEnv();

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required.");
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const discoveryRuns = [];
for (let index = 0; index < QUESTION_TEMPLATES.length; index++) {
  const question = QUESTION_TEMPLATES[index];
  console.log(`[discovery ${index + 1}/${QUESTION_TEMPLATES.length}] Starting`);
  const response = await createResponseWithModelFallback(client, {
    model: MODEL,
    input: [
      {
        role: "system",
        content: [
          "You are discovering official vendor websites for a research run.",
          "Use web search.",
          "Return only JSON matching the schema.",
          "Return exactly 10 official provider websites.",
          "Do not return review sites, directories, or listicles as the main candidates.",
          "For each candidate, include the source paths that helped justify inclusion.",
          "Use source_type search_engine_result when a search results page, SERP ranking, or search-result snippet helped identify a website."
        ].join(" ")
      },
      {
        role: "user",
        content: question
      }
    ],
    tools: [WEB_SEARCH_TOOL],
    tool_choice: "required",
    text: {
      format: {
        type: "json_schema",
        name: "visitor_management_top10_discovery",
        strict: true,
        schema: DISCOVERY_SCHEMA
      }
    }
  });

  const payload = JSON.parse(stripJsonFence(response.output_text || ""));
  discoveryRuns.push({
    prompt_variation: index + 1,
    question,
    summary: payload.summary,
    candidates: payload.top_candidates.map((candidate, candidateIndex) => ({
      rank: Number(candidate.rank) || candidateIndex + 1,
      name: String(candidate.name || ""),
      website: String(candidate.website || ""),
      reason: String(candidate.reason || ""),
      entity_match_clarity_score: clampScore(candidate.entity_match_clarity_score),
      discovery_sources: normalizeSources(candidate.discovery_sources)
    }))
  });
  console.log(`[discovery ${index + 1}/${QUESTION_TEMPLATES.length}] Complete`);
}

const aggregatedCandidates = aggregateCandidates(discoveryRuns);
const canonicalTop10 = aggregatedCandidates.slice(0, TOP_N);
const scoredResults = [];

for (const candidate of canonicalTop10) {
  console.log(`[rankability ${scoredResults.length + 1}/${canonicalTop10.length}] ${candidate.name}`);
  const rankability = await scoreRankability(client, candidate, canonicalTop10);
  scoredResults.push({
    rank: scoredResults.length + 1,
    name: candidate.name,
    website: candidate.website,
    domain: candidate.domain,
    discovery_appearance_count: candidate.appearance_count,
    discovery_average_rank: candidate.average_rank,
    discovery_prompt_variations: candidate.prompt_variations,
    discoverability_score: candidate.discoverability_score,
    discoverability_factors: candidate.discoverability_factors,
    discoverability_sources: candidate.sources,
    rankability_score: rankability.weighted_total_score,
    rankability_factors: rankability.factor_scores,
    rankability_summary: rankability.summary,
    rankability_warnings: rankability.warnings
  });
}

const document = {
  generated_at: new Date().toISOString(),
  requested_model: MODEL,
  discovery_runs: discoveryRuns,
  aggregated_candidates: aggregatedCandidates,
  canonical_top_10: canonicalTop10,
  scored_results: scoredResults
};

await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(`Visitor management top-10 scan complete: ${OUTPUT_FILE}`);

async function scoreRankability(client, candidate, canonicalTop10) {
  const competitorContext = canonicalTop10
    .filter((item) => item.domain !== candidate.domain)
    .slice(0, 5)
    .map((item) => `${item.name} - ${item.website}`)
    .join("\n");

  const response = await createResponseWithModelFallback(client, {
    model: MODEL,
    input: [
      {
        role: "system",
        content: [
          "You are scoring website rankability for AI recommendations.",
          "Use web search for current external evidence.",
          "Return only JSON matching the provided schema.",
          "Do not invent URLs or sources.",
          "Score each fixed factor independently."
        ].join(" ")
      },
      {
        role: "user",
        content: [
          "Category: visitor management system",
          "User context: an Australian business evaluating vendor websites",
          `Website name: ${candidate.name}`,
          `Website URL: ${candidate.website}`,
          "",
          "Score this website for Rankability.",
          "For each factor return a 0-100 score, confidence, could_verify_signal, evidence, and sources.",
          "",
          "Fixed factors:",
          "- website_content_relevance_completeness",
          "- reviews_customer_reputation",
          "- third_party_authority_external_validation",
          "- on_site_trust_signals",
          "- location_availability_service_coverage",
          "- price_value_clarity",
          "",
          "Competitor context:",
          competitorContext || "No competitor context provided."
        ].join("\n")
      }
    ],
    tools: [WEB_SEARCH_TOOL],
    tool_choice: "required",
    text: {
      format: {
        type: "json_schema",
        name: "visitor_management_rankability",
        strict: true,
        schema: RANKABILITY_SCHEMA
      }
    }
  });

  const payload = JSON.parse(stripJsonFence(response.output_text || ""));
  const factorScores = {};
  for (const [factor, weight] of Object.entries(RANKABILITY_WEIGHTS)) {
    const current = payload.factor_scores?.[factor] || {};
    const score = clampScore(current.score);
    factorScores[factor] = {
      score,
      weight,
      weighted_contribution: roundOne(score * (weight / 100)),
      confidence: normalizeConfidence(current.confidence),
      could_verify_signal: Boolean(current.could_verify_signal),
      evidence: String(current.evidence || ""),
      sources: Array.isArray(current.sources) ? current.sources.map((source) => String(source)) : []
    };
  }

  return {
    factor_scores: factorScores,
    weighted_total_score: roundOne(
      Object.values(factorScores).reduce((sum, current) => sum + current.weighted_contribution, 0)
    ),
    summary: String(payload.summary || ""),
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map((warning) => String(warning)) : []
  };
}

function aggregateCandidates(runs) {
  const byDomain = new Map();

  for (const run of runs) {
    for (const candidate of run.candidates) {
      const domain = normalizeDomain(candidate.website || candidate.name);
      if (!domain) {
        continue;
      }

      const existing = byDomain.get(domain);
      if (existing) {
        existing.appearance_count += 1;
        existing.ranks.push(candidate.rank);
        existing.prompt_variations.push(run.prompt_variation);
        existing.reasons.push(candidate.reason);
        existing.entity_scores.push(candidate.entity_match_clarity_score);
        existing.sources.push(...candidate.discovery_sources);
      } else {
        byDomain.set(domain, {
          name: candidate.name,
          website: candidate.website,
          domain,
          appearance_count: 1,
          ranks: [candidate.rank],
          prompt_variations: [run.prompt_variation],
          reasons: [candidate.reason],
          entity_scores: [candidate.entity_match_clarity_score],
          sources: [...candidate.discovery_sources]
        });
      }
    }
  }

  return [...byDomain.values()]
    .map((candidate) => {
      const averageRank = roundOne(candidate.ranks.reduce((sum, value) => sum + value, 0) / candidate.ranks.length);
      const uniqueSourceTypes = [...new Set(candidate.sources.map((source) => source.source_type))];
      const sourcePathDiversity = roundOne((Math.min(uniqueSourceTypes.length, 5) / 5) * 100);
      const thirdPartySourceStrength = roundOne(computeSourceStrength(candidate.sources));
      const searchResultPresence = roundOne(computeSourceStrength(candidate.sources.filter(isSearchResultSource)));
      const discoverabilityFactors = {
        search_result_presence: buildDiscoverabilityFactor(searchResultPresence, DISCOVERY_WEIGHTS.search_result_presence),
        source_path_diversity: buildDiscoverabilityFactor(sourcePathDiversity, DISCOVERY_WEIGHTS.source_path_diversity),
        third_party_source_strength: buildDiscoverabilityFactor(thirdPartySourceStrength, DISCOVERY_WEIGHTS.third_party_source_strength)
      };

      return {
        name: candidate.name,
        website: candidate.website,
        domain: candidate.domain,
        appearance_count: candidate.appearance_count,
        average_rank: averageRank,
        prompt_variations: [...new Set(candidate.prompt_variations)].sort((a, b) => a - b),
        reasons: [...new Set(candidate.reasons)],
        sources: dedupeSources(candidate.sources),
        discoverability_factors: discoverabilityFactors,
        discoverability_score: roundOne(
          Object.values(discoverabilityFactors).reduce((sum, factor) => sum + factor.weighted_contribution, 0)
        )
      };
    })
    .sort((a, b) => {
      if (b.appearance_count !== a.appearance_count) {
        return b.appearance_count - a.appearance_count;
      }
      return a.average_rank - b.average_rank;
    });
}

function buildDiscoverabilityFactor(score, weight) {
  return {
    score,
    weight,
    weighted_contribution: roundOne(score * (weight / DISCOVERY_WEIGHT_TOTAL))
  };
}

function computeSourceStrength(sources) {
  if (!sources.length) {
    return 0;
  }

  return sources.reduce((sum, source) => sum + getSourceTypeWeight(source.source_type) * getInfluenceWeight(source.influence), 0) / sources.length * 100;
}

function getSourceTypeWeight(sourceType) {
  switch (sourceType) {
    case "search_engine_result":
    case "review_platform":
    case "google_business_profile":
    case "government_register":
      return 1;
    case "editorial_media":
      return 0.95;
    case "industry_directory":
      return 0.9;
    case "marketplace":
      return 0.85;
    case "official_site":
      return 0.75;
    case "forum":
      return 0.65;
    case "social":
      return 0.5;
    default:
      return 0.45;
  }
}

function getInfluenceWeight(influence) {
  if (influence === "high") {
    return 1;
  }
  if (influence === "medium") {
    return 0.7;
  }
  return 0.45;
}

function normalizeSources(value) {
  return Array.isArray(value)
    ? value.map((source) => ({
        source_name: String(source.source_name || ""),
        source_domain: String(source.source_domain || ""),
        source_type: normalizeSourceType(source.source_type),
        source_url: String(source.source_url || ""),
        influence: source.influence === "high" || source.influence === "medium" || source.influence === "low" ? source.influence : "low",
        evidence_found: String(source.evidence_found || "")
      }))
    : [];
}

function normalizeSourceType(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "search_engine_result":
    case "search_result":
    case "serp":
    case "serp_result":
    case "google_search_result":
    case "bing_search_result":
      return "search_engine_result";
    case "official_site":
    case "review_platform":
    case "google_business_profile":
    case "industry_directory":
    case "editorial_media":
    case "government_register":
    case "marketplace":
    case "forum":
    case "social":
      return normalized;
    default:
      return "unknown";
  }
}

function isSearchResultSource(source) {
  if (source.source_type === "search_engine_result") {
    return true;
  }

  const text = [
    source.source_name,
    source.source_domain,
    source.source_url
  ].join(" ").toLowerCase();
  return /\b(serp|search results page|search engine result|search engine results|google results|bing results|google search|bing search|search snippet|ranking result)\b/.test(text);
}

function dedupeSources(sources) {
  const seen = new Set();
  const result = [];
  for (const source of sources) {
    const key = [
      source.source_domain,
      source.source_url,
      source.source_type,
      source.influence,
      source.evidence_found
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(source);
  }
  return result;
}

async function createResponseWithModelFallback(client, request) {
  try {
    return await createResponseWithTimeout(client, request);
  } catch (error) {
    throw error;
  }
}

async function createResponseWithTimeout(client, request) {
  const model = request.model || "unknown";
  let timeoutId;

  try {
    return await Promise.race([
      client.responses.create(request),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`OpenAI response timed out after ${API_TIMEOUT_MS}ms for model ${model}.`));
        }, API_TIMEOUT_MS);
      })
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function clampScore(value) {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value || ""));
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return roundOne(Math.min(100, Math.max(0, numeric)));
}

function normalizeConfidence(value) {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function normalizeDomain(value) {
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return String(value || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

function stripJsonFence(value) {
  return value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

async function loadRootEnv() {
  for (const filename of [".env", ".env.txt"]) {
    const filePath = path.resolve(process.cwd(), filename);
    try {
      const content = await fs.readFile(filePath, "utf8");
      parseEnvContent(content);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function parseEnvContent(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
