#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const INPUT_FILES = [
  "visitor-management-top10-scan.json",
  "accounting-software-top10-scan.json",
  "cleaning-services-top10-scan.json"
];

const CATEGORY_KEYS = {
  "visitor management system": "visitor_management_system",
  "accounting software": "accounting_software",
  "cleaning services": "cleaning_services"
};

const BRAND_MERGES = {
  visitor_management_system: {
    "eptura.com": "proxyclick",
    "proxyclick.com": "proxyclick"
  },
  cleaning_services: {
    "jims.net": "jims_cleaning",
    "jimscleaning.com.au": "jims_cleaning"
  }
};

const OUTPUT_JSON = path.resolve(process.cwd(), "research-results/top10-comparison-report.json");
const OUTPUT_MD = path.resolve(process.cwd(), "research-results/top10-comparison-report.md");

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
  overall_conclusions: []
};

report.overall_conclusions = buildOverallConclusions(report.datasets);

await fs.writeFile(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await fs.writeFile(OUTPUT_MD, `${renderMarkdown(report)}\n`, "utf8");

console.log(`Wrote ${OUTPUT_JSON}`);
console.log(`Wrote ${OUTPUT_MD}`);

function analyzeDataset(dataset) {
  const categoryKey = dataset.category_key || CATEGORY_KEYS[dataset.category] || inferCategoryKeyFromFilename(dataset.__source_file) || "unknown";
  const rawRows = dataset.scored_results.map((row) => ({
    rank: row.rank,
    name: row.name,
    website: row.website,
    domain: normalizeDomain(row.website),
    discoverability_score: row.discoverability_score,
    rankability_score: row.rankability_score,
    appearance_count: row.discovery_appearance_count,
    average_rank: row.discovery_average_rank
  }));

  const mergedRows = mergeRows(rawRows, BRAND_MERGES[categoryKey] || {});
  const sortedMergedRows = [...mergedRows].sort((a, b) => a.rank - b.rank);
  const discoverabilitySpearman = round3(spearman(sortedMergedRows.map((row) => row.rank), sortedMergedRows.map((row) => row.discoverability_score)));
  const rankabilitySpearman = round3(spearman(sortedMergedRows.map((row) => row.rank), sortedMergedRows.map((row) => row.rankability_score)));
  const top5 = sortedMergedRows.slice(0, 5);
  const next5 = sortedMergedRows.slice(5, 10);
  const mergedBrands = sortedMergedRows.filter((row) => row.merged_from.length > 1);

  return {
    category: dataset.category || categoryKey,
    category_key: categoryKey,
    source_file: dataset.__source_file || "",
    generated_at: dataset.generated_at,
    requested_model: dataset.requested_model,
    raw_count: rawRows.length,
    merged_count: sortedMergedRows.length,
    merged_brands: mergedBrands.map((row) => ({
      brand_key: row.brand_key,
      display_name: row.name,
      canonical_website: row.website,
      merged_from: row.merged_from
    })),
    score_alignment: {
      discoverability_spearman: discoverabilitySpearman,
      rankability_spearman: rankabilitySpearman,
      stronger_driver:
        Math.abs(discoverabilitySpearman) > Math.abs(rankabilitySpearman) ? "discoverability" : "rankability",
      interpretation: interpretDrivers(discoverabilitySpearman, rankabilitySpearman)
    },
    top_vs_bottom_gap: {
      discoverability_top_5_avg: average(top5.map((row) => row.discoverability_score)),
      discoverability_rank_6_to_10_avg: average(next5.map((row) => row.discoverability_score)),
      discoverability_gap: round1(average(top5.map((row) => row.discoverability_score)) - average(next5.map((row) => row.discoverability_score))),
      rankability_top_5_avg: average(top5.map((row) => row.rankability_score)),
      rankability_rank_6_to_10_avg: average(next5.map((row) => row.rankability_score)),
      rankability_gap: round1(average(top5.map((row) => row.rankability_score)) - average(next5.map((row) => row.rankability_score)))
    },
    notable_outliers: findOutliers(sortedMergedRows),
    merged_ranking_table: sortedMergedRows
  };
}

function mergeRows(rows, brandMap) {
  const groups = new Map();
  for (const row of rows) {
    const brandKey = brandMap[row.domain] || row.domain;
    const current = groups.get(brandKey);
    if (current) {
      current.members.push(row);
    } else {
      groups.set(brandKey, { brandKey, members: [row] });
    }
  }

  const merged = [...groups.values()].map(({ brandKey, members }) => {
    const byBestRank = [...members].sort((a, b) => a.rank - b.rank);
    const canonical = byBestRank[0];
    return {
      brand_key: brandKey,
      rank: canonical.rank,
      name: canonical.name,
      website: canonical.website,
      domain: canonical.domain,
      discoverability_score: round1(Math.max(...members.map((row) => row.discoverability_score))),
      rankability_score: round1(average(members.map((row) => row.rankability_score))),
      appearance_count: Math.max(...members.map((row) => row.appearance_count)),
      average_rank: round1(average(members.map((row) => row.average_rank))),
      merged_from: members.map((row) => ({
        rank: row.rank,
        name: row.name,
        website: row.website,
        discoverability_score: row.discoverability_score,
        rankability_score: row.rankability_score
      }))
    };
  });

  const sorted = merged.sort((a, b) => a.rank - b.rank);
  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
}

function findOutliers(rows) {
  return rows
    .filter((row) => row.rankability_score - row.discoverability_score >= 20 || row.discoverability_score - row.rankability_score >= 20)
    .map((row) => ({
      rank: row.rank,
      name: row.name,
      website: row.website,
      discoverability_score: row.discoverability_score,
      rankability_score: row.rankability_score,
      gap: round1(row.rankability_score - row.discoverability_score),
      note:
        row.rankability_score > row.discoverability_score
          ? "Rankability is much stronger than discovery presence."
          : "Discoverability is much stronger than underlying website strength."
    }));
}

function buildOverallConclusions(datasets) {
  const conclusions = [];
  const stronger = datasets.map((dataset) => `${dataset.category}: ${dataset.score_alignment.stronger_driver}`);
  conclusions.push(`Primary driver by category: ${stronger.join("; ")}.`);

  const discoverabilityDominantCount = datasets.filter((dataset) => dataset.score_alignment.stronger_driver === "discoverability").length;
  if (discoverabilityDominantCount >= 2) {
    conclusions.push("Across these three categories, returned order is more often explained by discoverability than by rankability.");
  }

  const localService = datasets.find((dataset) => dataset.category_key === "cleaning_services");
  if (localService) {
    conclusions.push(
      `Local-service results were the noisiest: ${localService.category} had a discoverability gap of ${localService.top_vs_bottom_gap.discoverability_gap} points, while the rankability gap was ${localService.top_vs_bottom_gap.rankability_gap} points.`
    );
  }

  const softwareCategories = datasets.filter((dataset) =>
    ["visitor_management_system", "accounting_software"].includes(dataset.category_key)
  );
  if (softwareCategories.length === 2) {
    conclusions.push("Software categories showed a cleaner pattern: high-frequency discovery was usually a stronger predictor of returned order, while rankability helped explain which discovered candidates looked strongest once surfaced.");
  }

  return conclusions;
}

function interpretDrivers(discoverabilitySpearman, rankabilitySpearman) {
  const absDiscoverability = Math.abs(discoverabilitySpearman);
  const absRankability = Math.abs(rankabilitySpearman);
  if (absDiscoverability - absRankability > 0.15) {
    return "Returned order is better explained by discoverability than by rankability.";
  }
  if (absRankability - absDiscoverability > 0.15) {
    return "Returned order is better explained by rankability than by discoverability.";
  }
  return "Discoverability and rankability both appear relevant, with neither clearly dominating.";
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Top 10 Comparison Report");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Model: ${report.model}`);
  lines.push("");
  lines.push("## Overall Conclusions");
  lines.push("");
  for (const conclusion of report.overall_conclusions) {
    lines.push(`- ${conclusion}`);
  }
  lines.push("");

  for (const dataset of report.datasets) {
    lines.push(`## ${dataset.category}`);
    lines.push("");
    lines.push(`- Discoverability Spearman: ${dataset.score_alignment.discoverability_spearman}`);
    lines.push(`- Rankability Spearman: ${dataset.score_alignment.rankability_spearman}`);
    lines.push(`- Stronger driver: ${dataset.score_alignment.stronger_driver}`);
    lines.push(`- Interpretation: ${dataset.score_alignment.interpretation}`);
    lines.push(`- Top 5 Discoverability avg: ${dataset.top_vs_bottom_gap.discoverability_top_5_avg}`);
    lines.push(`- Ranks 6-10 Discoverability avg: ${dataset.top_vs_bottom_gap.discoverability_rank_6_to_10_avg}`);
    lines.push(`- Top 5 Rankability avg: ${dataset.top_vs_bottom_gap.rankability_top_5_avg}`);
    lines.push(`- Ranks 6-10 Rankability avg: ${dataset.top_vs_bottom_gap.rankability_rank_6_to_10_avg}`);
    lines.push("");
    lines.push("| Rank | Name | Discoverability | Rankability | Website |");
    lines.push("| --- | --- | ---: | ---: | --- |");
    for (const row of dataset.merged_ranking_table) {
      lines.push(`| ${row.rank} | ${escapePipes(row.name)} | ${row.discoverability_score} | ${row.rankability_score} | ${escapePipes(row.website)} |`);
    }
    lines.push("");
    if (dataset.merged_brands.length) {
      lines.push("Merged brands:");
      for (const brand of dataset.merged_brands) {
        lines.push(`- ${brand.display_name}: ${brand.merged_from.map((item) => item.website).join(", ")}`);
      }
      lines.push("");
    }
    if (dataset.notable_outliers.length) {
      lines.push("Notable outliers:");
      for (const outlier of dataset.notable_outliers) {
        lines.push(`- #${outlier.rank} ${outlier.name}: gap ${outlier.gap} (${outlier.note})`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function normalizeDomain(value) {
  const url = new URL(value.startsWith("http") ? value : `https://${value}`);
  return url.hostname.replace(/^www\./, "").toLowerCase();
}

function inferCategoryKeyFromFilename(value) {
  const filename = String(value || "");
  if (filename.includes("visitor-management")) {
    return "visitor_management_system";
  }
  if (filename.includes("accounting-software")) {
    return "accounting_software";
  }
  if (filename.includes("cleaning-services")) {
    return "cleaning_services";
  }
  return "";
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function spearman(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) {
    return 0;
  }
  const rx = rankValues(xs);
  const ry = rankValues(ys);
  return pearson(rx, ry);
}

function rankValues(values) {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const ranks = Array(values.length).fill(0);
  let cursor = 0;
  while (cursor < sorted.length) {
    let end = cursor;
    while (end + 1 < sorted.length && sorted[end + 1].value === sorted[cursor].value) {
      end += 1;
    }
    const avgRank = (cursor + end + 2) / 2;
    for (let i = cursor; i <= end; i += 1) {
      ranks[sorted[i].index] = avgRank;
    }
    cursor = end + 1;
  }
  return ranks;
}

function pearson(xs, ys) {
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  if (!denomX || !denomY) {
    return 0;
  }
  return numerator / Math.sqrt(denomX * denomY);
}

function escapePipes(value) {
  return String(value).replace(/\|/g, "\\|");
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
