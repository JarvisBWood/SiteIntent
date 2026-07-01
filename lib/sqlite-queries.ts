import { buildCategoryModel, type CategoryModel, type CompetitorAnalysis, type TargetIntentModel } from "@/lib/models";
import { DISCOVERABILITY_FACTORS } from "@/lib/discoverability/types";
import { normalizeDiscoverabilityScorecard } from "@/lib/discoverability/score-site";
import {
  buildRecommendations,
  buildScanComparison,
  type Recommendation,
  type ScanComparison
} from "@/lib/recommendations";
import { RANKABILITY_FACTORS } from "@/lib/scoring/types";
import { getIncludedPageRecords } from "@/lib/scan/storage";
import type { ProjectScanRun, SiteIntentProject } from "@/lib/site-state";
import { shortenDisplayUrl } from "@/lib/site-state";
import { getSqliteDb } from "@/lib/sqlite";

type StoredScanRow = Omit<ProjectScanRun, "websiteScanPages" | "pages">;

type ScanRowRecord = {
  id: string;
  data_json: string;
};

type ScanPageRecord = {
  scan_id: string;
  page_index: number;
  data_json: string;
};

type ProjectRecord = {
  data_json: string;
};

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

export function getProjectScanHistoryReport(projectId: string): ProjectScanHistoryReport | null {
  const project = getProject(projectId);
  if (!project) {
    return null;
  }

  const scanRows = getProjectScanRows(projectId);
  if (!scanRows.length) {
    return {
      projectId,
      runCount: 0,
      latestRunId: null,
      comparison: null,
      runs: []
    };
  }

  const storedScans = scanRows.map((row) => JSON.parse(row.data_json) as StoredScanRow);
  const scanPagesById = getScanPagesByIds(scanRows.map((row) => row.id));
  const hydratedRuns = storedScans.map((scan) => hydrateStoredScan(scan, scanPagesById.get(scan.id) ?? []));

  return {
    projectId,
    runCount: hydratedRuns.length,
    latestRunId: hydratedRuns[0]?.id ?? null,
    comparison: buildScanComparison(hydratedRuns[0] ?? null, hydratedRuns[1] ?? null),
    runs: hydratedRuns.map((run) => summarizeScanRun(run))
  };
}

export function getProjectCompetitorReport(projectId: string): ProjectCompetitorReport | null {
  const project = getProject(projectId);
  if (!project) {
    return null;
  }

  const latestScanRow = getProjectScanRows(projectId, 1)[0];
  const latestScan = latestScanRow
    ? hydrateStoredScan(
        JSON.parse(latestScanRow.data_json) as StoredScanRow,
        getScanPagesByIds([latestScanRow.id]).get(latestScanRow.id) ?? []
      )
    : null;

  const discoverabilityCandidates = latestScan?.discoverability?.aggregatedCandidates ?? [];

  const competitorUrls = uniqueStrings([
    ...project.competitorUrls,
    ...(latestScan?.competitorAnalyses?.map((analysis) => analysis.url) ?? [])
  ]).slice(0, 5);

  const competitors = competitorUrls.map((url, index) => {
    const domain = normalizeDomain(url);
    const candidate = discoverabilityCandidates.find((item) => normalizeDomain(item.website) === domain) ?? null;
    const analysis =
      project.competitorAnalysesByUrl[url] ??
      latestScan?.competitorAnalyses?.find((item) => normalizeDomain(item.url) === domain) ??
      null;

    return {
      url,
      displayUrl:
        project.competitorDisplayUrls[project.competitorUrls.findIndex((value) => normalizeDomain(value) === domain)] ??
        shortenDisplayUrl(url),
      faviconUrl: project.competitorFaviconUrls[project.competitorUrls.findIndex((value) => normalizeDomain(value) === domain)] ?? null,
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

export function getProjectOverviewReport(projectId: string): ProjectOverviewReport | null {
  const project = getProject(projectId);
  if (!project) {
    return null;
  }

  const latestScan = getLatestHydratedScan(projectId);
  const competitorAnalyses = getResolvedCompetitorAnalyses(project, latestScan);
  const rankabilityBreakdown = latestScan?.rankability
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
    : [];
  const discoverabilityBreakdown = latestScan?.discoverability
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
    : [];
  const rankabilityScore = latestScan?.rankability?.weightedTotalScore ?? null;
  const discoverabilityScore = latestScan?.discoverability?.discoverabilityScore ?? null;
  const competitorBenchmarks = {
    aiSearchScore: getBestCompetitorBenchmark(
      competitorAnalyses,
      project,
      rankabilityScore == null || discoverabilityScore == null ? null : roundOne(rankabilityScore * 0.4 + discoverabilityScore * 0.6),
      "aiSearchScore"
    ),
    rankabilityScore: getBestCompetitorBenchmark(competitorAnalyses, project, rankabilityScore, "rankabilityScore"),
    discoverabilityScore: getBestCompetitorBenchmark(competitorAnalyses, project, discoverabilityScore, "discoverabilityScore")
  };

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
    competitorBenchmarks,
    rankabilityBreakdown,
    discoverabilityBreakdown,
    summary: {
      rankability: latestScan?.rankability?.summary ?? null,
      discoverability: latestScan?.discoverability?.summary ?? null
    }
  };
}

export function getWebsitesReport(): WebsitesReport {
  const db = getSqliteDb();
  const projectRows = db.prepare("SELECT data_json FROM projects ORDER BY sort_order ASC").all() as ProjectRecord[];
  const websites = projectRows.map((row) => {
    const project = JSON.parse(row.data_json) as SiteIntentProject;
    const latestScan = getLatestHydratedScan(project.id);

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
    } satisfies WebsiteListEntry;
  });

  return { websites };
}

export function getProjectRecommendationsReport(projectId: string): ProjectRecommendationsReport | null {
  const project = getProject(projectId);
  const latestScan = getLatestHydratedScan(projectId);
  const onboarding = getProjectOnboarding(projectId);
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
  const targetIntentModel = getTargetIntentModel(projectId) ?? null;
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


function getProject(projectId: string): SiteIntentProject | null {
  const db = getSqliteDb();
  const row = db
    .prepare("SELECT data_json FROM projects WHERE id = ? LIMIT 1")
    .get(projectId) as ProjectRecord | undefined;

  return row ? (JSON.parse(row.data_json) as SiteIntentProject) : null;
}

function getTargetIntentModel(projectId: string): TargetIntentModel | null {
  const db = getSqliteDb();
  const row = db
    .prepare("SELECT data_json FROM target_intent_models WHERE project_id = ? LIMIT 1")
    .get(projectId) as ProjectRecord | undefined;

  return row ? (JSON.parse(row.data_json) as TargetIntentModel) : null;
}

function getProjectOnboarding(projectId: string) {
  const db = getSqliteDb();
  const row = db
    .prepare("SELECT data_json FROM project_onboarding WHERE project_id = ? LIMIT 1")
    .get(projectId) as ProjectRecord | undefined;

  return row ? JSON.parse(row.data_json) : null;
}

function getProjectScanRows(projectId: string, limit?: number): ScanRowRecord[] {
  const db = getSqliteDb();
  const baseQuery = `
    SELECT id, data_json
    FROM scan_runs
    WHERE project_id = ?
    ORDER BY completed_at DESC, sort_order ASC
  `;

  if (typeof limit === "number") {
    return db.prepare(`${baseQuery} LIMIT ?`).all(projectId, limit) as ScanRowRecord[];
  }

  return db.prepare(baseQuery).all(projectId) as ScanRowRecord[];
}

function getLatestHydratedScan(projectId: string) {
  const latestScanRow = getProjectScanRows(projectId, 1)[0];
  if (!latestScanRow) {
    return null;
  }

  const storedScan = JSON.parse(latestScanRow.data_json) as StoredScanRow;
  const pagesById = getScanPagesByIds([latestScanRow.id]);
  return hydrateStoredScan(storedScan, pagesById.get(latestScanRow.id) ?? []);
}

function getAllHydratedScans(projectId: string) {
  const scanRows = getProjectScanRows(projectId);
  const pagesById = getScanPagesByIds(scanRows.map((row) => row.id));
  return scanRows.map((row) => hydrateStoredScan(JSON.parse(row.data_json) as StoredScanRow, pagesById.get(row.id) ?? []));
}

function getScanPagesByIds(scanIds: string[]) {
  const db = getSqliteDb();
  const pagesById = new Map<string, ProjectScanRun["websiteScanPages"]>();

  if (!scanIds.length) {
    return pagesById;
  }

  const placeholders = scanIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT scan_id, page_index, data_json
       FROM scan_pages
       WHERE scan_id IN (${placeholders})
       ORDER BY scan_id ASC, page_index ASC`
    )
    .all(...scanIds) as ScanPageRecord[];

  for (const row of rows) {
    const current = pagesById.get(row.scan_id) ?? [];
    current.push(JSON.parse(row.data_json) as ProjectScanRun["websiteScanPages"][number]);
    pagesById.set(row.scan_id, current);
  }

  return pagesById;
}

function hydrateStoredScan(storedScan: StoredScanRow, websiteScanPages: ProjectScanRun["websiteScanPages"]): ProjectScanRun {
  return {
    ...storedScan,
    discoverability: normalizeDiscoverabilityScorecard(storedScan.discoverability) ?? storedScan.discoverability,
    websiteScanPages,
    pages: getIncludedPageRecords({ websiteScanPages })
  };
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
    .map((analysis) => ({
      analysis,
      score: analysis[metric]
    }))
    .filter((entry): entry is { analysis: CompetitorAnalysis; score: number } => typeof entry.score === "number");

  if (!candidates.length) {
    return null;
  }

  const best = candidates.reduce((currentBest, entry) => (entry.score > currentBest.score ? entry : currentBest));
  const competitorUrl = best.analysis.url;
  const competitorIndex = project.competitorUrls.findIndex((url) => normalizeDomain(url) === normalizeDomain(competitorUrl));
  const competitorName = getHostnameOnlyLabel(competitorUrl);
  const competitorFaviconUrl =
    (competitorIndex >= 0 ? project.competitorFaviconUrls[competitorIndex] : null) ?? null;

  return {
    competitorName,
    competitorUrl,
    competitorFaviconUrl,
    score: best.score
  };
}

function getBestCompetitorFactorBenchmark(
  competitorAnalyses: CompetitorAnalysis[],
  project: SiteIntentProject,
  metric: "rankabilityFactorScores" | "discoverabilityFactorScores",
  factorId: string
): ScoreBenchmark | null {
  const candidates = competitorAnalyses
    .map((analysis) => {
      const score = analysis[metric]?.[factorId];
      return {
        analysis,
        score
      };
    })
    .filter((entry): entry is { analysis: CompetitorAnalysis; score: number } => typeof entry.score === "number");

  if (!candidates.length) {
    return null;
  }

  const best = candidates.reduce((currentBest, entry) => (entry.score > currentBest.score ? entry : currentBest));
  const competitorUrl = best.analysis.url;
  const competitorIndex = project.competitorUrls.findIndex((url) => normalizeDomain(url) === normalizeDomain(competitorUrl));
  const competitorName = getHostnameOnlyLabel(competitorUrl);
  const competitorFaviconUrl =
    (competitorIndex >= 0 ? project.competitorFaviconUrls[competitorIndex] : null) ?? null;

  return {
    competitorName,
    competitorUrl,
    competitorFaviconUrl,
    score: best.score
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
