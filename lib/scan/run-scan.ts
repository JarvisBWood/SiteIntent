import {
  buildCategoryModel,
  buildCompetitorAnalyses,
  buildCompetitorAnalysisFromPage,
  buildObservedIntent
} from "@/lib/models";
import { scoreDiscoverability } from "@/lib/discoverability/score-site";
import { scoreWebsite } from "@/lib/scoring/score-site";
import { analyzePage } from "@/lib/scan/analyze";
import { crawlSite } from "@/lib/scan/crawl";
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
  options?: { onProgress?: (event: ScanProgressEvent) => void }
): Promise<ProjectScanRun> {
  const startedAt = new Date().toISOString();
  const scanMode: ScanMode = request.scanMode ?? "full";
  const isWebsiteFirstScan = scanMode === "initial";
  const emitProgress = (event: ScanProgressEvent) => options?.onProgress?.(event);

  let scan = createWebsiteScan({
    request,
    startedAt,
    status: "running"
  });

  emitProgress({
    stage: "queued",
    title: isWebsiteFirstScan ? "Preparing website scoring" : "Preparing competitor scoring",
    description:
      isWebsiteFirstScan
        ? "Starting the website analysis so the dashboard can score your site first."
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

  emitProgress({
    stage: "discovering",
    title: isWebsiteFirstScan ? "Website pages discovered" : "Website refresh complete",
    description:
      isWebsiteFirstScan
        ? `Found ${crawl.websiteScanPages.length} candidate pages and selected ${crawl.pagesToAnalyze.length} for website scoring.`
        : `Refreshed ${crawl.pagesToAnalyze.length} pages before starting competitor analysis.`,
    progress: 22,
    scanMode,
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

  const discoverabilityResult = await scoreDiscoverability({
    scan: completedRun,
    categoryModel: initialCategoryModel
  });
  const discoverability = discoverabilityResult.scorecard;
  const autoCompetitorUrls = selectAutoCompetitorUrls(discoverability, request.websiteUrl, request.competitorUrls);
  if (!isWebsiteFirstScan) {
    emitProgress({
      stage: "computing_discoverability",
      title: "Top competitors discovered",
      description: autoCompetitorUrls.length
        ? `Found ${autoCompetitorUrls.length} competitors to analyze next.`
        : "No competitors were discovered, so the scan will complete without competitor context.",
      progress: 91,
      scanMode,
      analyzedPages: completedRun.pages.length,
      totalPages: crawl.pagesToAnalyze.length,
      discoveredPages: completedRun.websiteScanPages.length,
      competitorUrls: autoCompetitorUrls,
      completedCompetitors: 0,
      totalCompetitors: autoCompetitorUrls.length
    });
  }
  const competitorAnalyses = isWebsiteFirstScan ? [] : await analyzeCompetitorHomepages(autoCompetitorUrls, emitProgress);

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
    stage: "computing_rankability",
    title: isWebsiteFirstScan ? "Scoring rankability" : "Refreshing rankability",
    description: isWebsiteFirstScan
      ? "Scoring the website itself so the dashboard can show your first AI Search Score."
      : "Re-scoring the website with competitor context included.",
    progress: 96,
    scanMode,
    analyzedPages: completedRun.pages.length,
    totalPages: crawl.pagesToAnalyze.length,
    discoveredPages: completedRun.websiteScanPages.length
  });

  const scoringResult = await scoreWebsite({
    scan: completedRun,
    categoryModel,
    competitorAnalyses
  });
  const rankability = scoringResult.scorecard;

  emitProgress({
    stage: "preparing_review",
    title: isWebsiteFirstScan ? "Preparing dashboard results" : "Preparing competitor results",
    description:
      isWebsiteFirstScan
        ? "Finalizing the first website scores for the dashboard."
        : "Finalizing competitor analysis in the background.",
    progress: 98,
    scanMode,
    analyzedPages: completedRun.pages.length,
    totalPages: crawl.pagesToAnalyze.length,
    discoveredPages: completedRun.websiteScanPages.length
  });

  completedRun = completeWebsiteScan(completedRun, {
    completedAt: new Date().toISOString(),
    rankability: rankability ?? undefined,
    discoverability: discoverability ?? undefined,
    scoringStatus: rankability || discoverability ? "completed" : "failed",
    scoringError: [scoringResult.error, discoverabilityResult.error].filter(Boolean).join(" | ") || null
  });

  const observedIntent = buildObservedIntent({
    categoryModel,
    latestScan: completedRun,
    competitorAnalyses,
    metrics: rankability
  });

  emitProgress({
    stage: "completed",
    title: isWebsiteFirstScan ? "Website scoring complete" : "Competitor scoring complete",
    description:
      isWebsiteFirstScan
        ? "The dashboard can now show your website scores while competitor scoring starts next."
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

  return completeWebsiteScan(completedRun, {
    observedIntent
  });
}

function selectAutoCompetitorUrls(
  discoverability: Awaited<ReturnType<typeof scoreDiscoverability>>["scorecard"],
  websiteUrl: string,
  fallbackUrls: string[]
) {
  if (!discoverability) {
    return fallbackUrls;
  }

  const targetDomain = normalizeDomain(websiteUrl);
  const selected = discoverability.aggregatedCandidates
    .filter((candidate) => normalizeDomain(candidate.website) !== targetDomain)
    .slice(0, 5)
    .map((candidate) => candidate.website);

  return selected.length ? selected : fallbackUrls;
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
      input.errors.push(error instanceof Error ? error.message : "Failed to analyze page.");
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
  competitorUrls: string[],
  emitProgress: (event: ScanProgressEvent) => void
) {
  if (!competitorUrls.length) {
    return [];
  }

  const analyses = [];
  for (let index = 0; index < competitorUrls.length; index += 1) {
    const websiteUrl = competitorUrls[index];
    try {
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

      analyses.push(
        buildCompetitorAnalysisFromPage({
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
        })
      );
    } catch {
      analyses.push(...buildCompetitorAnalyses([websiteUrl]));
    }

    emitProgress({
      stage: "analyzing",
      title: "Scoring discovered competitors",
      description: `Processed ${index + 1} of ${competitorUrls.length} discovered competitor homepages.`,
      progress: Math.min(95, Math.round(91 + ((index + 1) / competitorUrls.length) * 4)),
      scanMode: "full",
      competitorUrls,
      competitorAnalyses: analyses,
      completedCompetitors: analyses.length,
      totalCompetitors: competitorUrls.length
    });
  }

  return analyses;
}

function normalizeDomain(value: string) {
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return value.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}
