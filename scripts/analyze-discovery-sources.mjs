#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const INPUT_FILES = [
  "visitor-management-top10-scan.json",
  "accounting-software-top10-scan.json",
  "cleaning-services-top10-scan.json"
];

const BRAND_MERGES = {
  "visitor-management-top10-scan.json": {
    "eptura.com": "proxyclick",
    "proxyclick.com": "proxyclick"
  },
  "cleaning-services-top10-scan.json": {
    "jims.net": "jims_cleaning",
    "jimscleaning.com.au": "jims_cleaning"
  }
};

const REVIEW_PLATFORMS = new Set([
  "g2.com",
  "capterra.com",
  "trustpilot.com",
  "trustradius.com",
  "productreview.com.au",
  "getapp.com",
  "softwareadvice.com",
  "tripadvisor.com",
  "yelp.com",
  "google.com"
]);

const DIRECTORIES = new Set([
  "yellowpages.com.au",
  "oneflare.com.au",
  "wordofmouth.com.au",
  "bingplaces.com",
  "zoominfo.com",
  "crunchbase.com"
]);

const EDITORIAL = new Set([
  "forbes.com",
  "techradar.com",
  "pcmag.com",
  "businessnewsdaily.com",
  "blog.hubspot.com"
]);

const FORUMS = new Set(["reddit.com", "quora.com"]);

const OUTPUT_JSON = path.resolve(process.cwd(), "research-results/discovery-source-analysis.json");
const OUTPUT_MD = path.resolve(process.cwd(), "research-results/discovery-source-analysis.md");

const datasets = [];
for (const file of INPUT_FILES) {
  const current = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "research-results", file), "utf8"));
  current.__source_file = file;
  datasets.push(current);
}

const report = {
  generated_at: new Date().toISOString(),
  model: "gpt-5-mini",
  datasets: datasets.map(analyzeDataset),
  cross_category_summary: null
};

report.cross_category_summary = analyzeCrossCategory(report.datasets);

await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(OUTPUT_MD, `${renderMarkdown(report)}\n`, "utf8");

console.log(`Wrote ${OUTPUT_JSON}`);
console.log(`Wrote ${OUTPUT_MD}`);

function analyzeDataset(dataset) {
  const sourceFile = dataset.__source_file;
  const brandMap = BRAND_MERGES[sourceFile] || {};
  const candidatesByBrand = new Map();

  for (const run of dataset.discovery_runs || []) {
    for (const candidate of run.candidates || []) {
      const domain = normalizeDomain(candidate.website);
      const brandKey = brandMap[domain] || domain;
      const existing = candidatesByBrand.get(brandKey);
      const normalizedSources = (candidate.discovery_sources || []).map((source) =>
        normalizeSource(source, domain, candidate.website)
      );

      const candidateEntry = {
        brand_key: brandKey,
        candidate_name: candidate.name,
        candidate_website: candidate.website,
        candidate_domain: domain,
        run_prompt_variation: run.prompt_variation,
        rank: candidate.rank,
        entity_match_clarity_score: candidate.entity_match_clarity_score,
        sources: normalizedSources
      };

      if (existing) {
        existing.entries.push(candidateEntry);
      } else {
        candidatesByBrand.set(brandKey, { brandKey, entries: [candidateEntry] });
      }
    }
  }

  const mergedCandidates = [...candidatesByBrand.values()]
    .map((group) => buildBrandCandidate(group))
    .sort((a, b) => {
      if (b.appearance_count !== a.appearance_count) {
        return b.appearance_count - a.appearance_count;
      }
      return a.average_rank - b.average_rank;
    })
    .slice(0, 10)
    .map((item, index) => ({ ...item, canonical_rank: index + 1 }));

  const sourceDomainStats = new Map();
  const sourceTypeStats = new Map();
  const sourceUrlStats = new Map();

  for (const candidate of mergedCandidates) {
    for (const source of candidate.deduped_sources) {
      const candidateWeight = computeCandidateWeight(candidate.canonical_rank, candidate.appearance_count);
      accumulateSourceDomain(sourceDomainStats, source, candidate, candidateWeight);
      accumulateSourceType(sourceTypeStats, source, candidateWeight);
      accumulateSourceUrl(sourceUrlStats, source, candidate, candidateWeight);
    }
  }

  const rankedSourceDomains = sortStatMap(sourceDomainStats);
  const rankedSourceTypes = sortStatMap(sourceTypeStats);
  const rankedSourceUrls = sortStatMap(sourceUrlStats);

  return {
    category: dataset.category || inferCategoryFromFilename(sourceFile),
    source_file: sourceFile,
    generated_at: dataset.generated_at,
    requested_model: dataset.requested_model,
    canonical_candidates: mergedCandidates.map((candidate) => ({
      canonical_rank: candidate.canonical_rank,
      name: candidate.name,
      website: candidate.website,
      appearance_count: candidate.appearance_count,
      average_rank: candidate.average_rank,
      source_count: candidate.deduped_sources.length,
      source_types: [...new Set(candidate.deduped_sources.map((source) => source.inferred_source_type))].sort(),
      top_sources: candidate.deduped_sources.slice(0, 5)
    })),
    common_sources: {
      by_domain: rankedSourceDomains.slice(0, 20),
      by_type: rankedSourceTypes,
      by_url: rankedSourceUrls.slice(0, 20)
    },
    recommendations: buildSourceRecommendations(rankedSourceDomains, rankedSourceTypes)
  };
}

function buildBrandCandidate(group) {
  const entries = group.entries;
  const byBestRank = [...entries].sort((a, b) => a.rank - b.rank);
  const canonical = byBestRank[0];
  const appearanceCount = new Set(entries.map((entry) => `${entry.run_prompt_variation}:${entry.candidate_domain}`)).size;
  const averageRank = round1(entries.reduce((sum, entry) => sum + entry.rank, 0) / entries.length);
  const dedupedSources = dedupeSources(
    entries.flatMap((entry) =>
      entry.sources.map((source) => ({
        ...source,
        candidate_rank: entry.rank,
        prompt_variation: entry.run_prompt_variation
      }))
    )
  ).sort((a, b) => sourceSortScore(b) - sourceSortScore(a));

  return {
    brand_key: group.brandKey,
    name: canonical.candidate_name,
    website: canonical.candidate_website,
    appearance_count: appearanceCount,
    average_rank: averageRank,
    deduped_sources: dedupedSources
  };
}

function normalizeSource(source, candidateDomain, candidateWebsite) {
  const sourceDomain = normalizeDomain(source.source_url || source.source_domain || "");
  const inferredType = inferSourceType(source, candidateDomain, candidateWebsite, sourceDomain);
  return {
    source_name: source.source_name || sourceDomain,
    source_domain: sourceDomain,
    source_type: source.source_type || "unknown",
    inferred_source_type: inferredType,
    source_url: source.source_url || "",
    influence: source.influence || "low",
    evidence_found: source.evidence_found || ""
  };
}

function inferSourceType(source, candidateDomain, candidateWebsite, sourceDomain) {
  if (source.source_type && source.source_type !== "unknown") {
    return source.source_type;
  }

  if (!sourceDomain) {
    return "unknown";
  }

  if (sourceDomain === candidateDomain || sourceDomain.endsWith(`.${candidateDomain}`)) {
    return "official_site";
  }

  if (REVIEW_PLATFORMS.has(sourceDomain) || hasSuffixMatch(sourceDomain, REVIEW_PLATFORMS)) {
    return sourceDomain === "google.com" ? "google_business_profile" : "review_platform";
  }

  if (DIRECTORIES.has(sourceDomain) || hasSuffixMatch(sourceDomain, DIRECTORIES)) {
    return "industry_directory";
  }

  if (EDITORIAL.has(sourceDomain) || hasSuffixMatch(sourceDomain, EDITORIAL)) {
    return "editorial_media";
  }

  if (FORUMS.has(sourceDomain) || hasSuffixMatch(sourceDomain, FORUMS)) {
    return "forum";
  }

  if (sourceDomain.endsWith(".gov.au") || sourceDomain.endsWith(".gov") || sourceDomain.endsWith(".edu.au")) {
    return "government_register";
  }

  if (/\/maps|google.*business|place/i.test(source.source_url || "") || /google business/i.test(source.source_name || "")) {
    return "google_business_profile";
  }

  if (/marketplace|directory|finder|compare/i.test(source.source_name || "")) {
    return "industry_directory";
  }

  return "unknown";
}

function accumulateSourceDomain(statMap, source, candidate, candidateWeight) {
  const key = source.source_domain || source.source_url || source.source_name;
  const current = statMap.get(key) || {
    key,
    source_domain: source.source_domain,
    inferred_source_type: source.inferred_source_type,
    appearances: 0,
    weighted_score: 0,
    high_influence_count: 0,
    supported_categories: new Set(),
    supported_websites: new Set(),
    sample_evidence: []
  };

  current.appearances += 1;
  current.weighted_score += candidateWeight * getInfluenceMultiplier(source.influence) * getSourceTypeMultiplier(source.inferred_source_type);
  if (source.influence === "high") {
    current.high_influence_count += 1;
  }
  current.supported_categories.add(candidate.brand_key);
  current.supported_websites.add(candidate.website);
  if (current.sample_evidence.length < 3 && source.evidence_found) {
    current.sample_evidence.push(source.evidence_found);
  }
  statMap.set(key, current);
}

function accumulateSourceType(statMap, source, candidateWeight) {
  const key = source.inferred_source_type;
  const current = statMap.get(key) || {
    key,
    appearances: 0,
    weighted_score: 0,
    high_influence_count: 0
  };
  current.appearances += 1;
  current.weighted_score += candidateWeight * getInfluenceMultiplier(source.influence);
  if (source.influence === "high") {
    current.high_influence_count += 1;
  }
  statMap.set(key, current);
}

function accumulateSourceUrl(statMap, source, candidate, candidateWeight) {
  const key = source.source_url || `${source.source_domain}:${source.source_name}`;
  const current = statMap.get(key) || {
    key,
    source_name: source.source_name,
    source_domain: source.source_domain,
    inferred_source_type: source.inferred_source_type,
    appearances: 0,
    weighted_score: 0,
    supported_websites: new Set(),
    evidence_found: source.evidence_found || ""
  };
  current.appearances += 1;
  current.weighted_score += candidateWeight * getInfluenceMultiplier(source.influence) * getSourceTypeMultiplier(source.inferred_source_type);
  current.supported_websites.add(candidate.website);
  statMap.set(key, current);
}

function buildSourceRecommendations(sourceDomains, sourceTypes) {
  const topExternal = sourceDomains.filter((item) => item.inferred_source_type !== "official_site").slice(0, 8);
  return {
    source_type_priority: sourceTypes.slice(0, 6).map((item) => ({
      source_type: item.key,
      weighted_score: item.weighted_score,
      recommendation: recommendationForType(item.key)
    })),
    highest_value_external_sources: topExternal.map((item) => ({
      source_domain: item.source_domain,
      inferred_source_type: item.inferred_source_type,
      weighted_score: item.weighted_score,
      supported_websites_count: item.supported_websites_count,
      recommendation: recommendationForDomain(item.source_domain, item.inferred_source_type)
    }))
  };
}

function analyzeCrossCategory(datasets) {
  const byDomain = new Map();
  const byType = new Map();

  for (const dataset of datasets) {
    for (const item of dataset.common_sources.by_domain) {
      const current = byDomain.get(item.source_domain) || {
        source_domain: item.source_domain,
        inferred_source_type: item.inferred_source_type,
        category_count: 0,
        total_weighted_score: 0,
        categories: []
      };
      current.category_count += 1;
      current.total_weighted_score += item.weighted_score;
      current.categories.push(dataset.category);
      byDomain.set(item.source_domain, current);
    }

    for (const item of dataset.common_sources.by_type) {
      const current = byType.get(item.key) || {
        source_type: item.key,
        total_appearances: 0,
        total_weighted_score: 0,
        categories: []
      };
      current.total_appearances += item.appearances;
      current.total_weighted_score += item.weighted_score;
      current.categories.push(dataset.category);
      byType.set(item.key, current);
    }
  }

  return {
    common_domains_across_categories: [...byDomain.values()]
      .filter((item) => item.category_count >= 2)
      .sort((a, b) => b.total_weighted_score - a.total_weighted_score)
      .map((item) => ({
        ...item,
        total_weighted_score: round1(item.total_weighted_score)
      })),
    source_type_priority_across_categories: [...byType.values()]
      .sort((a, b) => b.total_weighted_score - a.total_weighted_score)
      .map((item) => ({
        ...item,
        total_weighted_score: round1(item.total_weighted_score)
      }))
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Discovery Source Analysis");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Model: ${report.model}`);
  lines.push("");
  lines.push("## Cross-Category Source Priorities");
  lines.push("");
  for (const item of report.cross_category_summary.source_type_priority_across_categories.slice(0, 8)) {
    lines.push(`- ${item.source_type}: weighted score ${item.total_weighted_score}`);
  }
  lines.push("");
  if (report.cross_category_summary.common_domains_across_categories.length) {
    lines.push("Common domains across categories:");
    for (const item of report.cross_category_summary.common_domains_across_categories.slice(0, 10)) {
      lines.push(`- ${item.source_domain}: ${item.total_weighted_score} across ${item.category_count} categories`);
    }
    lines.push("");
  }

  for (const dataset of report.datasets) {
    lines.push(`## ${dataset.category}`);
    lines.push("");
    lines.push("Top source types:");
    for (const item of dataset.common_sources.by_type.slice(0, 8)) {
      lines.push(`- ${item.key}: weighted ${item.weighted_score}, appearances ${item.appearances}`);
    }
    lines.push("");
    lines.push("Top source domains:");
    for (const item of dataset.common_sources.by_domain.slice(0, 10)) {
      lines.push(`- ${item.source_domain}: weighted ${item.weighted_score}, type ${item.inferred_source_type}, websites ${item.supported_websites_count}`);
    }
    lines.push("");
    lines.push("Highest-value external sources:");
    for (const item of dataset.recommendations.highest_value_external_sources.slice(0, 8)) {
      lines.push(`- ${item.source_domain}: ${item.recommendation}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function recommendationForType(type) {
  switch (type) {
    case "official_site":
      return "Strengthen category fit, entity clarity, location signals, and crawlable product/service detail on the main site.";
    case "review_platform":
      return "Build and maintain profiles on the review platforms AI keeps citing, and actively collect review volume and freshness.";
    case "industry_directory":
      return "Prioritise directory coverage and citation consistency on category-relevant directories.";
    case "google_business_profile":
      return "Improve and maintain the Google Business Profile, especially for local-service categories.";
    case "editorial_media":
      return "Pursue inclusion in editorial comparison pages and category roundups.";
    case "forum":
      return "Monitor and earn mentions in discussion communities where category recommendations happen.";
    default:
      return "Increase presence on this source type where category buyers already validate providers.";
  }
}

function recommendationForDomain(domain, type) {
  if (type === "review_platform") {
    return `Create or improve a profile on ${domain}, then grow review count, quality, and recency.`;
  }
  if (type === "industry_directory") {
    return `Ensure the business is listed on ${domain} with consistent category and location information.`;
  }
  if (type === "google_business_profile") {
    return "Strengthen Google Business Profile coverage and local review signals.";
  }
  if (type === "editorial_media") {
    return `Target inclusion on ${domain} or similar editorial sources.`;
  }
  return `Treat ${domain} as a discovery-supporting source and improve presence there where possible.`;
}

function sortStatMap(map) {
  return [...map.values()]
    .map((item) => ({
      ...item,
      weighted_score: round1(item.weighted_score),
      supported_categories_count: item.supported_categories ? item.supported_categories.size : undefined,
      supported_websites_count: item.supported_websites ? item.supported_websites.size : undefined
    }))
    .sort((a, b) => b.weighted_score - a.weighted_score || b.appearances - a.appearances || String(a.key).localeCompare(String(b.key)));
}

function dedupeSources(sources) {
  const seen = new Set();
  const result = [];
  for (const source of sources) {
    const key = [
      source.source_domain,
      source.source_url,
      source.source_name,
      source.inferred_source_type
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

function sourceSortScore(source) {
  return getInfluenceMultiplier(source.influence) * getSourceTypeMultiplier(source.inferred_source_type) * (11 - (source.candidate_rank || 10));
}

function computeCandidateWeight(rank, appearanceCount) {
  return (11 - rank) * (1 + ((appearanceCount - 1) / 5));
}

function getInfluenceMultiplier(influence) {
  if (influence === "high") return 1;
  if (influence === "medium") return 0.7;
  return 0.4;
}

function getSourceTypeMultiplier(type) {
  switch (type) {
    case "official_site":
      return 1;
    case "review_platform":
      return 1.1;
    case "google_business_profile":
      return 1.15;
    case "industry_directory":
      return 0.95;
    case "editorial_media":
      return 1.05;
    case "forum":
      return 0.75;
    case "government_register":
      return 0.9;
    default:
      return 0.8;
  }
}

function hasSuffixMatch(domain, set) {
  for (const candidate of set) {
    if (domain === candidate || domain.endsWith(`.${candidate}`)) {
      return true;
    }
  }
  return false;
}

function inferCategoryFromFilename(filename) {
  if (filename.includes("visitor-management")) return "visitor management system";
  if (filename.includes("accounting-software")) return "accounting software";
  if (filename.includes("cleaning-services")) return "cleaning services";
  return "unknown";
}

function normalizeDomain(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value).startsWith("http") ? String(value) : `https://${String(value)}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return String(value).replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
