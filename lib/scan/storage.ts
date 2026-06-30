import type {
  PageScanRecord,
  ProjectScanRequest,
  ProjectScanRun,
  WebsiteScan,
  WebsiteScanPage
} from "@/lib/scan/types";

export function createWebsiteScan(input: {
  request: ProjectScanRequest;
  scanId?: string;
  startedAt?: string;
  status?: WebsiteScan["status"];
}): WebsiteScan {
  const startedAt = input.startedAt ?? new Date().toISOString();

  return {
    id: input.scanId ?? crypto.randomUUID(),
    projectId: input.request.projectId,
    projectName: input.request.projectName,
    websiteUrl: input.request.websiteUrl,
    homepageUrl: input.request.websiteUrl,
    scanMode: input.request.scanMode ?? "full",
    scanDepth: input.request.scanDepth,
    startedAt,
    completedAt: startedAt,
    status: input.status ?? "queued",
    pagesFound: 0,
    pagesExcluded: 0,
    pagesScored: 0,
    discoveredPages: 0,
    analyzedPages: 0,
    excludedPageTypes: [],
    totalWordCount: 0,
    totalCharacters: 0,
    scoringStatus: "pending",
    scoringError: null,
    websiteScanPages: [],
    pages: [],
    errors: []
  };
}

export function saveWebsiteScanPages(scan: WebsiteScan, websiteScanPages: WebsiteScanPage[]): WebsiteScan {
  return reconcileWebsiteScan(scan, {
    websiteScanPages
  });
}

export function completeWebsiteScan(
  scan: WebsiteScan,
  updates: Partial<Omit<WebsiteScan, "websiteScanPages" | "pages">> & { websiteScanPages?: WebsiteScanPage[] }
): WebsiteScan {
  return reconcileWebsiteScan(scan, updates);
}

export function listProjectScans(scanRuns: ProjectScanRun[], projectId: string) {
  return scanRuns.filter((scan) => scan.projectId === projectId);
}

export function getScanWithPages(scanRuns: ProjectScanRun[], scanId: string) {
  return scanRuns.find((scan) => scan.id === scanId) ?? null;
}

export function getLatestScanForProject(scanRuns: ProjectScanRun[], projectId: string) {
  return scanRuns.find((scan) => scan.projectId === projectId) ?? null;
}

export function getIncludedPageRecords(scan: Pick<WebsiteScan, "websiteScanPages">): PageScanRecord[] {
  return scan.websiteScanPages
    .filter((page): page is WebsiteScanPage & Required<Pick<WebsiteScanPage, "merged" | "passes" | "mergeDecision">> => {
      return page.includeInScoring && Boolean(page.merged) && Boolean(page.passes) && Boolean(page.mergeDecision);
    })
    .map((page) => ({
      url: page.url,
      normalizedUrl: page.normalizedUrl,
      pageType: page.pageType,
      pageTitle: page.pageTitle,
      metaTitle: page.metaTitle,
      metaDescription: page.metaDescription,
      h1: page.h1,
      headings: page.headings,
      mainText: page.mainText,
      excerpt: page.mainText.slice(0, 4000),
      wordCount: page.wordCount,
      contentHash: page.contentHash,
      httpStatus: page.httpStatus,
      crawlDepth: page.crawlDepth,
      internalLinks: page.internalLinks,
      discoverySources: page.discoverySources,
      scrapeTimestamp: page.scrapeTimestamp,
      canonicalUrl: page.canonicalUrl,
      passes: page.passes,
      merged: page.merged,
      mergeDecision: page.mergeDecision,
      unstableReason: page.unstableReason ?? null
    }));
}

function reconcileWebsiteScan(
  scan: WebsiteScan,
  updates: Partial<Omit<WebsiteScan, "websiteScanPages" | "pages">> & { websiteScanPages?: WebsiteScanPage[] }
): WebsiteScan {
  const websiteScanPages = updates.websiteScanPages ?? scan.websiteScanPages;
  const pages = getIncludedPageRecords({ websiteScanPages });
  const pagesExcluded = websiteScanPages.filter((page) => !page.includeInScoring).length;
  const excludedPageTypes = [...new Set(websiteScanPages.filter((page) => !page.includeInScoring).map((page) => page.exclusionReason).filter(Boolean))];
  const totalWordCount = websiteScanPages.reduce((sum, page) => sum + page.wordCount, 0);
  const totalCharacters = websiteScanPages.reduce((sum, page) => sum + page.mainText.length, 0);

  return {
    ...scan,
    ...updates,
    websiteScanPages,
    pages,
    pagesFound: websiteScanPages.length,
    pagesExcluded,
    pagesScored: pages.length,
    discoveredPages: websiteScanPages.length,
    analyzedPages: pages.length,
    excludedPageTypes,
    totalWordCount,
    totalCharacters
  };
}
