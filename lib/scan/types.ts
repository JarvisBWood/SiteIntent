import type { DiscoverabilityScorecard } from "@/lib/discoverability/types";
import type { CompetitorAnalysis } from "@/lib/models";
import type { RankabilityScorecard } from "@/lib/scoring/types";
import type { ObservedIntent } from "@/lib/site-state";
import type { ModelProvider, ProviderModelSelection } from "@/lib/llm/provider-models";

export type ScanDiscoverySource = "internal-link";

export type PageType =
  | "homepage"
  | "about"
  | "product"
  | "pricing"
  | "blog"
  | "contact"
  | "docs"
  | "content"
  | "unknown";

export type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

export type HeadingRecord = {
  level: HeadingLevel;
  text: string;
};

export type PageOutput = {
  url: string;
  page_type: string;
  intent: string;
  audience: string;
  product: string;
  supporting_signals: string[];
  weakening_signals: string[];
  confidence: number;
  stability: number;
  timestamp: string;
};

export type AnalysisPassName = "A" | "B" | "C";

export type AnalysisPassResult = {
  pass: AnalysisPassName;
  model: string;
  parsed: PageOutput;
  raw: unknown;
  prompt: string;
};

export type PageMetadata = {
  title: string;
  metaTitle: string;
  metaDescription: string;
  canonicalUrl: string | null;
  h1: string;
  headings: HeadingRecord[];
};

export type PageDiscoveryRecord = {
  url: string;
  discoverySources: ScanDiscoverySource[];
  depth: number;
};

export type PageExtraction = {
  url: string;
  normalizedUrl: string;
  pageType: PageType;
  metadata: PageMetadata;
  mainText: string;
  excerpt: string;
  internalLinks: string[];
  wordCount: number;
  contentHash: string;
  httpStatus: number;
  contentType: string;
  crawlDepth: number;
  scrapeTimestamp: string;
};

export type WebsiteScanStatus = "queued" | "running" | "completed" | "failed";

export type WebsiteScanPage = {
  id: string;
  scanId: string;
  url: string;
  normalizedUrl: string;
  pageType: PageType;
  pageTitle: string;
  metaTitle: string;
  metaDescription: string;
  h1: string;
  headings: HeadingRecord[];
  mainText: string;
  wordCount: number;
  contentHash: string;
  httpStatus: number | null;
  crawlDepth: number;
  includeInScoring: boolean;
  exclusionReason: string;
  scrapeTimestamp: string;
  internalLinks: string[];
  discoverySources: ScanDiscoverySource[];
  canonicalUrl: string | null;
  passes?: AnalysisPassResult[];
  merged?: PageOutput;
  mergeDecision?: "stable" | "unstable";
  unstableReason?: string | null;
};

export type PageScanRecord = {
  url: string;
  normalizedUrl: string;
  pageType: PageType;
  pageTitle: string;
  metaTitle: string;
  metaDescription: string;
  h1: string;
  headings: HeadingRecord[];
  mainText: string;
  excerpt: string;
  wordCount: number;
  contentHash: string;
  httpStatus: number | null;
  crawlDepth: number;
  internalLinks: string[];
  discoverySources: ScanDiscoverySource[];
  scrapeTimestamp: string;
  canonicalUrl: string | null;
  passes: AnalysisPassResult[];
  merged: PageOutput;
  mergeDecision: "stable" | "unstable";
  unstableReason: string | null;
};

export type WebsiteScan = {
  id: string;
  projectId: string;
  projectName: string;
  websiteUrl: string;
  homepageUrl: string;
  scanMode: ScanMode;
  scanDepth: number;
  startedAt: string;
  completedAt: string;
  status: WebsiteScanStatus;
  pagesFound: number;
  pagesExcluded: number;
  pagesScored: number;
  discoveredPages: number;
  analyzedPages: number;
  excludedPageTypes: string[];
  totalWordCount: number;
  totalCharacters: number;
  scoringStatus: "pending" | "completed" | "failed";
  scoringError?: string | null;
  competitorAnalyses?: CompetitorAnalysis[];
  rankability?: RankabilityScorecard;
  discoverability?: DiscoverabilityScorecard;
  modelSelections?: ProviderModelSelection;
  providerScanResults?: Array<{
    provider: ModelProvider;
    model: string;
    rankability?: RankabilityScorecard | null;
    discoverability?: DiscoverabilityScorecard | null;
    rankabilityError?: string | null;
    discoverabilityError?: string | null;
  }>;
  observedIntent?: ObservedIntent | null;
  websiteScanPages: WebsiteScanPage[];
  pages: PageScanRecord[];
  errors: string[];
};

export type CrawlSeed = PageDiscoveryRecord;

export type ProjectScanRun = WebsiteScan;

export type ProjectScanRequest = {
  projectId: string;
  projectName: string;
  websiteUrl: string;
  competitorUrls: string[];
  scanMode?: ScanMode;
  scanDepth: number;
  pageAnalysisModel?: string;
  scoringModel?: string;
  comparisonModels?: Partial<ProviderModelSelection>;
  targetIntentModel?: {
    category: string;
    lockedConcepts: string[];
    removableConcepts: string[];
    addableConcepts: string[];
    notes: string;
    isLocationSpecific?: boolean;
    locationTargets?: import("@/lib/site-state").BusinessLocationTarget[];
    updatedAt: string;
  };
};

export type ScanProgressEvent = {
  stage:
    | "queued"
    | "discovering"
    | "analyzing"
    | "building_category"
    | "computing_rankability"
    | "computing_discoverability"
    | "preparing_review"
    | "completed";
  title: string;
  description: string;
  progress: number;
  currentUrl?: string;
  currentLabel?: string;
  analyzedPages?: number;
  totalPages?: number;
  discoveredPages?: number;
  scanMode?: ScanMode;
  competitorUrls?: string[];
  competitorAnalyses?: CompetitorAnalysis[];
  completedCompetitors?: number;
  totalCompetitors?: number;
};

export type ScanMode = "initial" | "full" | "competitors";
