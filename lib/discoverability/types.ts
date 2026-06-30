export const DISCOVERABILITY_SCORING_PROFILE_ID = "discoverability_v1";
export const DISCOVERABILITY_TOP_N = 10;
export const DISCOVERABILITY_PROMPT_COUNT = 5;

export const DISCOVERABILITY_FACTORS = [
  {
    id: "appearance_rate",
    label: "Appearance Rate",
    description: "How often the target domain appears across repeated discovery prompts.",
    weight: 30
  },
  {
    id: "average_discovered_rank",
    label: "Average Discovered Rank",
    description: "How high the target ranks when it does appear.",
    weight: 20
  },
  {
    id: "prompt_resilience",
    label: "Prompt Resilience",
    description: "Whether the target appears across different prompt phrasings.",
    weight: 15
  },
  {
    id: "source_path_diversity",
    label: "Source Path Diversity",
    description: "How broadly the target website is covered across the source types AI appears to use for category discovery.",
    weight: 10
  },
  {
    id: "third_party_source_strength",
    label: "Third-Party Source Strength",
    description: "How well the target website is represented on the highest-value external discovery sources in the category.",
    weight: 15
  },
  {
    id: "entity_match_clarity",
    label: "Entity Match Clarity",
    description: "How clearly the model connects the domain to the category, geography, and buyer intent.",
    weight: 10
  }
] as const;

export const DISCOVERY_SOURCE_TYPES = [
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
    entityMatchClarityScore: number;
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
