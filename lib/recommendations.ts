import type { CategoryModel, TargetIntentModel } from "@/lib/models";
import type { DiscoverabilityScorecard } from "@/lib/discoverability/types";
import {
  RANKABILITY_FACTORS,
  type RankabilityFactorId,
  type RankabilityScorecard
} from "@/lib/scoring/types";
import type { PageScanRecord, ProjectScanRun } from "@/lib/site-state";

export type RecommendationAction = "CHANGE" | "REMOVE" | "ADD";

export type Recommendation = {
  action: RecommendationAction;
  title: string;
  rationale: string;
  source: string;
  evidence: string[];
  pageUrl: string | null;
  priority: number;
};

export type ScanComparison = {
  rankabilityDelta: number;
  discoverabilityDelta: number;
  websiteContentDelta: number;
  externalValidationDelta: number;
  trustSignalsDelta: number;
  changedPages: Array<{
    url: string;
    before: string;
    after: string;
  }>;
  improvedPages: Array<{
    url: string;
    confidenceDelta: number;
  }>;
  worsenedPages: Array<{
    url: string;
    confidenceDelta: number;
  }>;
};

export function buildRecommendations(input: {
  latestScan: ProjectScanRun | null;
  categoryModel: CategoryModel | null;
  targetIntentModel: TargetIntentModel | null;
  rankability: RankabilityScorecard | null;
  discoverability: DiscoverabilityScorecard | null;
}) {
  const recommendations: Recommendation[] = [];
  const latestScan = input.latestScan;

  if (!latestScan) {
    return recommendations;
  }

  const sortedPages = [...latestScan.pages].sort((a, b) => {
    const contributionA = pageContributionScore(a);
    const contributionB = pageContributionScore(b);
    return contributionB - contributionA;
  });

  const topPage = sortedPages[0] ?? null;
  const homepage = latestScan.pages.find((page) => page.pageType === "homepage") ?? topPage;
  const lowConfidencePage = [...latestScan.pages].sort((a, b) => a.merged.confidence - b.merged.confidence)[0] ?? null;
  const lowStabilityPage = [...latestScan.pages].sort((a, b) => a.merged.stability - b.merged.stability)[0] ?? null;
  const weakContextPage = [...latestScan.pages].sort((a, b) => pageContributionScore(a) - pageContributionScore(b))[0] ?? null;
  const categoryModel = input.categoryModel;
  const targetIntentModel = input.targetIntentModel;
  const rankability = input.rankability;
  const discoverability = input.discoverability;

  if (homepage) {
    recommendations.push({
      action: "CHANGE",
      title: `Change ${pageLabel(homepage)} hero copy`,
      rationale: "The highest-leverage page should lead with a sharper value proposition and clearer category signal.",
      source: homepage.url,
      evidence: [
        `Intent: ${homepage.merged.intent}`,
        `Stability: ${Math.round(homepage.merged.stability * 100)}%`,
        ...homepage.merged.weakening_signals.slice(0, 2)
      ],
      pageUrl: homepage.url,
      priority: 95
    });
  }

  if (lowConfidencePage) {
    recommendations.push({
      action: "REMOVE",
      title: `Remove weak or generic language from ${pageLabel(lowConfidencePage)}`,
      rationale: "Weakly interpreted pages usually contain broad phrasing, weak structure, or too little signal.",
      source: lowConfidencePage.url,
      evidence: [
        `Intent: ${lowConfidencePage.merged.intent}`,
        ...lowConfidencePage.merged.weakening_signals.slice(0, 3)
      ],
      pageUrl: lowConfidencePage.url,
      priority: 88
    });
  }

  if (weakContextPage) {
    recommendations.push({
      action: "ADD",
      title: `Add supporting examples around ${pageLabel(weakContextPage)}`,
      rationale: "Pages with low context contribution need concrete examples, proof, or supporting detail to help the site explain itself.",
      source: weakContextPage.url,
      evidence: [
        `Contribution: ${Math.round(pageContributionScore(weakContextPage) * 100)}%`,
        `Internal links: ${weakContextPage.internalLinks.length}`,
        `Stability: ${Math.round(weakContextPage.merged.stability * 100)}%`
      ],
      pageUrl: weakContextPage.url,
      priority: 84
    });
  }

  if (lowStabilityPage && lowStabilityPage !== lowConfidencePage) {
    recommendations.push({
      action: "CHANGE",
      title: `Clarify the position on ${pageLabel(lowStabilityPage)}`,
      rationale: "Unstable pages tend to need cleaner wording and a more explicit role in the category model.",
      source: lowStabilityPage.url,
      evidence: [
        `Stability: ${Math.round(lowStabilityPage.merged.stability * 100)}%`,
        lowStabilityPage.mergeDecision === "unstable" ? "Pass C fallback was required." : "No fallback required."
      ],
      pageUrl: lowStabilityPage.url,
      priority: 80
    });
  }

  if (targetIntentModel && categoryModel) {
    const missingConcepts = categoryModel.expectedConcepts.filter((concept) => !targetIntentModel.lockedConcepts.includes(concept));
    if (missingConcepts.length) {
      recommendations.push({
        action: "ADD",
        title: "Add missing target concepts to the editorial plan",
        rationale: "The target model should explicitly include the shared concepts you want to reinforce.",
        source: categoryModel.category,
        evidence: missingConcepts.slice(0, 4),
        pageUrl: null,
        priority: 76
      });
    }
  }

  const weakestFactor = rankability ? getWeakestFactor(rankability) : null;
  if (weakestFactor?.factorId === "third_party_authority_external_validation") {
    recommendations.push({
      action: "ADD",
      title: "Add stronger third-party validation around the category",
      rationale: "External validation is weak, so the site needs more independent proof that it deserves to be recommended.",
      source: "Site-wide analysis",
      evidence: weakestFactor.evidence,
      pageUrl: null,
      priority: 84
    });
  }

  if (weakestFactor?.factorId === "website_content_relevance_completeness") {
    recommendations.push({
      action: "ADD",
      title: "Add clearer category and offer detail across the site",
      rationale: "Website content is the weakest factor, so the site should explain its fit, offer, and buyer value more explicitly.",
      source: "Site-wide analysis",
      evidence: weakestFactor.evidence,
      pageUrl: null,
      priority: 78
    });
  }

  if (weakestFactor?.factorId === "on_site_trust_signals") {
    recommendations.push({
      action: "CHANGE",
      title: "Strengthen on-site trust proof",
      rationale: "Trust signals are weak, so the site needs clearer proof like policies, contact details, credentials, guarantees, or case studies.",
      source: "Site-wide analysis",
      evidence: weakestFactor.evidence,
      pageUrl: homepage?.url ?? null,
      priority: 82
    });
  }

  if (discoverability && !discoverability.targetWebsite.appeared) {
    recommendations.push({
      action: "ADD",
      title: "Add stronger off-site discovery signals",
      rationale: "AI never found the site in the discovery runs, so category listings, review platforms, and clearer entity signals need work.",
      source: "Discoverability analysis",
      evidence: [
        `Discovery prompts that included the target: ${discoverability.targetWebsite.appearanceCount}`,
        ...discoverability.targetWebsite.reasonsFoundOrMissed.slice(0, 2)
      ],
      pageUrl: null,
      priority: 96
    });
  }

  if (discoverability?.factorScores.source_path_diversity.score && discoverability.factorScores.source_path_diversity.score < 60) {
    recommendations.push({
      action: "ADD",
      title: "Get listed on more of the source types AI uses",
      rationale: "Discoverability is relying on too few source paths, so the site should expand its footprint across directories, review platforms, and trusted third parties.",
      source: "Discoverability analysis",
      evidence: discoverability.commonSources.byType.slice(0, 3).map((item) => `${item.key}: ${item.count}`),
      pageUrl: null,
      priority: 86
    });
  }

  if (discoverability?.factorScores.third_party_source_strength.score && discoverability.factorScores.third_party_source_strength.score < 60) {
    recommendations.push({
      action: "ADD",
      title: "Increase coverage on high-value discovery sources",
      rationale: "The website is underrepresented on the external sources that appear to carry the most discoverability weight in this category.",
      source: "Discoverability source audit",
      evidence: [
        discoverability.factorScores.third_party_source_strength.evidence,
        ...discoverability.sourceCoverage.missingHighValueSources.slice(0, 2).map((source) => `${source.sourceDomain}: ${source.recommendedAction}`)
      ],
      pageUrl: null,
      priority: 91
    });
  }

  if (discoverability?.sourceCoverage.missingHighValueSources.length) {
    const topMissing = discoverability.sourceCoverage.missingHighValueSources[0];
    recommendations.push({
      action: "ADD",
      title: `Add the site to ${topMissing.sourceName || topMissing.sourceDomain}`,
      rationale: "Competitors are getting discovery support from a high-value source that does not appear to support the target website yet.",
      source: "Discoverability source audit",
      evidence: [
        `Source type: ${topMissing.sourceType}`,
        `Competitors supported: ${topMissing.competitorCount}`,
        topMissing.whyItMatters,
        topMissing.recommendedAction
      ],
      pageUrl: null,
      priority: 92
    });
  }

  if (discoverability && discoverability.sourceCoverage.highValueSourceCoverageScore < 50) {
    recommendations.push({
      action: "ADD",
      title: "Close the gap on high-value discoverability sources",
      rationale: "The strongest external sources in the category are supporting competitors more often than the target website.",
      source: "Discoverability source audit",
      evidence: discoverability.sourceCoverage.missingHighValueSources
        .slice(0, 3)
        .map((source) => `${source.sourceDomain}: ${source.competitorCount} competitor signals`),
      pageUrl: null,
      priority: 90
    });
  }

  return recommendations.slice(0, 8);
}

export function pageContributionScore(page: PageScanRecord) {
  const linkScore = Math.min(page.internalLinks.length / 8, 1);
  const confidenceScore = page.merged.confidence;
  const stabilityScore = page.merged.stability;
  const signalScore = Math.min(page.merged.supporting_signals.length / 5, 1);

  if (page.pageType === "homepage") {
    return clamp(0.48 + confidenceScore * 0.25 + stabilityScore * 0.18 + linkScore * 0.18 + signalScore * 0.1, 0, 1);
  }

  if (page.pageType === "product") {
    return clamp(0.35 + confidenceScore * 0.28 + stabilityScore * 0.2 + linkScore * 0.1 + signalScore * 0.14, 0, 1);
  }

  return clamp(0.25 + confidenceScore * 0.24 + stabilityScore * 0.22 + linkScore * 0.18 + signalScore * 0.12, 0, 1);
}

export function buildScanComparison(latestScan: ProjectScanRun | null, previousScan: ProjectScanRun | null): ScanComparison | null {
  if (!latestScan) {
    return null;
  }

  const latestRankability = latestScan.rankability;
  const previousRankability = previousScan?.rankability;
  const latestDiscoverability = latestScan.discoverability;
  const previousDiscoverability = previousScan?.discoverability;
  const latestPagesByUrl = new Map(latestScan.pages.map((page) => [page.url, page]));
  const previousPagesByUrl = new Map(previousScan?.pages.map((page) => [page.url, page] as const) ?? []);

  const changedPages = [...latestPagesByUrl.entries()]
    .map(([url, page]) => {
      const previous = previousPagesByUrl.get(url);
      if (!previous) {
        return null;
      }

      if (normalizeText(page.merged.intent) === normalizeText(previous.merged.intent) && normalizeText(page.merged.product) === normalizeText(previous.merged.product)) {
        return null;
      }

      return {
        url,
        before: previous.merged.intent,
        after: page.merged.intent
      };
    })
    .filter((item): item is { url: string; before: string; after: string } => Boolean(item))
    .slice(0, 8);

  const improvedPages = [...latestPagesByUrl.entries()]
    .map(([url, page]) => {
      const previous = previousPagesByUrl.get(url);
      if (!previous) {
        return null;
      }

      const delta = page.merged.confidence - previous.merged.confidence;
      if (delta <= 0) {
        return null;
      }

      return {
        url,
        confidenceDelta: delta
      };
    })
    .filter((item): item is { url: string; confidenceDelta: number } => Boolean(item))
    .sort((a, b) => b.confidenceDelta - a.confidenceDelta)
    .slice(0, 5);

  const worsenedPages = [...latestPagesByUrl.entries()]
    .map(([url, page]) => {
      const previous = previousPagesByUrl.get(url);
      if (!previous) {
        return null;
      }

      const delta = page.merged.confidence - previous.merged.confidence;
      if (delta >= 0) {
        return null;
      }

      return {
        url,
        confidenceDelta: delta
      };
    })
    .filter((item): item is { url: string; confidenceDelta: number } => Boolean(item))
    .sort((a, b) => a.confidenceDelta - b.confidenceDelta)
    .slice(0, 5);

  return {
    rankabilityDelta: roundDelta((latestRankability?.weightedTotalScore ?? 0) - (previousRankability?.weightedTotalScore ?? 0)),
    discoverabilityDelta: roundDelta((latestDiscoverability?.discoverabilityScore ?? 0) - (previousDiscoverability?.discoverabilityScore ?? 0)),
    websiteContentDelta: roundDelta(factorDelta(latestRankability, previousRankability, "website_content_relevance_completeness")),
    externalValidationDelta: roundDelta(
      factorDelta(latestRankability, previousRankability, "third_party_authority_external_validation")
    ),
    trustSignalsDelta: roundDelta(factorDelta(latestRankability, previousRankability, "on_site_trust_signals")),
    changedPages,
    improvedPages,
    worsenedPages
  };
}

export function buildPageHistory(pageUrl: string, runs: ProjectScanRun[]) {
  return runs
    .map((run) => {
      const page = run.pages.find((item) => item.url === pageUrl);
      if (!page) {
        return null;
      }

      return {
        runId: run.id,
        completedAt: run.completedAt,
        confidence: page.merged.confidence,
        stability: page.merged.stability,
        intent: page.merged.intent,
        mergeDecision: page.mergeDecision
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
}

function pageLabel(page: PageScanRecord) {
  try {
    const url = new URL(page.url);
    return url.pathname === "/" ? url.hostname : `${url.hostname}${url.pathname}`;
  } catch {
    return page.url;
  }
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function roundDelta(value: number) {
  return Math.round(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getWeakestFactor(metrics: RankabilityScorecard) {
  const factors = RANKABILITY_FACTORS.map((factor) => {
    const score = metrics.factorScores[factor.id];
    return {
      factorId: factor.id,
      score: score.score,
      evidence: [
        `${factor.label}: ${score.score}%`,
        score.evidence
      ]
    };
  });

  return factors.sort((a, b) => a.score - b.score)[0] ?? null;
}

function factorDelta(
  latestMetrics: RankabilityScorecard | null | undefined,
  previousMetrics: RankabilityScorecard | null | undefined,
  factorId: RankabilityFactorId
) {
  return (latestMetrics?.factorScores[factorId].score ?? 0) - (previousMetrics?.factorScores[factorId].score ?? 0);
}
