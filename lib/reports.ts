import { buildCategoryModel, type CompetitorAnalysis, type TargetIntentModel } from "@/lib/models";
import { DISCOVERABILITY_FACTORS } from "@/lib/discoverability/types";
import {
  buildRecommendations,
  buildScanComparison,
  type Recommendation,
  type ScanComparison
} from "@/lib/recommendations";
import { RANKABILITY_FACTORS } from "@/lib/scoring/types";
import type { ProjectScanRun, SiteIntentProject, SiteIntentSessionState } from "@/lib/site-state";
import { shortenDisplayUrl } from "@/lib/site-state";

export type ScanRunSummary = {
  id: string;
  projectId: string;
  projectName: string;
  websiteUrl: string;
  startedAt: string;
  completedAt: string;
  status: ProjectScanRun["status"];
  scanMode: ProjectScanRun["scanMode"];
  analyzedPages: number;
  discoveredPages: number;
  pagesExcluded: number;
  scoringStatus: ProjectScanRun["scoringStatus"];
  scoringError: string | null;
  errorCount: number;
  rankabilityScore: number | null;
  discoverabilityScore: number | null;
  websiteContentScore: number | null;
  externalValidationScore: number | null;
  trustSignalsScore: number | null;
};

export type ProjectScanHistoryReport = {
  projectId: string;
  runCount: number;
  latestRunId: string | null;
  comparison: ScanComparison | null;
  runs: ScanRunSummary[];
};

export type CompetitorReportEntry = {
  url: string;
  displayUrl: string;
  faviconUrl: string | null;
  analysis: CompetitorAnalysis | null;
  aiSearchScore: number | null;
  rankabilityScore: number | null;
  discoverabilityScore: number | null;
  competitorConfidence: number | null;
  competitorReasoning: string | null;
  discoveredRank: number | null;
  appearanceCount: number;
  averageRank: number | null;
  bestRank: number | null;
  supportingPromptVariations: number[];
  topReasons: string[];
  sourceDomains: string[];
  sourceTypes: string[];
  sourceEvidence: NonNullable<CompetitorAnalysis["sourceEvidence"]>;
};

export type ProjectCompetitorReport = {
  projectId: string;
  projectName: string;
  category: string | null;
  targetWebsiteUrl: string;
  targetRankabilityScore: number | null;
  targetDiscoverabilityScore: number | null;
  competitors: CompetitorReportEntry[];
};

export type ProjectOverviewReport = {
  projectId: string;
  projectName: string;
  websiteUrl: string;
  websiteDisplayUrl: string;
  websiteFaviconUrl: string | null;
  latestScan: ScanRunSummary | null;
  category: string | null;
  aiSearchScore: number | null;
  rankabilityScore: number | null;
  discoverabilityScore: number | null;
  competitorBenchmarks: {
    aiSearchScore: ScoreBenchmark | null;
    rankabilityScore: ScoreBenchmark | null;
    discoverabilityScore: ScoreBenchmark | null;
  };
  rankabilityBreakdown: Array<{
    id: string;
    label: string;
    description: string;
    score: number;
    weight: number;
    weightedContribution: number;
    evidence: string;
    bestCompetitor: ScoreBenchmark | null;
  }>;
  discoverabilityBreakdown: Array<{
    id: string;
    label: string;
    description: string;
    score: number;
    weight: number;
    weightedContribution: number;
    evidence: string;
    bestCompetitor: ScoreBenchmark | null;
  }>;
  summary: {
    rankability: string | null;
    discoverability: string | null;
  };
};

export type ScoreBenchmark = {
  competitorName: string;
  competitorUrl: string;
  competitorFaviconUrl: string | null;
  score: number;
};

export type ProjectRecommendationsReport = {
  projectId: string;
  projectName: string;
  category: string | null;
  recommendationCount: number;
  recommendations: Recommendation[];
};

export type WebsiteListEntry = {
  projectId: string;
  name: string;
  websiteUrl: string;
  websiteDisplayUrl: string;
  websiteFaviconUrl: string | null;
  competitorCount: number;
  competitorDisplayUrls: string[];
  scanDepth: number;
  createdAt: string;
  updatedAt: string;
  latestScan: ScanRunSummary | null;
};

export type WebsitesReport = {
  websites: WebsiteListEntry[];
};

export function getWebsitesReportFromState(state: SiteIntentSessionState): WebsitesReport {
  return {
    websites: state.projects.map((project) => {
      const latestScan = getLatestScan(state, project.id);
      return {
        projectId: project.id,
        name: project.name,
        websiteUrl: project.websiteUrl,
        websiteDisplayUrl: project.websiteDisplayUrl,
        websiteFaviconUrl: project.websiteFaviconUrl,
        competitorCount: project.competitorUrls.length,
        competitorDisplayUrls: project.competitorDisplayUrls,
        scanDepth: project.scanDepth,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        latestScan: latestScan ? summarizeScanRun(latestScan) : null
      };
    })
  };
}

export function getProjectOverviewReportFromState(state: SiteIntentSessionState, projectId: string): ProjectOverviewReport | null {
  const project = getProject(state, projectId);
  if (!project) {
    return null;
  }

  const latestScan = getLatestScan(state, projectId);
  const competitorAnalyses = getResolvedCompetitorAnalyses(project, latestScan);
  const rankabilityScore = latestScan?.rankability?.weightedTotalScore ?? null;
  const discoverabilityScore = latestScan?.discoverability?.discoverabilityScore ?? null;

  return {
    projectId: project.id,
    projectName: project.name,
    websiteUrl: project.websiteUrl,
    websiteDisplayUrl: project.websiteDisplayUrl,
    websiteFaviconUrl: project.websiteFaviconUrl,
    latestScan: latestScan ? summarizeScanRun(latestScan) : null,
    category: latestScan?.discoverability?.category ?? latestScan?.observedIntent?.topic ?? null,
    aiSearchScore:
      rankabilityScore == null || discoverabilityScore == null
        ? null
        : roundOne(rankabilityScore * 0.4 + discoverabilityScore * 0.6),
    rankabilityScore,
    discoverabilityScore,
    competitorBenchmarks: {
      aiSearchScore: getBestCompetitorBenchmark(
        competitorAnalyses,
        project,
        rankabilityScore == null || discoverabilityScore == null ? null : roundOne(rankabilityScore * 0.4 + discoverabilityScore * 0.6),
        "aiSearchScore"
      ),
      rankabilityScore: getBestCompetitorBenchmark(competitorAnalyses, project, rankabilityScore, "rankabilityScore"),
      discoverabilityScore: getBestCompetitorBenchmark(competitorAnalyses, project, discoverabilityScore, "discoverabilityScore")
    },
    rankabilityBreakdown: latestScan?.rankability
      ? RANKABILITY_FACTORS.map((factor) => {
          const score = latestScan.rankability?.factorScores[factor.id];
          return {
            id: factor.id,
            label: factor.label,
            description: factor.description,
            score: score?.score ?? 0,
            weight: factor.weight,
            weightedContribution: score?.weightedContribution ?? 0,
            evidence: score?.evidence ?? "",
            bestCompetitor: getBestCompetitorFactorBenchmark(competitorAnalyses, project, "rankabilityFactorScores", factor.id)
          };
        })
      : [],
    discoverabilityBreakdown: latestScan?.discoverability
      ? DISCOVERABILITY_FACTORS.map((factor) => {
          const score = latestScan.discoverability?.factorScores[factor.id];
          return {
            id: factor.id,
            label: factor.label,
            description: factor.description,
            score: score?.score ?? 0,
            weight: factor.weight,
            weightedContribution: score?.weightedContribution ?? 0,
            evidence: score?.evidence ?? "",
            bestCompetitor: getBestCompetitorFactorBenchmark(competitorAnalyses, project, "discoverabilityFactorScores", factor.id)
          };
        })
      : [],
    summary: {
      rankability: latestScan?.rankability?.summary ?? null,
      discoverability: latestScan?.discoverability?.summary ?? null
    }
  };
}

export function getProjectCompetitorReportFromState(state: SiteIntentSessionState, projectId: string): ProjectCompetitorReport | null {
  const project = getProject(state, projectId);
  if (!project) {
    return null;
  }

  const latestScan = getLatestScan(state, projectId);
  const discoverabilityCandidates = latestScan?.discoverability?.aggregatedCandidates ?? [];
  const competitorUrls = uniqueStrings([
    ...project.competitorUrls,
    ...(latestScan?.competitorAnalyses?.map((analysis) => analysis.url) ?? [])
  ]).slice(0, 5);

  const competitors = competitorUrls.map((url) => {
    const domain = normalizeDomain(url);
    const candidate = discoverabilityCandidates.find((item) => normalizeDomain(item.website) === domain) ?? null;
    const analysis =
      project.competitorAnalysesByUrl[url] ??
      latestScan?.competitorAnalyses?.find((item) => normalizeDomain(item.url) === domain) ??
      null;
    const competitorIndex = project.competitorUrls.findIndex((value) => normalizeDomain(value) === domain);

    return {
      url,
      displayUrl: project.competitorDisplayUrls[competitorIndex] ?? shortenDisplayUrl(url),
      faviconUrl: project.competitorFaviconUrls[competitorIndex] ?? null,
      analysis,
      aiSearchScore: analysis?.aiSearchScore ?? null,
      rankabilityScore: analysis?.rankabilityScore ?? null,
      discoverabilityScore: analysis?.discoverabilityScore ?? null,
      competitorConfidence: analysis?.competitorConfidence ?? null,
      competitorReasoning: analysis?.competitorReasoning ?? null,
      discoveredRank: candidate?.bestRank ?? null,
      appearanceCount: candidate?.appearanceCount ?? 0,
      averageRank: candidate?.averageRank ?? null,
      bestRank: candidate?.bestRank ?? null,
      supportingPromptVariations: candidate?.supportingPromptVariations ?? analysis?.supportingPromptVariations ?? [],
      topReasons: candidate?.reasons.slice(0, 3) ?? analysis?.discoveryReasons?.slice(0, 3) ?? [],
      sourceDomains: candidate
        ? uniqueStrings(candidate.sources.map((source) => source.sourceDomain)).slice(0, 6)
        : analysis?.sourceDomains ?? [],
      sourceTypes: candidate
        ? uniqueStrings(candidate.sources.map((source) => source.sourceType)).slice(0, 6)
        : analysis?.sourceTypes ?? [],
      sourceEvidence:
        candidate
          ? candidate.sources.slice(0, 12).map((source) => ({
              sourceName: source.sourceName,
              sourceDomain: source.sourceDomain,
              sourceType: source.sourceType,
              sourceUrl: source.sourceUrl,
              influence: source.influence,
              evidenceFound: source.evidenceFound
            }))
          : analysis?.sourceEvidence ?? []
    } satisfies CompetitorReportEntry;
  });

  return {
    projectId: project.id,
    projectName: project.name,
    category: latestScan?.discoverability?.category ?? latestScan?.observedIntent?.topic ?? null,
    targetWebsiteUrl: project.websiteUrl,
    targetRankabilityScore: latestScan?.rankability?.weightedTotalScore ?? null,
    targetDiscoverabilityScore: latestScan?.discoverability?.discoverabilityScore ?? null,
    competitors
  };
}

export function getProjectScanHistoryReportFromState(state: SiteIntentSessionState, projectId: string): ProjectScanHistoryReport | null {
  if (!getProject(state, projectId)) {
    return null;
  }

  const runs = getProjectScans(state, projectId);
  return {
    projectId,
    runCount: runs.length,
    latestRunId: runs[0]?.id ?? null,
    comparison: buildScanComparison(runs[0] ?? null, runs[1] ?? null),
    runs: runs.map((run) => summarizeScanRun(run))
  };
}

export function getProjectRecommendationsReportFromState(state: SiteIntentSessionState, projectId: string): ProjectRecommendationsReport | null {
  const project = getProject(state, projectId);
  const latestScan = getLatestScan(state, projectId);
  const onboarding = state.projectOnboarding[projectId] ?? null;
  const recommendationsReady =
    onboarding?.status === "competitor_scored" &&
    latestScan?.scanMode === "full" &&
    latestScan?.scoringStatus === "completed";

  if (!project || !latestScan || !recommendationsReady) {
    return null;
  }

  const competitorAnalyses = getResolvedCompetitorAnalyses(project, latestScan);
  const categoryModel = buildCategoryModel({
    project,
    latestScan,
    competitorAnalyses
  });
  const targetIntentModel = (state.targetIntentModels[projectId] as TargetIntentModel | undefined) ?? null;
  const recommendations = buildRecommendations({
    latestScan,
    categoryModel,
    targetIntentModel,
    rankability: latestScan.rankability ?? null,
    discoverability: latestScan.discoverability ?? null
  });

  return {
    projectId: project.id,
    projectName: project.name,
    category: categoryModel.category,
    recommendationCount: recommendations.length,
    recommendations
  };
}

function getProject(state: SiteIntentSessionState, projectId: string): SiteIntentProject | null {
  return state.projects.find((project) => project.id === projectId) ?? null;
}

function getLatestScan(state: SiteIntentSessionState, projectId: string) {
  return getProjectScans(state, projectId)[0] ?? null;
}

function getProjectScans(state: SiteIntentSessionState, projectId: string) {
  return state.scanRuns
    .filter((scan) => scan.projectId === projectId)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt) || a.startedAt.localeCompare(b.startedAt));
}

function getResolvedCompetitorAnalyses(project: SiteIntentProject, latestScan: ProjectScanRun | null): CompetitorAnalysis[] {
  return uniqueStrings([
    ...project.competitorUrls,
    ...(latestScan?.competitorAnalyses?.map((item) => item.url) ?? [])
  ])
    .map((url) => {
      return (
        project.competitorAnalysesByUrl[url] ??
        latestScan?.competitorAnalyses?.find((item) => normalizeDomain(item.url) === normalizeDomain(url)) ??
        null
      );
    })
    .filter((item): item is CompetitorAnalysis => Boolean(item));
}

function getBestCompetitorBenchmark(
  competitorAnalyses: CompetitorAnalysis[],
  project: SiteIntentProject,
  targetScore: number | null,
  metric: "aiSearchScore" | "rankabilityScore" | "discoverabilityScore"
): ScoreBenchmark | null {
  const candidates = competitorAnalyses
    .map((analysis) => ({ analysis, score: analysis[metric] }))
    .filter((entry): entry is { analysis: CompetitorAnalysis; score: number } => typeof entry.score === "number");

  if (!candidates.length) {
    return null;
  }

  const best = candidates.reduce((currentBest, entry) => (entry.score > currentBest.score ? entry : currentBest));
  return buildScoreBenchmark(best.analysis, best.score, project);
}

function getBestCompetitorFactorBenchmark(
  competitorAnalyses: CompetitorAnalysis[],
  project: SiteIntentProject,
  metric: "rankabilityFactorScores" | "discoverabilityFactorScores",
  factorId: string
): ScoreBenchmark | null {
  const candidates = competitorAnalyses
    .map((analysis) => ({ analysis, score: analysis[metric]?.[factorId] }))
    .filter((entry): entry is { analysis: CompetitorAnalysis; score: number } => typeof entry.score === "number");

  if (!candidates.length) {
    return null;
  }

  const best = candidates.reduce((currentBest, entry) => (entry.score > currentBest.score ? entry : currentBest));
  return buildScoreBenchmark(best.analysis, best.score, project);
}

function buildScoreBenchmark(analysis: CompetitorAnalysis, score: number, project: SiteIntentProject): ScoreBenchmark {
  const competitorUrl = analysis.url;
  const competitorIndex = project.competitorUrls.findIndex((url) => normalizeDomain(url) === normalizeDomain(competitorUrl));

  return {
    competitorName: getHostnameOnlyLabel(competitorUrl),
    competitorUrl,
    competitorFaviconUrl: (competitorIndex >= 0 ? project.competitorFaviconUrls[competitorIndex] : null) ?? null,
    score
  };
}

function summarizeScanRun(run: ProjectScanRun): ScanRunSummary {
  return {
    id: run.id,
    projectId: run.projectId,
    projectName: run.projectName,
    websiteUrl: run.websiteUrl,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    status: run.status,
    scanMode: run.scanMode,
    analyzedPages: run.analyzedPages,
    discoveredPages: run.discoveredPages,
    pagesExcluded: run.pagesExcluded,
    scoringStatus: run.scoringStatus,
    scoringError: run.scoringError ?? null,
    errorCount: run.errors.length,
    rankabilityScore: run.rankability?.weightedTotalScore ?? null,
    discoverabilityScore: run.discoverability?.discoverabilityScore ?? null,
    websiteContentScore: run.rankability?.factorScores.website_content_relevance_completeness.score ?? null,
    externalValidationScore: run.rankability?.factorScores.third_party_authority_external_validation.score ?? null,
    trustSignalsScore: run.rankability?.factorScores.on_site_trust_signals.score ?? null
  };
}

function normalizeDomain(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").toLowerCase();
  }
}

function getHostnameOnlyLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return normalizeDomain(value);
  }
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

