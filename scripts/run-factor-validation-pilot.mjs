#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import OpenAI from "openai";

const SCRIPT_VERSION = "1.0.0";
const OUTPUT_DIR = path.resolve(process.cwd(), "research-results");
await loadRootEnv();

const MODEL = process.env.OPENAI_RESEARCH_MODEL || "gpt-5.5";
const OUTPUT_FILE = path.resolve(
  process.cwd(),
  process.env.FACTOR_PILOT_OUTPUT_FILE || path.join("research-results", "factor-validation-pilot.json")
);
const DRY_RUN = process.env.FACTOR_PILOT_DRY_RUN === "1" || process.argv.includes("--dry-run");
const CATEGORY_LIMIT = parsePositiveInteger(process.env.FACTOR_PILOT_CATEGORY_LIMIT);
const REPEAT_LIMIT = parsePositiveInteger(process.env.FACTOR_PILOT_REPEAT_LIMIT);
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const USER_LOCATION = {
  country: "AU",
  region: "NSW",
  city: "Sydney",
  timezone: "Australia/Sydney"
};

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

const CATEGORIES = [
  {
    id: "visitor_management_system",
    name: "Visitor management system",
    context: "an Australian business comparing vendor websites",
    top10_question: "What are the top 10 visitor management system websites or providers for an Australian business?"
  },
  {
    id: "accounting_software",
    name: "Accounting software",
    context: "an Australian small business",
    top10_question: "What are the top 10 accounting software websites or providers for an Australian small business?"
  },
  {
    id: "cleaning_services",
    name: "Cleaning services",
    context: "a customer in Sydney, NSW, Australia",
    top10_question: "What are the top 10 cleaning service websites or providers for a customer in Sydney, NSW, Australia?"
  },
  {
    id: "pool_towels",
    name: "Pool towels",
    context: "a shopper in Australia",
    top10_question: "What are the top 10 pool towel websites or products for a shopper in Australia?"
  },
  {
    id: "dog_grooming",
    name: "Dog grooming",
    context: "a pet owner in Sydney, NSW, Australia",
    top10_question: "What are the top 10 dog grooming websites or providers for a pet owner in Sydney, NSW, Australia?"
  }
];

const FACTORS = [
  {
    id: "website_content_relevance_completeness",
    label: "Website content relevance and completeness",
    weight: 40,
    instruction:
      "Score only how well the website's own content proves relevance and completeness for the query. Include service/product fit, features, product materials, menus, service range, compliance, coverage details, pricing pages, booking paths, and category-specific information here."
  },
  {
    id: "reviews_customer_reputation",
    label: "Reviews and customer reputation",
    weight: 25,
    instruction:
      "Score only customer review and reputation signals. Consider review volume, review quality, recency, rating consistency, customer sentiment, complaints, and platform credibility. Do not score website content here except as evidence of reviews/testimonials."
  },
  {
    id: "third_party_authority_external_validation",
    label: "Third-party authority and external validation",
    weight: 15,
    instruction:
      "Score only independent external validation. Consider editorial lists, awards, government or industry registers, reputable directories, marketplace rankings, expert reviews, forum consensus, and credible media mentions."
  },
  {
    id: "on_site_trust_signals",
    label: "On-site trust signals",
    weight: 10,
    instruction:
      "Score only trust signals visible on the website itself. Consider clear contact details, ABN/company details, security/privacy pages, guarantees, insurance, certifications, policies, case studies, testimonials, client logos, team/about pages, and professional presentation."
  },
  {
    id: "location_availability_service_coverage",
    label: "Location, availability, and service coverage",
    weight: 5,
    instruction:
      "Score only how well the website/provider fits the user's geography and availability needs. For local services, consider Sydney service area, proximity, booking availability, opening hours, and delivery/service logistics. For national products/software, consider Australian availability and local support."
  },
  {
    id: "price_value_clarity",
    label: "Price and value clarity",
    weight: 5,
    instruction:
      "Score only pricing and value clarity. Consider visible pricing, plan/product comparison, inclusions, value for money, free trials, quotes, shipping/extra fees, and whether a buyer can judge affordability."
  }
];

const SCORING_PROFILES = [
  {
    id: "original",
    label: "Original pilot weights",
    weights: {
      website_content_relevance_completeness: 40,
      reviews_customer_reputation: 25,
      third_party_authority_external_validation: 15,
      on_site_trust_signals: 10,
      location_availability_service_coverage: 5,
      price_value_clarity: 5
    }
  },
  {
    id: "external_validation_v2",
    label: "External validation weighted model v2",
    weights: {
      website_content_relevance_completeness: 30,
      reviews_customer_reputation: 5,
      third_party_authority_external_validation: 30,
      on_site_trust_signals: 20,
      location_availability_service_coverage: 5,
      price_value_clarity: 10
    }
  },
  {
    id: "best_fit_global",
    label: "Best fit global pilot weights",
    weights: {
      website_content_relevance_completeness: 40,
      reviews_customer_reputation: 5,
      third_party_authority_external_validation: 25,
      on_site_trust_signals: 20,
      location_availability_service_coverage: 0,
      price_value_clarity: 10
    }
  }
];

const ACTIVE_SCORING_PROFILE_ID = process.env.FACTOR_PILOT_SCORING_PROFILE || "external_validation_v2";

const DISCOVERY_REPEATS = [1, 2, 3];
const SCORING_REPEATS = [1, 2, 3];
const SOURCE_TYPES = [
  "official_site",
  "review_platform",
  "google_business_profile",
  "industry_directory",
  "editorial_media",
  "government_register",
  "marketplace",
  "forum",
  "social",
  "unknown"
];

const TOP10_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["top_10"],
  properties: {
    top_10: {
      type: "array",
      minItems: 10,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rank", "name", "website", "reason"],
        properties: {
          rank: { type: "integer", minimum: 1, maximum: 10 },
          name: { type: "string" },
          website: { type: "string" },
          reason: { type: "string" }
        }
      }
    }
  }
};

const FACTOR_SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["factor_id", "scores"],
  properties: {
    factor_id: { type: "string", enum: FACTORS.map((factor) => factor.id) },
    scores: {
      type: "array",
      minItems: 10,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rank", "name", "website", "score", "confidence", "could_verify_signal", "evidence"],
        properties: {
          rank: { type: "integer", minimum: 1, maximum: 10 },
          name: { type: "string" },
          website: { type: "string" },
          score: { type: "number", minimum: 0, maximum: 100 },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          could_verify_signal: { type: "boolean" },
          evidence: { type: "string" }
        }
      }
    }
  }
};

const TRUST_AUDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["trust_sources", "review_platforms_considered", "summary"],
  properties: {
    summary: { type: "string" },
    trust_sources: {
      type: "array",
      minItems: 0,
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "source_name",
          "source_domain",
          "source_type",
          "influence_on_ranking",
          "reason_ai_trusted_source",
          "websites_supported"
        ],
        properties: {
          source_name: { type: "string" },
          source_domain: { type: "string" },
          source_type: { type: "string", enum: SOURCE_TYPES },
          influence_on_ranking: { type: "string", enum: ["high", "medium", "low"] },
          reason_ai_trusted_source: { type: "string" },
          websites_supported: { type: "array", items: { type: "string" } }
        }
      }
    },
    review_platforms_considered: {
      type: "array",
      minItems: 0,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["platform", "used", "reason"],
        properties: {
          platform: { type: "string" },
          used: { type: "boolean" },
          reason: { type: "string" }
        }
      }
    }
  }
};

const SYSTEM_PROMPT = [
  "You are running a research experiment about how AI evaluates websites for recommendations.",
  "Use web search for current evidence.",
  "Return only JSON matching the provided schema.",
  "Do not invent URLs. Use an empty string if a website URL cannot be verified.",
  "When scoring a single factor, isolate that factor only. Do not reward a website for other strengths."
].join(" ");

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const client = DRY_RUN ? null : createOpenAIClient();
  const categories = CATEGORY_LIMIT ? CATEGORIES.slice(0, CATEGORY_LIMIT) : CATEGORIES;
  const scoringRepeats = REPEAT_LIMIT ? SCORING_REPEATS.slice(0, REPEAT_LIMIT) : SCORING_REPEATS;
  const document = await loadOrCreateDocument(categories, scoringRepeats);

  for (const category of categories) {
    const categoryRun = getOrCreateCategoryRun(document, category);
    refreshCategory(categoryRun);
    refreshDocument(document);
    await saveDocument(document);

    for (const repeat of DISCOVERY_REPEATS) {
      if (categoryRun.discovery_runs.some((run) => run.repeat === repeat && !run.error && isSameRunMode(run))) {
        continue;
      }

      const run = DRY_RUN
        ? createDryDiscoveryRun(category, repeat)
        : await runDiscovery(client, category, repeat);
      replaceByRepeat(categoryRun.discovery_runs, run);
      refreshCategory(categoryRun);
      refreshDocument(document);
      await saveDocument(document);
    }

    if (!categoryRun.canonical_top_10.length) {
      const firstSuccessful = categoryRun.discovery_runs.find((run) => !run.error && run.top_10.length === 10);
      categoryRun.canonical_top_10 = firstSuccessful?.top_10 ?? [];
      refreshCategory(categoryRun);
      refreshDocument(document);
      await saveDocument(document);
    }

    for (const factor of FACTORS) {
      for (const repeat of scoringRepeats) {
        if (
          categoryRun.factor_scoring_runs.some(
            (run) => run.factor_id === factor.id && run.repeat === repeat && !run.error && isSameRunMode(run)
          )
        ) {
          continue;
        }

        const run = DRY_RUN
          ? createDryFactorRun(category, categoryRun.canonical_top_10, factor, repeat)
          : await runFactorScoring(client, category, categoryRun.canonical_top_10, factor, repeat);
        replaceFactorRun(categoryRun.factor_scoring_runs, run);
        refreshCategory(categoryRun);
        refreshDocument(document);
        await saveDocument(document);
      }
    }

    if (!categoryRun.trust_audit || categoryRun.trust_audit.error || !isSameRunMode(categoryRun.trust_audit)) {
      categoryRun.trust_audit = DRY_RUN
        ? createDryTrustAudit(category, categoryRun.canonical_top_10)
        : await runTrustAudit(client, category, categoryRun.canonical_top_10);
      refreshCategory(categoryRun);
      refreshDocument(document);
      await saveDocument(document);
    }
  }

  document.analysis = buildOverallAnalysis(document.categories);
  refreshDocument(document);
  await saveDocument(document);

  console.log(`Factor validation pilot complete. Results are in ${OUTPUT_FILE}`);
  if (DRY_RUN) {
    console.log("Dry-run mode was enabled; no OpenAI API calls were made.");
  }
}

async function runDiscovery(client, category, repeat) {
  const startedAt = new Date().toISOString();
  try {
    const response = await createResponseWithRetry(client, {
      model: MODEL,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            category.top10_question,
            "Use web search.",
            "Return exactly 10 ranked official websites/providers.",
            "Prefer official provider websites over review/listing pages unless the listing is the provider's main online presence."
          ].join("\n")
        }
      ],
      tools: [WEB_SEARCH_TOOL],
      tool_choice: "required",
      text: responseTextFormat("factor_validation_top10", TOP10_SCHEMA)
    });
    const payload = parseResponseJson(response);
    return {
      repeat,
      dry_run: false,
      uses_web_search: containsWebSearchCall(response),
      top_10: normalizeTop10(payload.top_10),
      web_sources: extractWebSources(response),
      raw_response: sanitizeRawResponse(response),
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error: null
    };
  } catch (error) {
    return createErrorRun({ repeat, startedAt, error });
  }
}

async function runFactorScoring(client, category, websites, factor, repeat) {
  const startedAt = new Date().toISOString();
  try {
    const response = await createResponseWithRetry(client, {
      model: MODEL,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Category: ${category.name}`,
            `User context: ${category.context}`,
            `Factor to score: ${factor.id} (${factor.label})`,
            `Factor definition: ${factor.instruction}`,
            "",
            "Score only this factor for each of the 10 websites below.",
            "Use web search to verify evidence.",
            "Return a 0-100 score for each website. A score of 100 means unusually strong evidence for this factor; 0 means no relevant evidence found.",
            "If evidence is weak or not found, use a lower score and set could_verify_signal to false.",
            "",
            formatWebsiteList(websites)
          ].join("\n")
        }
      ],
      tools: [WEB_SEARCH_TOOL],
      tool_choice: "required",
      text: responseTextFormat("factor_validation_factor_score", FACTOR_SCORE_SCHEMA)
    });
    const payload = parseResponseJson(response);
    return {
      factor_id: factor.id,
      factor_label: factor.label,
      factor_weight: factor.weight,
      repeat,
      dry_run: false,
      uses_web_search: containsWebSearchCall(response),
      scores: normalizeFactorScores(payload.scores, websites),
      web_sources: extractWebSources(response),
      raw_response: sanitizeRawResponse(response),
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error: null
    };
  } catch (error) {
    return createErrorRun({
      factor_id: factor.id,
      factor_label: factor.label,
      factor_weight: factor.weight,
      repeat,
      startedAt,
      error
    });
  }
}

async function runTrustAudit(client, category, websites) {
  const startedAt = new Date().toISOString();
  try {
    const response = await createResponseWithRetry(client, {
      model: MODEL,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Category: ${category.name}`,
            `User context: ${category.context}`,
            "",
            "Use web search to audit which trust sources matter when evaluating these 10 websites.",
            "Identify review platforms and authority sources such as Google Reviews, ProductReview, Trustpilot, Tripadvisor, G2, Capterra, Reddit, directories, editorial media, government/industry registers, marketplaces, social platforms, and official websites.",
            "Explain why each source was trusted and which websites it supported.",
            "",
            formatWebsiteList(websites)
          ].join("\n")
        }
      ],
      tools: [WEB_SEARCH_TOOL],
      tool_choice: "required",
      text: responseTextFormat("factor_validation_trust_audit", TRUST_AUDIT_SCHEMA)
    });
    const payload = parseResponseJson(response);
    return {
      dry_run: false,
      uses_web_search: containsWebSearchCall(response),
      summary: payload.summary,
      trust_sources: payload.trust_sources ?? [],
      review_platforms_considered: payload.review_platforms_considered ?? [],
      web_sources: extractWebSources(response),
      raw_response: sanitizeRawResponse(response),
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error: null
    };
  } catch (error) {
    return {
      dry_run: false,
      uses_web_search: false,
      summary: "",
      trust_sources: [],
      review_platforms_considered: [],
      web_sources: [],
      raw_response: {},
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error: getErrorMessage(error)
    };
  }
}

function refreshCategory(categoryRun) {
  categoryRun.websites = buildWebsiteResults(categoryRun);
  categoryRun.analysis = buildCategoryAnalysis(categoryRun);
}

function buildWebsiteResults(categoryRun) {
  const activeProfile = getActiveScoringProfile();
  return categoryRun.canonical_top_10.map((website) => {
    const factorScores = {};

    for (const factor of FACTORS) {
      const factorRuns = categoryRun.factor_scoring_runs.filter(
        (run) => run.factor_id === factor.id && !run.error && isSameRunMode(run)
      );
      const matchingScores = factorRuns
        .map((run) => run.scores.find((score) => score.rank === website.rank || sameWebsite(score, website)))
        .filter(Boolean);
      const repeatScores = matchingScores.map((score) => clampScore(score.score));
      const averageScore = average(repeatScores);

      factorScores[factor.id] = {
        repeat_scores: repeatScores,
        average_score: roundOne(averageScore),
        evidence: matchingScores.map((score) => score.evidence).filter(Boolean),
        sources: uniqueStrings(factorRuns.flatMap((run) => run.web_sources ?? [])),
        confidence: matchingScores.map((score) => score.confidence).filter(Boolean),
        could_verify_signal: matchingScores.map((score) => Boolean(score.could_verify_signal))
      };
    }

    const profileTotals = Object.fromEntries(
      SCORING_PROFILES.map((profile) => [profile.id, roundOne(computeProfileTotal(factorScores, profile))])
    );

    return {
      rank: website.rank,
      name: website.name,
      website: website.website,
      factor_scores: factorScores,
      weighted_total_score: profileTotals[activeProfile.id],
      active_scoring_profile_id: activeProfile.id,
      profile_totals: profileTotals,
      group: website.rank <= 5 ? "top_5" : "rank_6_to_10"
    };
  });
}

function buildCategoryAnalysis(categoryRun) {
  const websites = categoryRun.websites ?? [];
  const top5 = websites.filter((site) => site.group === "top_5");
  const ranks6to10 = websites.filter((site) => site.group === "rank_6_to_10");
  const top5Average = average(top5.map((site) => site.weighted_total_score));
  const ranks6to10Average = average(ranks6to10.map((site) => site.weighted_total_score));
  const factorGaps = {};

  for (const factor of FACTORS) {
    const topAverage = average(top5.map((site) => site.factor_scores[factor.id]?.average_score ?? 0));
    const lowerAverage = average(ranks6to10.map((site) => site.factor_scores[factor.id]?.average_score ?? 0));
    factorGaps[factor.id] = {
      top_5_average: roundOne(topAverage),
      rank_6_to_10_average: roundOne(lowerAverage),
      gap: roundOne(topAverage - lowerAverage)
    };
  }

  return {
    top_5_average_weighted_score: roundOne(top5Average),
    rank_6_to_10_average_weighted_score: roundOne(ranks6to10Average),
    weighted_score_gap: roundOne(top5Average - ranks6to10Average),
    top_5_scored_higher: top5Average > ranks6to10Average,
    active_scoring_profile_id: getActiveScoringProfile().id,
    factor_gaps: factorGaps,
    scoring_profile_analysis: buildScoringProfileAnalysis(websites),
    source_platform_frequency: buildSourceFrequency(categoryRun.trust_audit?.trust_sources ?? [])
  };
}

function buildOverallAnalysis(categoryRuns) {
  const categories = categoryRuns.map((categoryRun) => categoryRun.analysis).filter(Boolean);
  const factorGaps = {};
  for (const factor of FACTORS) {
    factorGaps[factor.id] = {
      average_gap: roundOne(average(categories.map((analysis) => analysis.factor_gaps?.[factor.id]?.gap ?? 0)))
    };
  }

  const allTrustSources = categoryRuns.flatMap((categoryRun) => categoryRun.trust_audit?.trust_sources ?? []);
  return {
    categories_where_top_5_scored_higher: categories.filter((analysis) => analysis.top_5_scored_higher).length,
    category_count: categories.length,
    average_top_5_weighted_score: roundOne(average(categories.map((analysis) => analysis.top_5_average_weighted_score))),
    average_rank_6_to_10_weighted_score: roundOne(average(categories.map((analysis) => analysis.rank_6_to_10_average_weighted_score))),
    average_weighted_score_gap: roundOne(average(categories.map((analysis) => analysis.weighted_score_gap))),
    factor_average_gaps: factorGaps,
    scoring_profile_analysis: buildOverallScoringProfileAnalysis(categoryRuns),
    trust_source_frequency: buildSourceFrequency(allTrustSources)
  };
}

function buildScoringProfileAnalysis(websites) {
  return Object.fromEntries(
    SCORING_PROFILES.map((profile) => {
      const sorted = [...websites].sort((a, b) => b.profile_totals[profile.id] - a.profile_totals[profile.id]);
      const top5 = websites.filter((site) => site.group === "top_5");
      const lower = websites.filter((site) => site.group === "rank_6_to_10");
      const originalTop5 = new Set(top5.map((site) => site.rank));
      const top5Average = average(top5.map((site) => site.profile_totals[profile.id]));
      const lowerAverage = average(lower.map((site) => site.profile_totals[profile.id]));

      return [
        profile.id,
        {
          label: profile.label,
          weights: profile.weights,
          top_5_average: roundOne(top5Average),
          rank_6_to_10_average: roundOne(lowerAverage),
          weighted_score_gap: roundOne(top5Average - lowerAverage),
          sorted_rank_order: sorted.map((site) => site.rank),
          top_5_overlap_count: sorted.slice(0, 5).filter((site) => originalTop5.has(site.rank)).length,
          inversion_count: countRankInversions(websites, profile)
        }
      ];
    })
  );
}

function buildOverallScoringProfileAnalysis(categoryRuns) {
  return Object.fromEntries(
    SCORING_PROFILES.map((profile) => {
      const profileAnalyses = categoryRuns
        .map((categoryRun) => categoryRun.analysis?.scoring_profile_analysis?.[profile.id])
        .filter(Boolean);
      return [
        profile.id,
        {
          label: profile.label,
          weights: profile.weights,
          average_top_5_score: roundOne(average(profileAnalyses.map((analysis) => analysis.top_5_average))),
          average_rank_6_to_10_score: roundOne(average(profileAnalyses.map((analysis) => analysis.rank_6_to_10_average))),
          average_weighted_score_gap: roundOne(average(profileAnalyses.map((analysis) => analysis.weighted_score_gap))),
          top_5_overlap_count: profileAnalyses.reduce((sum, analysis) => sum + analysis.top_5_overlap_count, 0),
          top_5_overlap_possible: profileAnalyses.length * 5,
          inversion_count: profileAnalyses.reduce((sum, analysis) => sum + analysis.inversion_count, 0)
        }
      ];
    })
  );
}

function buildSourceFrequency(sources) {
  const byDomain = {};
  const byType = {};
  const byInfluence = {};
  for (const source of sources) {
    const domain = source.source_domain || source.source_name || "unknown";
    byDomain[domain] = (byDomain[domain] ?? 0) + 1;
    byType[source.source_type] = (byType[source.source_type] ?? 0) + 1;
    byInfluence[source.influence_on_ranking] = (byInfluence[source.influence_on_ranking] ?? 0) + 1;
  }

  return {
    by_domain: sortCountObject(byDomain),
    by_type: sortCountObject(byType),
    by_influence: sortCountObject(byInfluence)
  };
}

function computeProfileTotal(factorScores, profile) {
  return FACTORS.reduce((total, factor) => {
    const score = factorScores[factor.id]?.average_score ?? 0;
    const weight = profile.weights[factor.id] ?? 0;
    return total + score * (weight / 100);
  }, 0);
}

function getActiveScoringProfile() {
  return SCORING_PROFILES.find((profile) => profile.id === ACTIVE_SCORING_PROFILE_ID) ?? SCORING_PROFILES[0];
}

function countRankInversions(websites, profile) {
  let inversions = 0;
  for (let i = 0; i < websites.length; i++) {
    for (let j = i + 1; j < websites.length; j++) {
      if (websites[i].profile_totals[profile.id] < websites[j].profile_totals[profile.id]) {
        inversions++;
      }
    }
  }
  return inversions;
}

function createDryDiscoveryRun(category, repeat) {
  const startedAt = new Date().toISOString();
  return {
    repeat,
    dry_run: true,
    uses_web_search: true,
    top_10: Array.from({ length: 10 }, (_, index) => ({
      rank: index + 1,
      name: `Dry ${category.name} ${index + 1}`,
      website: `https://example.com/${category.id}-${index + 1}`,
      reason: `Synthetic dry-run top-10 reason ${index + 1}.`
    })),
    web_sources: ["https://example.com/dry-source"],
    raw_response: { dry_run: true },
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    error: null
  };
}

function createDryFactorRun(category, websites, factor, repeat) {
  const startedAt = new Date().toISOString();
  return {
    factor_id: factor.id,
    factor_label: factor.label,
    factor_weight: factor.weight,
    repeat,
    dry_run: true,
    uses_web_search: true,
    scores: websites.map((website) => ({
      rank: website.rank,
      name: website.name,
      website: website.website,
      score: Math.max(20, 92 - website.rank * 4 - repeat),
      confidence: "medium",
      could_verify_signal: true,
      evidence: `Synthetic dry-run evidence for ${factor.label}.`
    })),
    web_sources: ["https://example.com/dry-source"],
    raw_response: { dry_run: true },
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    error: null
  };
}

function createDryTrustAudit(category, websites) {
  const startedAt = new Date().toISOString();
  return {
    dry_run: true,
    uses_web_search: true,
    summary: `Synthetic trust audit for ${category.name}.`,
    trust_sources: [
      {
        source_name: "Example Review Platform",
        source_domain: "example.com",
        source_type: "review_platform",
        influence_on_ranking: "high",
        reason_ai_trusted_source: "Synthetic review platform signal.",
        websites_supported: websites.slice(0, 5).map((website) => website.name)
      }
    ],
    review_platforms_considered: [
      { platform: "Google Reviews", used: true, reason: "Synthetic dry-run platform." }
    ],
    web_sources: ["https://example.com/dry-source"],
    raw_response: { dry_run: true },
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    error: null
  };
}

function createErrorRun(options) {
  return {
    factor_id: options.factor_id,
    factor_label: options.factor_label,
    factor_weight: options.factor_weight,
    repeat: options.repeat,
    dry_run: false,
    uses_web_search: false,
    top_10: [],
    scores: [],
    web_sources: [],
    raw_response: {},
    started_at: options.startedAt,
    completed_at: new Date().toISOString(),
    error: getErrorMessage(options.error)
  };
}

async function loadOrCreateDocument(categories, scoringRepeats) {
  try {
    const existing = JSON.parse(await fs.readFile(OUTPUT_FILE, "utf8"));
    if (existing.metadata?.dry_run !== DRY_RUN) {
      return createDocument(categories, scoringRepeats);
    }

    existing.metadata = {
      ...existing.metadata,
      resumed_at: new Date().toISOString(),
      model: MODEL,
      dry_run: DRY_RUN,
      categories_requested: categories.map((category) => category.id),
      scoring_repeats_requested: scoringRepeats,
      scoring_profiles: SCORING_PROFILES,
      active_scoring_profile_id: getActiveScoringProfile().id,
      expected_live_calls: categories.length * (DISCOVERY_REPEATS.length + FACTORS.length * scoringRepeats.length + 1)
    };
    existing.categories ??= [];
    return existing;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    return createDocument(categories, scoringRepeats);
  }
}

function createDocument(categories, scoringRepeats) {
  return {
    metadata: {
      script: "scripts/run-factor-validation-pilot.mjs",
      script_version: SCRIPT_VERSION,
      run_id: RUN_ID,
      started_at: new Date().toISOString(),
      completed_at: null,
      model: MODEL,
      dry_run: DRY_RUN,
      user_location: USER_LOCATION,
      web_search_tool: WEB_SEARCH_TOOL,
      categories_requested: categories.map((category) => category.id),
      factors: FACTORS,
      scoring_profiles: SCORING_PROFILES,
      active_scoring_profile_id: getActiveScoringProfile().id,
      discovery_repeats: DISCOVERY_REPEATS,
      scoring_repeats_requested: scoringRepeats,
      expected_live_calls: categories.length * (DISCOVERY_REPEATS.length + FACTORS.length * scoringRepeats.length + 1),
      completed_calls: 0,
      failed_calls: 0
    },
    categories: [],
    analysis: null
  };
}

function getOrCreateCategoryRun(document, category) {
  let categoryRun = document.categories.find((run) => run.category_id === category.id);
  if (!categoryRun) {
    categoryRun = {
      category_id: category.id,
      category_name: category.name,
      context: category.context,
      discovery_runs: [],
      canonical_top_10: [],
      factor_scoring_runs: [],
      trust_audit: null,
      websites: [],
      analysis: null
    };
    document.categories.push(categoryRun);
  }

  return categoryRun;
}

function refreshDocument(document) {
  const allRuns = document.categories.flatMap((category) => [
    ...category.discovery_runs,
    ...category.factor_scoring_runs,
    ...(category.trust_audit ? [category.trust_audit] : [])
  ]);
  document.metadata.completed_calls = allRuns.filter((run) => !run.error && isSameRunMode(run)).length;
  document.metadata.failed_calls = allRuns.filter((run) => run.error && isSameRunMode(run)).length;
  document.metadata.completed_at = new Date().toISOString();
}

async function saveDocument(document) {
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

async function createResponseWithRetry(client, request, attempt = 1) {
  try {
    return await client.responses.create(request);
  } catch (error) {
    if (attempt >= 4 || !isRetryableError(error)) {
      throw error;
    }

    const delay = 1000 * 2 ** (attempt - 1);
    await sleep(delay);
    return createResponseWithRetry(client, request, attempt + 1);
  }
}

function createOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required in the environment, .env, or .env.txt.");
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function responseTextFormat(name, schema) {
  return {
    format: {
      type: "json_schema",
      name,
      strict: true,
      schema
    }
  };
}

function parseResponseJson(response) {
  const text = response.output_text || extractTextFromOutput(response.output);
  if (!text) {
    throw new Error("OpenAI response did not include output text.");
  }

  return JSON.parse(stripJsonFence(text));
}

function normalizeTop10(value) {
  return Array.isArray(value)
    ? value.slice(0, 10).map((item, index) => ({
        rank: clampRank(item.rank, index + 1),
        name: String(item.name ?? ""),
        website: String(item.website ?? ""),
        reason: String(item.reason ?? "")
      }))
    : [];
}

function normalizeFactorScores(value, websites) {
  const scores = Array.isArray(value) ? value : [];
  return websites.map((website, index) => {
    const score = scores.find((candidate) => candidate.rank === website.rank || sameWebsite(candidate, website)) ?? scores[index] ?? {};
    return {
      rank: website.rank,
      name: website.name,
      website: website.website,
      score: clampScore(score.score),
      confidence: ["high", "medium", "low"].includes(score.confidence) ? score.confidence : "low",
      could_verify_signal: Boolean(score.could_verify_signal),
      evidence: String(score.evidence ?? "")
    };
  });
}

function formatWebsiteList(websites) {
  return websites.map((website) => `${website.rank}. ${website.name} - ${website.website}`).join("\n");
}

function replaceByRepeat(runs, run) {
  const index = runs.findIndex((candidate) => candidate.repeat === run.repeat);
  if (index >= 0) {
    runs[index] = run;
  } else {
    runs.push(run);
  }
}

function replaceFactorRun(runs, run) {
  const index = runs.findIndex((candidate) => candidate.factor_id === run.factor_id && candidate.repeat === run.repeat);
  if (index >= 0) {
    runs[index] = run;
  } else {
    runs.push(run);
  }
}

function sameWebsite(a, b) {
  return normalizeUrl(a.website) === normalizeUrl(b.website) || String(a.name ?? "").toLowerCase() === String(b.name ?? "").toLowerCase();
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return String(value ?? "").toLowerCase();
  }
}

function containsWebSearchCall(response) {
  return JSON.stringify(response.output ?? []).includes('"web_search_call"');
}

function extractWebSources(response) {
  const sources = new Set();
  collectUrlsFromValue(response.output, sources);
  return [...sources];
}

function collectUrlsFromValue(value, sources) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrlsFromValue(item, sources);
    }
    return;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if ((key === "url" || key === "uri") && typeof child === "string" && /^https?:\/\//i.test(child)) {
        sources.add(child);
      }
      collectUrlsFromValue(child, sources);
    }
  }
}

function sanitizeRawResponse(response) {
  return {
    id: response.id,
    model: response.model,
    status: response.status,
    output_text: response.output_text,
    output: response.output,
    usage: response.usage
  };
}

function extractTextFromOutput(output) {
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? "")
    .filter(Boolean)
    .join("\n");
}

function stripJsonFence(text) {
  return text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
}

async function loadRootEnv() {
  for (const filename of [".env", ".env.txt"]) {
    const filePath = path.resolve(process.cwd(), filename);
    try {
      const content = await fs.readFile(filePath, "utf8");
      parseEnvContent(content);
      return filename;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return null;
}

function parseEnvContent(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = stripEnvQuotes(rawValue);
  }
}

function stripEnvQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function isSameRunMode(run) {
  return Boolean(run?.dry_run) === DRY_RUN;
}

function parsePositiveInteger(value) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clampRank(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 10 ? parsed : fallback;
}

function clampScore(value) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(parsed)));
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) {
    return 0;
  }

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function sortCountObject(value) {
  return Object.fromEntries(Object.entries(value).sort((a, b) => b[1] - a[1]));
}

function isRetryableError(error) {
  const status = error?.status ?? error?.response?.status;
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status < 600);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(getErrorMessage(error));
  process.exit(1);
});
