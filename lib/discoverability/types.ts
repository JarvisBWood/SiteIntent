export const DISCOVERABILITY_SCORING_PROFILE_ID = "discoverability_v2";
export const DISCOVERABILITY_TOP_N = 10;
export const DISCOVERABILITY_PROMPT_COUNT = 5;

export const DISCOVERABILITY_FACTORS = [
  {
    id: "search_result_presence",
    label: "Search Result Presence",
    description: "Whether explicit search-result or SERP evidence helped AI become aware of the website.",
    weight: 20
  },
  {
    id: "source_path_diversity",
    label: "Source Path Diversity",
    description: "How broadly the target website is covered across the source types AI appears to use for category discovery.",
    weight: 25
  },
  {
    id: "third_party_source_strength",
    label: "Third-Party Source Strength",
    description: "How well the target website is represented on the highest-value external discovery sources in the category.",
    weight: 25
  }
] as const;

export const DISCOVERY_SOURCE_TYPES = [
  "search_engine_result",
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
] as const;

export type DiscoverySourceType = (typeof DISCOVERY_SOURCE_TYPES)[number];
export type DiscoverabilityFactorId = (typeof DISCOVERABILITY_FACTORS)[number]["id"];

export type DiscoverySource = {
  sourceName: string;
  sourceDomain: string;
  sourceType: DiscoverySourceType;
  sourceUrl: string;
  influence: "high" | "medium" | "low";
  evidenceFound: string;
};

export type DiscoveryCandidate = {
  rank: number;
  name: string;
  website: string;
  reasonIncluded: string;
  discoverySources: DiscoverySource[];
};

export type DiscoveryRun = {
  promptVariation: number;
  question: string;
  usesWebSearch: boolean;
  candidates: DiscoveryCandidate[];
  targetAssessment: {
    appeared: boolean;
    rank: number | null;
    reasonFoundOrMissed: string;
    supportingSources: DiscoverySource[];
  };
  commonSources: DiscoverySource[];
  rawResponse: unknown;
  warnings: string[];
};

export type AggregatedCandidate = {
  domain: string;
  name: string;
  website: string;
  appearanceCount: number;
  appearanceRate: number;
  averageRank: number | null;
  bestRank: number | null;
  supportingPromptVariations: number[];
  reasons: string[];
  sources: DiscoverySource[];
  isTargetWebsite: boolean;
};

export type SourceFrequencySummary = {
  byDomain: Array<{ key: string; count: number }>;
  byType: Array<{ key: DiscoverySourceType; count: number }>;
  byInfluence: Array<{ key: "high" | "medium" | "low"; count: number }>;
  sourcesSupportingTarget: DiscoverySource[];
  sourcesSupportingCompetitors: DiscoverySource[];
};

export type DiscoverabilityFactorScore = {
  score: number;
  weight: number;
  weightedContribution: number;
  evidence: string;
};

export type DiscoverySourceOpportunity = {
  sourceName: string;
  sourceDomain: string;
  sourceType: DiscoverySourceType;
  influence: "high" | "medium" | "low";
  whyItMatters: string;
  targetPresent: boolean;
  targetEvidence: string;
  competitorEvidence: string[];
  competitorCount: number;
  recommendedAction: string;
};

export type DiscoverabilitySourceCoverage = {
  coverageScore: number;
  targetSourceCount: number;
  sourceTypeCoverageScore: number;
  highValueSourceCoverageScore: number;
  targetSourceTypes: DiscoverySourceType[];
  strongestSources: DiscoverySourceOpportunity[];
  missingHighValueSources: DiscoverySourceOpportunity[];
};

export type TargetDiscoveryResult = {
  website: string;
  domain: string;
  appeared: boolean;
  appearanceCount: number;
  appearanceRate: number;
  averageRank: number | null;
  bestRank: number | null;
  promptVariationsAppeared: number[];
  reasonsFoundOrMissed: string[];
  sourceTypes: DiscoverySourceType[];
  sources: DiscoverySource[];
};

export type DiscoverabilityScorecard = {
  model: string;
  scoringProfileId: typeof DISCOVERABILITY_SCORING_PROFILE_ID;
  usesWebSearch: boolean;
  category: string;
  context: string;
  discoverabilityScore: number;
  factorScores: Record<DiscoverabilityFactorId, DiscoverabilityFactorScore>;
  discoveryRuns: DiscoveryRun[];
  aggregatedCandidates: AggregatedCandidate[];
  targetWebsite: TargetDiscoveryResult;
  commonSources: SourceFrequencySummary;
  sourceCoverage: DiscoverabilitySourceCoverage;
  summary: string;
  warnings: string[];
};

export const DISCOVERABILITY_WEIGHTS: Record<DiscoverabilityFactorId, number> = Object.fromEntries(
  DISCOVERABILITY_FACTORS.map((factor) => [factor.id, factor.weight])
) as Record<DiscoverabilityFactorId, number>;

export const DISCOVERABILITY_WEIGHT_TOTAL = DISCOVERABILITY_FACTORS.reduce((sum, factor) => sum + factor.weight, 0);
