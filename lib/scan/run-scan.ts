import OpenAI from "openai";

import { loadAppState } from "@/lib/app-state";
import { MODEL_CONFIG } from "@/lib/llm/model-config";
import { normalizeProviderModelSelection, type ModelProvider } from "@/lib/llm/provider-models";
import { coerceWebSearchCapableModel } from "@/lib/llm/web-search-models";
import {
  buildCategoryModel,
  buildCompetitorAnalyses,
  buildCompetitorAnalysisFromPage,
  buildObservedIntent,
  type CompetitorAnalysis
} from "@/lib/models";
import { scoreDiscoverabilityAcrossModels } from "@/lib/discoverability/score-site";
import type { AggregatedCandidate, DiscoverabilityProviderResult } from "@/lib/discoverability/types";
import { scoreWebsiteAcrossModels } from "@/lib/scoring/score-site";
import type { RankabilityProviderResult } from "@/lib/scoring/types";
import { analyzePage } from "@/lib/scan/analyze";
import { crawlSite } from "@/lib/scan/crawl";
import { logScanEvent, toErrorDetails } from "@/lib/scan/logging";
import { completeWebsiteScan, createWebsiteScan, saveWebsiteScanPages } from "@/lib/scan/storage";
import { shortenDisplayUrl } from "@/lib/site-state";
import type {
  PageScanRecord,
  ProjectScanRequest,
  ProjectScanRun,
  ScanMode,
  ScanProgressEvent,
  WebsiteScanPage
} from "@/lib/scan/types";

export async function runProjectScan(
  request: ProjectScanRequest,
  options?: {
    onProgress?: (event: ScanProgressEvent) => void;
    onScanSnapshot?: (scan: ProjectScanRun) => void;
  }
): Promise<ProjectScanRun> {
  const requestedComparisonModels = normalizeProviderModelSelection(request.comparisonModels);
  if (request.scanMode === "competitors") {
    return runCompetitorOnlyScan(request, options);
  }

  logScanEvent({
    level: "info",
    event: "scan_started",
    projectId: request.projectId,
    projectName: request.projectName,
    websiteUrl: request.websiteUrl,
    scanMode: request.scanMode ?? "full",
    message: "Website scan started.",
    details: {
      competitorCount: request.competitorUrls.length,
      scanDepth: request.scanDepth,
      pageAnalysisModel: request.pageAnalysisModel ?? null,
      scoringModel: request.scoringModel ?? null,
      comparisonModels: requestedComparisonModels
    }
  });

  const startedAt = new Date().toISOString();
  const comparisonModels = requestedComparisonModels;
  const scanMode: ScanMode = request.scanMode ?? "full";
  const isWebsiteFirstScan = scanMode === "initial";
  const isFullWebsiteScan = scanMode === "full";
  const emitProgress = (event: ScanProgressEvent) => options?.onProgress?.(event);

  let scan = createWebsiteScan({
    request,
    startedAt,
    status: "running"
  });

  emitProgress({
    stage: "queued",
    title: isWebsiteFirstScan || isFullWebsiteScan ? "Preparing website scan" : "Preparing competitor scoring",
    description:
      isWebsiteFirstScan
        ? "Starting the website analysis so the dashboard can score your site first."
        : isFullWebsiteScan
          ? "Starting the full website refresh before discoverability and competitor comparison."
          : "Starting the background competitor analysis pass.",
    progress: 8,
    scanMode
  });

  const crawl = await crawlSite({
    websiteUrl: request.websiteUrl,
    scanDepth: request.scanDepth,
    homepageOnly: false,
    scanId: scan.id
  });

  scan = saveWebsiteScanPages(scan, crawl.websiteScanPages);
  if (crawl.errors.length) {
    logScanEvent({
      level: "warn",
      event: "crawl_completed_with_errors",
      projectId: request.projectId,
      projectName: request.projectName,
      websiteUrl: request.websiteUrl,
      scanId: scan.id,
      scanMode,
      message: "Crawl completed with errors.",
      details: {
        crawlErrors: crawl.errors,
        discoveredPages: crawl.websiteScanPages.length,
        selectedPages: crawl.pagesToAnalyze.length
      }
    });
  }

  emitProgress({
    stage: "discovering",
    title: isWebsiteFirstScan || isFullWebsiteScan ? "Website pages discovered" : "Website refresh complete",
    description:
      isWebsiteFirstScan
        ? `Found ${crawl.websiteScanPages.length} candidate pages and selected ${crawl.pagesToAnalyze.length} for website scoring.`
        : isFullWebsiteScan
          ? `Found ${crawl.websiteScanPages.length} candidate pages and selected ${crawl.pagesToAnalyze.length} for the full scan.`
          : `Refreshed ${crawl.pagesToAnalyze.length} pages before starting competitor analysis.`,
    progress: 22,
    scanMode,
    currentLabel: crawl.pagesToAnalyze[0]?.url ?? request.websiteUrl,
    discoveredPages: crawl.websiteScanPages.length,
    totalPages: crawl.pagesToAnalyze.length
  });

  const analysis = await analyzeProjectPages({
    crawlPages: crawl.pagesToAnalyze,
    crawlSeeds: crawl.seeds,
    errors: [...crawl.errors],
    request,
    emitProgress,
    scanMode,
    websiteScanPages: scan.websiteScanPages
  });

  scan = completeWebsiteScan(scan, {
    websiteScanPages: analysis.websiteScanPages,
    status: analysis.errors.length && !analysis.pages.length ? "failed" : "completed",
    errors: analysis.errors
  });

  emitProgress({
    stage: "building_category",
    title: "Building website context",
    description:
      isWebsiteFirstScan
        ? "Building the website context used for the first dashboard scores."
        : isFullWebsiteScan
          ? "Building the website context before discoverability and competitor comparison."
          : "Refreshing the website context before comparing against competitors.",
    progress: 86,
    scanMode,
    analyzedPages: scan.pages.length,
    totalPages: crawl.pagesToAnalyze.length,
    discoveredPages: scan.websiteScanPages.length
  });

  let completedRun: ProjectScanRun = completeWebsiteScan(scan, {
    completedAt: new Date().toISOString(),
    scoringStatus: scan.pages.length ? "completed" : "failed"
  });

  const baselineCompetitorAnalyses = buildCompetitorAnalyses([]);
  const initialCategoryModel = buildCategoryModel({
    project: {
      id: request.projectId,
      name: request.projectName,
      websiteUrl: request.websiteUrl,
      websiteDisplayUrl: shortenDisplayUrl(request.websiteUrl),
      websiteFaviconUrl: null,
      competitorUrls: request.competitorUrls,
      competitorDisplayUrls: request.competitorUrls.map((value) => shortenDisplayUrl(value)),
      competitorFaviconUrls: request.competitorUrls.map(() => null),
      competitorAnalysesByUrl: {},
      competitorRefreshStatusByUrl: {},
      scanDepth: request.scanDepth,
      createdAt: startedAt,
      updatedAt: startedAt
    },
    latestScan: completedRun,
    competitorAnalyses: baselineCompetitorAnalyses
  });

  const rankabilityResult = await scoreWebsiteAcrossModels({
    scan: completedRun,
    categoryModel: initialCategoryModel,
    competitorAnalyses: [],
    targetIntentModel: request.targetIntentModel,
    models: comparisonModels
  });
  const websiteRankability = rankabilityResult.scorecard;
  const scoringError = rankabilityResult.error;
  const providerScanResults = combineProviderScanResults(rankabilityResult.results, []);

  completedRun = completeWebsiteScan(completedRun, {
    completedAt: new Date().toISOString(),
    rankability: websiteRankability ?? undefined,
    modelSelections: comparisonModels,
    providerScanResults,
    scoringStatus: websiteRankability ? "completed" : "failed",
    scoringError
  });
  options?.onScanSnapshot?.(completedRun);

  emitProgress({
    stage: "computing_rankability",
    title: "Website quality score ready",
    description:
      "The dashboard now has the website's rankability score. Discoverability and competitor benchmarking are continuing in the background.",
    progress: 89,
    scanMode,
    analyzedPages: completedRun.pages.length,
    totalPages: crawl.pagesToAnalyze.length,
    discoveredPages: completedRun.websiteScanPages.length
  });

  emitProgress({
    stage: "computing_discoverability",
    title: isWebsiteFirstScan ? "Scoring discoverability" : "Discovering top competitors",
    description: isWebsiteFirstScan
      ? "Running repeated AI discovery prompts to score how often the website is found."
      : "Running repeated AI discovery prompts to identify the top competitors to score next.",
    progress: 90,
    scanMode,
    analyzedPages: completedRun.pages.length,
    totalPages: crawl.pagesToAnalyze.length,
    discoveredPages: completedRun.websiteScanPages.length
  });

  const discoverabilityResult = await scoreDiscoverabilityAcrossModels({
    scan: completedRun,
    categoryModel: initialCategoryModel,
    models: comparisonModels,
    targetIntentModel: request.targetIntentModel,
    onPartialScorecard(partialScorecard) {
      const partialRun = completeWebsiteScan(completedRun, {
        completedAt: new Date().toISOString(),
        rankability: websiteRankability ?? undefined,
        discoverability: partialScorecard,
        modelSelections: comparisonModels,
        providerScanResults,
        scoringStatus: websiteRankability || partialScorecard ? "completed" : "failed",
        scoringError: scoringError ?? null
      });
      options?.onScanSnapshot?.(partialRun);
      emitProgress({
        stage: "computing_discoverability",
        title: isWebsiteFirstScan ? "Scoring discoverability" : "Discovering top competitors",
        description: isWebsiteFirstScan
          ? "Updating discoverability signals from repeated AI discovery prompts."
          : "Updating discoverability signals while identifying the top competitors to score next.",
        progress: Math.min(
          93,
          90 + Math.round((partialScorecard.discoveryRuns.length / Math.max(partialScorecard.discoveryRuns.length, 1, 7)) * 3)
        ),
        scanMode,
        analyzedPages: completedRun.pages.length,
        totalPages: crawl.pagesToAnalyze.length,
        discoveredPages: completedRun.websiteScanPages.length
      });
    }
  });
  const discoverability = discoverabilityResult.scorecard;

  if (scoringError || discoverabilityResult.error) {
    logScanEvent({
      level: "warn",
      event: "scan_scoring_warning",
      projectId: request.projectId,
      projectName: request.projectName,
      websiteUrl: request.websiteUrl,
      scanId: completedRun.id,
      scanMode,
      message: "One or more website scoring stages returned an error.",
      details: {
        rankabilityError: scoringError,
        discoverabilityError: discoverabilityResult.error
      }
    });
  }

  completedRun = completeWebsiteScan(completedRun, {
    completedAt: new Date().toISOString(),
    rankability: websiteRankability ?? undefined,
    discoverability: discoverability ?? undefined,
    modelSelections: comparisonModels,
    providerScanResults: combineProviderScanResults(rankabilityResult.results, discoverabilityResult.results),
    scoringStatus: websiteRankability || discoverability ? "completed" : "failed",
    scoringError: [scoringError, discoverabilityResult.error].filter(Boolean).join(" | ") || null
  });
  options?.onScanSnapshot?.(completedRun);

  emitProgress({
    stage: "computing_discoverability",
    title: "Website scores ready",
    description:
      "The dashboard now has the website's own scores. Competitor discovery and benchmarking are continuing in the background.",
    progress: 94,
    scanMode,
    analyzedPages: completedRun.pages.length,
    totalPages: crawl.pagesToAnalyze.length,
    discoveredPages: completedRun.websiteScanPages.length
  });

  if (!isWebsiteFirstScan) {
    const discoveredCompetitorCandidates = selectAutoCompetitorCandidates(discoverability, request.websiteUrl);
    emitProgress({
      stage: "computing_discoverability",
      title: "Validating discovered competitors",
      description: discoveredCompetitorCandidates.length
        ? `Found ${discoveredCompetitorCandidates.length} possible competitors and now checking which ones are true competitors.`
        : "No competitors were discovered, so the scan will complete without competitor context.",
      progress: 91,
      scanMode,
      analyzedPages: completedRun.pages.length,
      totalPages: crawl.pagesToAnalyze.length,
      discoveredPages: completedRun.websiteScanPages.length,
      competitorUrls: discoveredCompetitorCandidates.map((candidate) => candidate.website),
      completedCompetitors: 0,
      totalCompetitors: discoveredCompetitorCandidates.length
    });
  }
  const competitorAnalyses = isWebsiteFirstScan
    ? []
    : await analyzeCompetitorHomepages(
        selectAutoCompetitorCandidates(discoverability, request.websiteUrl),
        emitProgress,
        {
          targetScan: completedRun,
          categoryModel: initialCategoryModel,
          targetIntentModel: request.targetIntentModel,
          onPartialAnalyses(nextAnalyses) {
            completedRun = completeWebsiteScan(completedRun, {
              competitorAnalyses: nextAnalyses
            });
            options?.onScanSnapshot?.(completedRun);
          }
        }
      );
  const autoCompetitorUrls = competitorAnalyses.map((analysis) => analysis.url);

  completedRun = completeWebsiteScan(completedRun, {
    competitorAnalyses
  });

  const categoryModel = buildCategoryModel({
    project: {
      id: request.projectId,
      name: request.projectName,
      websiteUrl: request.websiteUrl,
      websiteDisplayUrl: shortenDisplayUrl(request.websiteUrl),
      websiteFaviconUrl: null,
      competitorUrls: autoCompetitorUrls,
      competitorDisplayUrls: autoCompetitorUrls.map((value) => shortenDisplayUrl(value)),
      competitorFaviconUrls: autoCompetitorUrls.map(() => null),
      competitorAnalysesByUrl: {},
      competitorRefreshStatusByUrl: {},
      scanDepth: request.scanDepth,
      createdAt: startedAt,
      updatedAt: startedAt
    },
    latestScan: completedRun,
    competitorAnalyses
  });

  emitProgress({
    stage: "preparing_review",
    title: isWebsiteFirstScan || isFullWebsiteScan ? "Preparing dashboard results" : "Preparing competitor results",
    description:
      isWebsiteFirstScan
        ? "Finalizing the first website scores for the dashboard."
        : isFullWebsiteScan
          ? "Finalizing the refreshed dashboard and competitor results."
          : "Finalizing competitor analysis in the background.",
    progress: 98,
    scanMode,
    analyzedPages: completedRun.pages.length,
    totalPages: crawl.pagesToAnalyze.length,
    discoveredPages: completedRun.websiteScanPages.length
  });

  completedRun = completeWebsiteScan(completedRun, {
    completedAt: new Date().toISOString(),
    rankability: websiteRankability ?? undefined,
    discoverability: discoverability ?? undefined,
    modelSelections: comparisonModels,
    providerScanResults: combineProviderScanResults(rankabilityResult.results, discoverabilityResult.results),
    scoringStatus: websiteRankability || discoverability ? "completed" : "failed",
    scoringError: [scoringError, discoverabilityResult.error].filter(Boolean).join(" | ") || null
  });

  const observedIntent = buildObservedIntent({
    categoryModel,
    latestScan: completedRun,
    competitorAnalyses,
    metrics: websiteRankability
  });

  emitProgress({
    stage: "completed",
    title: isWebsiteFirstScan || isFullWebsiteScan ? "Website scan complete" : "Competitor scoring complete",
    description:
      isWebsiteFirstScan
        ? "The dashboard can now show your website scores while competitor scoring starts next."
        : isFullWebsiteScan
          ? "The dashboard and competitor views can now show the refreshed results."
          : "The competitor page can now show the completed comparison set.",
    progress: 100,
    scanMode,
    analyzedPages: completedRun.pages.length,
    totalPages: crawl.pagesToAnalyze.length,
    discoveredPages: completedRun.websiteScanPages.length,
    competitorUrls: autoCompetitorUrls,
    competitorAnalyses,
    completedCompetitors: competitorAnalyses.length,
    totalCompetitors: autoCompetitorUrls.length
  });

  const finalizedRun = completeWebsiteScan(completedRun, {
    observedIntent
  });

  logScanEvent({
    level: finalizedRun.scoringStatus === "failed" ? "error" : "info",
    event: "scan_completed",
    projectId: request.projectId,
    projectName: request.projectName,
    websiteUrl: request.websiteUrl,
    scanId: finalizedRun.id,
    scanMode,
    message: "Website scan completed.",
    details: {
      status: finalizedRun.status,
      scoringStatus: finalizedRun.scoringStatus,
      scoringError: finalizedRun.scoringError ?? null,
      errorCount: finalizedRun.errors.length,
      competitorCount: finalizedRun.competitorAnalyses?.length ?? 0
    }
  });

  return finalizedRun;
}

async function runCompetitorOnlyScan(
  request: ProjectScanRequest,
  options?: {
    onProgress?: (event: ScanProgressEvent) => void;
    onScanSnapshot?: (scan: ProjectScanRun) => void;
  }
): Promise<ProjectScanRun> {
  const emitProgress = (event: ScanProgressEvent) => options?.onProgress?.(event);
  const persistedState = await loadAppState();
  const baseScan = persistedState.scanRuns.find((scan) => scan.projectId === request.projectId) ?? null;
  const comparisonModels = normalizeProviderModelSelection(request.comparisonModels ?? baseScan?.modelSelections);

  logScanEvent({
    level: "info",
    event: "competitor_scan_started",
    projectId: request.projectId,
    projectName: request.projectName,
    websiteUrl: request.websiteUrl,
    scanMode: "competitors",
    message: "Competitor-only scan started.",
    details: {
      scanDepth: request.scanDepth,
      pageAnalysisModel: request.pageAnalysisModel ?? null,
      scoringModel: request.scoringModel ?? null,
      comparisonModels
    }
  });

  if (!baseScan || !baseScan.pages.length) {
    logScanEvent({
      level: "error",
      event: "competitor_scan_missing_base_scan",
      projectId: request.projectId,
      projectName: request.projectName,
      websiteUrl: request.websiteUrl,
      scanMode: "competitors",
      message: "A website scan must exist before running a competitor-only scan."
    });
    throw new Error("A website scan must exist before running a competitor-only scan.");
  }
  const startedAt = new Date().toISOString();
  const baselineCompetitorAnalyses = buildCompetitorAnalyses([]);
  const initialCategoryModel = buildCategoryModel({
    project: {
      id: request.projectId,
      name: request.projectName,
      websiteUrl: request.websiteUrl,
      websiteDisplayUrl: shortenDisplayUrl(request.websiteUrl),
      websiteFaviconUrl: null,
      competitorUrls: request.competitorUrls,
      competitorDisplayUrls: request.competitorUrls.map((value) => shortenDisplayUrl(value)),
      competitorFaviconUrls: request.competitorUrls.map(() => null),
      competitorAnalysesByUrl: {},
      competitorRefreshStatusByUrl: {},
      scanDepth: request.scanDepth,
      createdAt: startedAt,
      updatedAt: startedAt
    },
    latestScan: baseScan,
    competitorAnalyses: baselineCompetitorAnalyses
  });

  emitProgress({
    stage: "queued",
    title: "Preparing competitor scan",
    description: "Using the latest saved website scan as the baseline for competitor discovery and comparison.",
    progress: 8,
    scanMode: "competitors",
    analyzedPages: baseScan.pages.length,
    totalPages: baseScan.pages.length,
    discoveredPages: baseScan.websiteScanPages.length
  });

  emitProgress({
    stage: "computing_discoverability",
    title: "Discovering top competitors",
    description: "Running repeated AI discovery prompts to refresh the competitor set without recrawling the website.",
    progress: 88,
    scanMode: "competitors",
    analyzedPages: baseScan.pages.length,
    totalPages: baseScan.pages.length,
    discoveredPages: baseScan.websiteScanPages.length
  });

  const discoverabilityResult = await scoreDiscoverabilityAcrossModels({
    scan: baseScan,
    categoryModel: initialCategoryModel,
    models: comparisonModels,
    targetIntentModel: request.targetIntentModel
  });
  const discoverability = discoverabilityResult.scorecard ?? baseScan.discoverability ?? undefined;
  if (discoverabilityResult.error) {
    logScanEvent({
      level: "warn",
      event: "competitor_scan_discoverability_warning",
      projectId: request.projectId,
      projectName: request.projectName,
      websiteUrl: request.websiteUrl,
      scanId: baseScan.id,
      scanMode: "competitors",
      message: discoverabilityResult.error,
      details: {
        discoverabilityError: discoverabilityResult.error
      }
    });
  }
  const discoveredCompetitorCandidates = selectAutoCompetitorCandidates(discoverabilityResult.scorecard, request.websiteUrl);

  emitProgress({
    stage: "computing_discoverability",
    title: "Validating discovered competitors",
    description: discoveredCompetitorCandidates.length
      ? `Found ${discoveredCompetitorCandidates.length} possible competitors and now checking which ones are true competitors.`
      : "No competitors were discovered, so the previous website scores will be kept unchanged.",
    progress: 91,
    scanMode: "competitors",
    analyzedPages: baseScan.pages.length,
    totalPages: baseScan.pages.length,
    discoveredPages: baseScan.websiteScanPages.length,
    competitorUrls: discoveredCompetitorCandidates.map((candidate) => candidate.website),
    completedCompetitors: 0,
    totalCompetitors: discoveredCompetitorCandidates.length
  });

  const competitorAnalyses = await analyzeCompetitorHomepages(
    discoveredCompetitorCandidates,
    emitProgress,
    {
      targetScan: baseScan,
      categoryModel: initialCategoryModel,
      targetIntentModel: request.targetIntentModel,
      comparisonModels,
      onPartialAnalyses(nextAnalyses) {
        const partialRun = completeWebsiteScan(createWebsiteScan({ request, startedAt, status: "completed" }), {
          completedAt: new Date().toISOString(),
          status: "completed",
          scoringStatus: "completed",
          websiteScanPages: baseScan.websiteScanPages,
          competitorAnalyses: nextAnalyses,
          rankability: baseScan.rankability,
          discoverability,
          modelSelections: comparisonModels,
          providerScanResults: combineProviderScanResultsFromScan(baseScan, discoverabilityResult.results),
          scoringError: discoverabilityResult.error ?? null,
          observedIntent: baseScan.observedIntent ?? undefined
        });
        options?.onScanSnapshot?.(partialRun);
      }
    }
  );
  const autoCompetitorUrls = competitorAnalyses.map((analysis) => analysis.url);
  const categoryModel = buildCategoryModel({
    project: {
      id: request.projectId,
      name: request.projectName,
      websiteUrl: request.websiteUrl,
      websiteDisplayUrl: shortenDisplayUrl(request.websiteUrl),
      websiteFaviconUrl: null,
      competitorUrls: autoCompetitorUrls,
      competitorDisplayUrls: autoCompetitorUrls.map((value) => shortenDisplayUrl(value)),
      competitorFaviconUrls: autoCompetitorUrls.map(() => null),
      competitorAnalysesByUrl: {},
      competitorRefreshStatusByUrl: {},
      scanDepth: request.scanDepth,
      createdAt: baseScan.startedAt,
      updatedAt: new Date().toISOString()
    },
    latestScan: baseScan,
    competitorAnalyses
  });

  const completedRun = completeWebsiteScan(createWebsiteScan({ request, startedAt, status: "completed" }), {
    completedAt: new Date().toISOString(),
    status: "completed",
    scoringStatus: "completed",
    websiteScanPages: baseScan.websiteScanPages,
    competitorAnalyses,
    rankability: baseScan.rankability,
    discoverability,
    modelSelections: comparisonModels,
    providerScanResults: combineProviderScanResultsFromScan(baseScan, discoverabilityResult.results),
    scoringError: discoverabilityResult.error ?? null,
    observedIntent:
      baseScan.observedIntent ??
      buildObservedIntent({
        categoryModel,
        latestScan: baseScan,
        competitorAnalyses,
        metrics: baseScan.rankability ?? null
      })
  });

  emitProgress({
    stage: "completed",
    title: "Competitor scoring complete",
    description: "The competitor page can now show the completed comparison set.",
    progress: 100,
    scanMode: "competitors",
    analyzedPages: baseScan.pages.length,
    totalPages: baseScan.pages.length,
    discoveredPages: baseScan.websiteScanPages.length,
    competitorUrls: autoCompetitorUrls,
    competitorAnalyses,
    completedCompetitors: competitorAnalyses.length,
    totalCompetitors: autoCompetitorUrls.length
  });

  logScanEvent({
    level: completedRun.scoringStatus === "failed" ? "error" : "info",
    event: "competitor_scan_completed",
    projectId: request.projectId,
    projectName: request.projectName,
    websiteUrl: request.websiteUrl,
    scanId: completedRun.id,
    scanMode: "competitors",
    message: "Competitor-only scan completed.",
    details: {
      scoringStatus: completedRun.scoringStatus,
      scoringError: completedRun.scoringError ?? null,
      competitorCount: completedRun.competitorAnalyses?.length ?? 0
    }
  });

  return completedRun;
}

function selectAutoCompetitorCandidates(
  discoverability: Awaited<ReturnType<typeof scoreDiscoverabilityAcrossModels>>["scorecard"],
  websiteUrl: string
) {
  if (!discoverability) {
    return [];
  }

  const targetDomain = normalizeDomain(websiteUrl);
  return discoverability.aggregatedCandidates
    .filter((candidate) => normalizeDomain(candidate.website) !== targetDomain)
    .slice(0, 10);
}

function combineProviderScanResults(
  rankabilityResults: RankabilityProviderResult[],
  discoverabilityResults: DiscoverabilityProviderResult[]
) {
  const providers: ModelProvider[] = ["openai", "anthropic", "google"];
  return providers.map((provider) => {
    const rankability = rankabilityResults.find((entry) => entry.provider === provider);
    const discoverability = discoverabilityResults.find((entry) => entry.provider === provider);

    return {
      provider,
      model: discoverability?.model ?? rankability?.model ?? "",
      rankability: rankability?.scorecard ?? null,
      discoverability: discoverability?.scorecard ?? null,
      rankabilityError: rankability?.error ?? null,
      discoverabilityError: discoverability?.error ?? null
    };
  });
}

function combineProviderScanResultsFromScan(
  scan: ProjectScanRun,
  discoverabilityResults: DiscoverabilityProviderResult[]
) {
  const existingRankabilityResults: RankabilityProviderResult[] = (scan.providerScanResults ?? []).map((entry) => ({
    provider: entry.provider,
    model: entry.model,
    scorecard: entry.rankability ?? null,
    error: entry.rankabilityError ?? null
  }));
  return combineProviderScanResults(existingRankabilityResults, discoverabilityResults);
}

async function analyzeProjectPages(input: {
  crawlPages: Awaited<ReturnType<typeof crawlSite>>["pagesToAnalyze"];
  crawlSeeds: Awaited<ReturnType<typeof crawlSite>>["seeds"];
  errors: string[];
  request: ProjectScanRequest;
  emitProgress: (event: ScanProgressEvent) => void;
  scanMode: ScanMode;
  websiteScanPages: WebsiteScanPage[];
}) {
  const pages: PageScanRecord[] = [];
  const websiteScanPages = [...input.websiteScanPages];
  const totalPages = input.crawlPages.length || 1;

  for (const page of input.crawlPages) {
    try {
      const analysis = await analyzePage(page, {
        projectName: input.request.projectName,
        websiteUrl: input.request.websiteUrl,
        competitorUrls: input.request.competitorUrls
      });

      const analyzedPage: PageScanRecord = {
        url: analysis.url,
        normalizedUrl: analysis.normalizedUrl,
        pageType: analysis.pageType,
        pageTitle: analysis.pageTitle,
        metaTitle: analysis.metaTitle,
        metaDescription: analysis.metaDescription,
        h1: analysis.h1,
        headings: analysis.headings,
        mainText: analysis.mainText,
        excerpt: analysis.excerpt,
        wordCount: analysis.wordCount,
        contentHash: analysis.contentHash,
        httpStatus: analysis.httpStatus,
        crawlDepth: analysis.crawlDepth,
        internalLinks: analysis.internalLinks,
        discoverySources: input.crawlSeeds.find((seed) => seed.url === analysis.url)?.discoverySources ?? ["internal-link"],
        scrapeTimestamp: analysis.scrapeTimestamp,
        canonicalUrl: analysis.canonicalUrl,
        passes: analysis.passes,
        merged: analysis.merged,
        mergeDecision: analysis.mergeDecision,
        unstableReason: analysis.unstableReason
      };

      pages.push(analyzedPage);

      const pageIndex = websiteScanPages.findIndex((item) => item.normalizedUrl === analyzedPage.normalizedUrl);
      if (pageIndex >= 0) {
        websiteScanPages[pageIndex] = {
          ...websiteScanPages[pageIndex],
          passes: analyzedPage.passes,
          merged: analyzedPage.merged,
          mergeDecision: analyzedPage.mergeDecision,
          unstableReason: analyzedPage.unstableReason
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to analyze page.";
      input.errors.push(message);
      logScanEvent({
        level: "warn",
        event: "page_analysis_failed",
        projectId: input.request.projectId,
        projectName: input.request.projectName,
        websiteUrl: input.request.websiteUrl,
        scanMode: input.scanMode,
        message,
        details: {
          pageUrl: page.url,
          pageType: page.pageType,
          error: toErrorDetails(error)
        }
      });
    }

    input.emitProgress({
      stage: "analyzing",
      title: input.scanMode === "initial" ? "Analyzing website pages" : "Refreshing website pages",
      description:
        input.scanMode === "initial"
          ? `Processed ${pages.length} of ${input.crawlPages.length} selected pages for website scoring.`
          : `Processed ${pages.length} of ${input.crawlPages.length} selected pages before competitor scoring.`,
      progress: Math.min(78, Math.round(24 + (pages.length / totalPages) * 54)),
      scanMode: input.scanMode,
      currentUrl: page.url,
      currentLabel: page.pageType,
      analyzedPages: pages.length,
      totalPages: input.crawlPages.length,
      discoveredPages: input.websiteScanPages.length
    });
  }

  return {
    pages,
    websiteScanPages,
    errors: input.errors
  };
}

async function analyzeCompetitorHomepages(
  competitorCandidates: AggregatedCandidate[],
  emitProgress: (event: ScanProgressEvent) => void,
  context: {
    targetScan: ProjectScanRun;
    categoryModel: ReturnType<typeof buildCategoryModel>;
    targetIntentModel?: ProjectScanRequest["targetIntentModel"];
    comparisonModels?: ProjectScanRequest["comparisonModels"];
    onPartialAnalyses?: (analyses: CompetitorAnalysis[]) => void;
  }
) {
  if (!competitorCandidates.length) {
    return [];
  }

  const analyses = [];
  for (let index = 0; index < competitorCandidates.length; index += 1) {
    const candidate = competitorCandidates[index];
    const websiteUrl = candidate.website;
    try {
      if (isDirectoryLikeCompetitorCandidate(candidate.website)) {
        logScanEvent({
          level: "info",
          event: "competitor_candidate_rejected",
          projectId: context.targetScan.projectId,
          projectName: context.targetScan.projectName,
          websiteUrl: context.targetScan.websiteUrl,
          scanId: context.targetScan.id,
          scanMode: "full",
          message: "Competitor candidate was rejected before validation because it looks like a directory or roundup page.",
          details: {
            candidate: {
              name: candidate.name,
              website: candidate.website
            },
            threshold: COMPETITOR_VALIDATION_THRESHOLD
          }
        });
        continue;
      }

      let validation = await validateCompetitorCandidate({
        targetScan: context.targetScan,
        categoryModel: context.categoryModel,
        candidate,
        retryMode: "initial"
      });

      logScanEvent({
        level: "info",
        event: "competitor_candidate_validation",
        projectId: context.targetScan.projectId,
        projectName: context.targetScan.projectName,
        websiteUrl: context.targetScan.websiteUrl,
        scanId: context.targetScan.id,
        scanMode: "full",
        message: "Initial competitor validation completed.",
        details: {
          candidate: {
            name: candidate.name,
            website: candidate.website
          },
          validation
        }
      });

      if (shouldRecheckCompetitorCandidate(validation)) {
        logScanEvent({
          level: "info",
          event: "competitor_candidate_recheck_requested",
          projectId: context.targetScan.projectId,
          projectName: context.targetScan.projectName,
          websiteUrl: context.targetScan.websiteUrl,
          scanId: context.targetScan.id,
          scanMode: "full",
          message: "Competitor validation is borderline, so a recheck is being run.",
          details: {
            candidate: {
              name: candidate.name,
              website: candidate.website
            },
            initialValidation: validation
          }
        });

        const recheckedValidation = await validateCompetitorCandidate({
          targetScan: context.targetScan,
          categoryModel: context.categoryModel,
          candidate,
          retryMode: "recheck"
        });

        logScanEvent({
          level: "info",
          event: "competitor_candidate_recheck_completed",
          projectId: context.targetScan.projectId,
          projectName: context.targetScan.projectName,
          websiteUrl: context.targetScan.websiteUrl,
          scanId: context.targetScan.id,
          scanMode: "full",
          message: "Borderline competitor recheck completed.",
          details: {
            candidate: {
              name: candidate.name,
              website: candidate.website
            },
            initialValidation: validation,
            recheckedValidation
          }
        });

        if (recheckedValidation.confidence >= validation.confidence || recheckedValidation.isCompetitor) {
          validation = recheckedValidation;
        }
      }

      if (!validation.isCompetitor || validation.confidence < COMPETITOR_VALIDATION_THRESHOLD) {
        logScanEvent({
          level: "info",
          event: "competitor_candidate_rejected",
          projectId: context.targetScan.projectId,
          projectName: context.targetScan.projectName,
          websiteUrl: context.targetScan.websiteUrl,
          scanId: context.targetScan.id,
          scanMode: "full",
          message: "Competitor candidate was rejected after validation.",
          details: {
            candidate: {
              name: candidate.name,
              website: candidate.website
            },
            validation,
            threshold: COMPETITOR_VALIDATION_THRESHOLD
          }
        });

        emitProgress({
          stage: "analyzing",
          title: "Filtering discovered competitors",
          description: `Checked ${index + 1} of ${competitorCandidates.length} discovered websites and kept ${analyses.length} that scored at least ${COMPETITOR_VALIDATION_THRESHOLD}% competitor confidence.`,
          progress: Math.min(95, Math.round(91 + ((index + 1) / competitorCandidates.length) * 4)),
          scanMode: "full",
          currentUrl: candidate.website,
          currentLabel: candidate.name,
          competitorUrls: analyses.map((analysis) => analysis.url),
          competitorAnalyses: analyses,
          completedCompetitors: analyses.length,
          totalCompetitors: competitorCandidates.length
        });
        continue;
      }

      const crawl = await crawlSite({
        websiteUrl,
        scanDepth: 0,
        homepageOnly: true
      });
      const homepage = crawl.pagesToAnalyze[0];
      if (!homepage) {
        continue;
      }

      const analysis = await analyzePage(homepage, {
        projectName: `Competitor ${index + 1}`,
        websiteUrl,
        competitorUrls: []
      });

      const competitorPage = {
          url: analysis.url,
          normalizedUrl: analysis.normalizedUrl,
          pageType: analysis.pageType,
          pageTitle: analysis.pageTitle,
          metaTitle: analysis.metaTitle,
          metaDescription: analysis.metaDescription,
          h1: analysis.h1,
          headings: analysis.headings,
          mainText: analysis.mainText,
          excerpt: analysis.excerpt,
          wordCount: analysis.wordCount,
          contentHash: analysis.contentHash,
          httpStatus: analysis.httpStatus,
          crawlDepth: analysis.crawlDepth,
          internalLinks: analysis.internalLinks,
          discoverySources: ["internal-link"],
          scrapeTimestamp: analysis.scrapeTimestamp,
          canonicalUrl: analysis.canonicalUrl,
          passes: analysis.passes,
          merged: analysis.merged,
          mergeDecision: analysis.mergeDecision,
          unstableReason: analysis.unstableReason
        } satisfies PageScanRecord;
      const competitorWebsiteScanPage: WebsiteScanPage = {
        id: crypto.randomUUID(),
        scanId: crypto.randomUUID(),
        url: competitorPage.url,
        normalizedUrl: competitorPage.normalizedUrl,
        pageType: competitorPage.pageType,
        pageTitle: competitorPage.pageTitle,
        metaTitle: competitorPage.metaTitle,
        metaDescription: competitorPage.metaDescription,
        h1: competitorPage.h1,
        headings: competitorPage.headings,
        mainText: competitorPage.mainText,
        wordCount: competitorPage.wordCount,
        contentHash: competitorPage.contentHash,
        httpStatus: competitorPage.httpStatus,
        crawlDepth: competitorPage.crawlDepth,
        includeInScoring: true,
        exclusionReason: "",
        scrapeTimestamp: competitorPage.scrapeTimestamp,
        internalLinks: competitorPage.internalLinks,
        discoverySources: ["internal-link"],
        canonicalUrl: competitorPage.canonicalUrl,
        passes: competitorPage.passes,
        merged: competitorPage.merged,
        mergeDecision: competitorPage.mergeDecision,
        unstableReason: competitorPage.unstableReason
      };
      const competitorScan = completeWebsiteScan(
        createWebsiteScan({
          request: {
            projectId: `competitor:${normalizeDomain(websiteUrl)}`,
            projectName: `Competitor ${index + 1}`,
            websiteUrl,
            competitorUrls: [],
            scanMode: "full",
            scanDepth: 0
          },
          startedAt: new Date().toISOString(),
          status: "completed"
        }),
        {
          completedAt: new Date().toISOString(),
          status: "completed",
          scoringStatus: "completed",
          websiteScanPages: [competitorWebsiteScanPage]
        }
      );
      const competitorScoreCategoryModel = {
        ...context.categoryModel,
        updatedAt: new Date().toISOString()
      };
      const competitorModels = normalizeProviderModelSelection(
        context.comparisonModels ?? context.targetScan.modelSelections
      );
      const competitorDiscoverabilityResult = await scoreDiscoverabilityAcrossModels({
        scan: competitorScan,
        categoryModel: competitorScoreCategoryModel,
        models: competitorModels,
        targetIntentModel: context.targetIntentModel
      });
      const competitorRankabilityResult = await scoreWebsiteAcrossModels({
        scan: competitorScan,
        categoryModel: competitorScoreCategoryModel,
        competitorAnalyses: [],
        targetIntentModel: context.targetIntentModel,
        models: competitorModels
      });
      const rankabilityScore = competitorRankabilityResult.scorecard?.weightedTotalScore ?? null;
      const discoverabilityScore = competitorDiscoverabilityResult.scorecard?.discoverabilityScore ?? null;
      const aiSearchScore =
        rankabilityScore == null || discoverabilityScore == null
          ? null
          : roundOne(rankabilityScore * 0.4 + discoverabilityScore * 0.6);

      analyses.push({
        ...buildCompetitorAnalysisFromPage(competitorPage),
        competitorConfidence: validation.confidence,
        competitorReasoning: validation.reasoning,
        rankabilityScore,
        discoverabilityScore,
        aiSearchScore,
        rankabilityFactorScores: competitorRankabilityResult.scorecard
          ? Object.fromEntries(
              Object.entries(competitorRankabilityResult.scorecard.factorScores).map(([factorId, factor]) => [factorId, factor.score])
            )
          : undefined,
        discoverabilityFactorScores: competitorDiscoverabilityResult.scorecard
          ? Object.fromEntries(
              Object.entries(competitorDiscoverabilityResult.scorecard.factorScores).map(([factorId, factor]) => [factorId, factor.score])
            )
          : undefined,
        sourceDomains: uniqueStrings(candidate.sources.map((source) => source.sourceDomain)).slice(0, 8),
        sourceTypes: uniqueStrings(candidate.sources.map((source) => source.sourceType)).slice(0, 8),
        sourceEvidence: candidate.sources.slice(0, 12).map((source) => ({
          sourceName: source.sourceName,
          sourceDomain: source.sourceDomain,
          sourceType: source.sourceType,
          sourceUrl: source.sourceUrl,
          influence: source.influence,
          evidenceFound: source.evidenceFound
        })),
        discoveryReasons: candidate.reasons.slice(0, 5),
        supportingPromptVariations: candidate.supportingPromptVariations
      });
      logScanEvent({
        level: "info",
        event: "competitor_candidate_accepted",
        projectId: context.targetScan.projectId,
        projectName: context.targetScan.projectName,
        websiteUrl: context.targetScan.websiteUrl,
        scanId: context.targetScan.id,
        scanMode: "full",
        message: "Competitor candidate was accepted.",
        details: {
          candidate: {
            name: candidate.name,
            website: candidate.website
          },
          validation,
          currentCompetitorCount: analyses.length
        }
      });
      context.onPartialAnalyses?.([...analyses]);
    } catch (error) {
      logScanEvent({
        level: "warn",
        event: "competitor_candidate_failed",
        projectId: context.targetScan.projectId,
        projectName: context.targetScan.projectName,
        websiteUrl: context.targetScan.websiteUrl,
        scanId: context.targetScan.id,
        scanMode: "full",
        message: "Competitor candidate validation or scoring failed.",
        details: {
          candidate: {
            name: candidate.name,
            website: candidate.website
          },
          error: toErrorDetails(error)
        }
      });
      // Skip candidates that cannot be validated and scored cleanly. Fewer than five competitors is acceptable.
    }

    emitProgress({
      stage: "analyzing",
      title: "Scoring discovered competitors",
      description: `Checked ${index + 1} of ${competitorCandidates.length} discovered websites and kept ${analyses.length} validated competitors so far.`,
      progress: Math.min(95, Math.round(91 + ((index + 1) / competitorCandidates.length) * 4)),
      scanMode: "full",
      currentUrl: candidate.website,
      currentLabel: candidate.name,
      competitorUrls: analyses.map((analysis) => analysis.url),
      competitorAnalyses: analyses,
      completedCompetitors: analyses.length,
      totalCompetitors: competitorCandidates.length
    });

    if (analyses.length >= 5) {
      break;
    }
  }

  return analyses;
}

const COMPETITOR_VALIDATION_MODEL = coerceWebSearchCapableModel(
  process.env.SITEINTENT_COMPETITOR_VALIDATION_MODEL,
  MODEL_CONFIG.worker
);
const COMPETITOR_VALIDATION_THRESHOLD = 75;
const COMPETITOR_VALIDATION_RECHECK_MIN = 65;
const COMPETITOR_VALIDATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_competitor", "confidence", "reasoning"],
  properties: {
    is_competitor: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 100 },
    reasoning: { type: "string" }
  }
} as const;
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

async function validateCompetitorCandidate(input: {
  targetScan: ProjectScanRun;
  categoryModel: ReturnType<typeof buildCategoryModel>;
  candidate: AggregatedCandidate;
  retryMode?: "initial" | "recheck";
}) {
  const model = coerceWebSearchCapableModel(getCompetitorValidationModel(), MODEL_CONFIG.worker);
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    return {
      isCompetitor: false,
      confidence: 0,
      reasoning: "OPENAI_API_KEY is required for hosted scans because SiteIntent now uses model-native web search only."
    };
  }

  return validateCompetitorCandidateWithOpenAIModel(input, model);
}

async function validateCompetitorCandidateWithOpenAIModel(
  input: {
    targetScan: ProjectScanRun;
    categoryModel: ReturnType<typeof buildCategoryModel>;
    candidate: AggregatedCandidate;
    retryMode?: "initial" | "recheck";
  },
  model: string
) {
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    return {
      isCompetitor: false,
      confidence: 0,
      reasoning: "OPENAI_API_KEY is required for hosted scans because SiteIntent now uses model-native web search only."
    };
  }

  const client = new OpenAI({ apiKey: openAiApiKey });
  const response = await createCompetitorValidationResponse(client, {
    model,
    input: [
      {
        role: "system",
        content: [
          "You are validating whether a website is a true competitor to another website.",
          "Use web search for current evidence.",
          "Return only JSON matching the provided schema.",
          "A true competitor should serve a meaningfully similar product or service to a similar buyer in the same market context.",
          "The primary decision should be whether the candidate offers the same product or service target as the scanned website.",
          "For visitor management systems in Australia, a candidate that clearly offers visitor management software or visitor management systems for workplaces should usually be treated as a competitor unless it is clearly a directory, roundup, marketplace listing, agency, or unrelated adjacent tool.",
          input.retryMode === "recheck"
            ? "This is a second-pass review for a borderline candidate. Re-check carefully and do not reject a genuine direct competitor just because positioning, sector emphasis, or wording differs slightly."
            : "Focus on whether the candidate is a real direct alternative rather than a directory, review page, marketplace listing, or editorial roundup."
        ].join(" ")
      },
      {
        role: "user",
        content: [
          `Target website: ${input.targetScan.websiteUrl}`,
          `Target website name: ${input.targetScan.projectName}`,
          `Primary product/service target: ${input.categoryModel.category}`,
          `Candidate website: ${input.candidate.website}`,
          `Candidate name: ${input.candidate.name}`,
          `Category: ${input.categoryModel.category}`,
          `Customer: ${input.categoryModel.customer}`,
          `Problem: ${input.categoryModel.problem}`,
          `Expected concepts: ${input.categoryModel.expectedConcepts.slice(0, 8).join(", ") || "none"}`,
          `Why the candidate surfaced: ${input.candidate.reasons.slice(0, 3).join(" ") || "No stored reason."}`,
          "",
          "Decide whether the candidate is truly a competitor to the target website.",
          input.retryMode === "recheck"
            ? "This candidate was close to the acceptance threshold on the first pass. Reassess carefully and give a confidence score from 0 to 100."
            : "Give a confidence score from 0 to 100."
        ].join("\n")
      }
    ],
    tools: [WEB_SEARCH_TOOL],
    tool_choice: "required",
    text: {
      format: {
        type: "json_schema",
        name: "siteintent_competitor_validation",
        strict: true,
        schema: COMPETITOR_VALIDATION_SCHEMA
      }
    }
  });

  const payload = parseOpenAiJson(response) as {
    is_competitor?: unknown;
    confidence?: unknown;
    reasoning?: unknown;
  };

  return {
    isCompetitor: Boolean(payload.is_competitor),
    confidence: clampScore(payload.confidence),
    reasoning: typeof payload.reasoning === "string" ? payload.reasoning.trim() : ""
  };
}

function shouldRecheckCompetitorCandidate(result: { isCompetitor: boolean; confidence: number }) {
  return result.confidence >= COMPETITOR_VALIDATION_RECHECK_MIN && result.confidence < COMPETITOR_VALIDATION_THRESHOLD;
}

function isDirectoryLikeCompetitorCandidate(websiteUrl: string) {
  try {
    const url = new URL(websiteUrl);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    const path = url.pathname.toLowerCase();
    return (
      /\/(directory|alternatives?|comparison|comparisons|roundup|reviews?|report|reports)\b/.test(path) ||
      /(^|\.)(g2|capterra|getapp|softwareadvice|trustradius)\./.test(host)
    );
  } catch {
    const lower = websiteUrl.toLowerCase();
    return /\/(directory|alternatives?|comparison|comparisons|roundup|reviews?|report|reports)\b/.test(lower);
  }
}

async function createCompetitorValidationResponse(
  client: OpenAI,
  request: OpenAI.Responses.ResponseCreateParamsNonStreaming
) {
  return client.responses.create(request);
}

function parseOpenAiJson(response: { output_text?: string; output?: unknown[] }) {
  const text = response.output_text || extractTextFromOutput(response.output);
  if (!text) {
    throw new Error("OpenAI response did not include output text.");
  }

  return JSON.parse(text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, ""));
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

function clampScore(value: unknown) {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.min(100, Math.max(0, numeric));
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeDomain(value: string) {
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return value.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

function getCompetitorValidationModel() {
  return coerceWebSearchCapableModel(process.env.SITEINTENT_COMPETITOR_VALIDATION_MODEL, MODEL_CONFIG.worker);
}
