export const RANKABILITY_SCORING_PROFILE_ID = "external_validation_v2";

export const RANKABILITY_FACTORS = [
  {
    id: "website_content_relevance_completeness",
    label: "Website Content",
    description:
      "How well the website's own content proves relevance and completeness for the category and buyer intent.",
    weight: 30
  },
  {
    id: "reviews_customer_reputation",
    label: "Reviews",
    description: "Customer review and reputation signals across credible review platforms.",
    weight: 5
  },
  {
    id: "third_party_authority_external_validation",
    label: "External Validation",
    description: "Independent external validation such as directories, editorial mentions, awards, and expert reviews.",
    weight: 30
  },
  {
    id: "on_site_trust_signals",
    label: "Trust Signals",
    description: "Trust signals visible on the website itself.",
    weight: 20
  },
  {
    id: "location_availability_service_coverage",
    label: "Location And Availability",
    description: "How well the website fits the buyer's geography and availability needs.",
    weight: 5
  },
  {
    id: "price_value_clarity",
    label: "Price And Value",
    description: "How clearly the website communicates pricing and value.",
    weight: 10
  }
] as const;

export type RankabilityFactorId = (typeof RANKABILITY_FACTORS)[number]["id"];

export type RankabilityFactorDefinition = (typeof RANKABILITY_FACTORS)[number];

export type RankabilityFactorScore = {
  score: number;
  weight: number;
  weightedContribution: number;
  confidence: "high" | "medium" | "low";
  couldVerifySignal: boolean;
  evidence: string;
  sources: string[];
};

export type RankabilityScorecard = {
  model: string;
  scoringProfileId: typeof RANKABILITY_SCORING_PROFILE_ID;
  usesWebSearch: boolean;
  weightedTotalScore: number;
  factorScores: Record<RankabilityFactorId, RankabilityFactorScore>;
  summary: string;
  warnings: string[];
};

export const RANKABILITY_WEIGHTS: Record<RankabilityFactorId, number> = Object.fromEntries(
  RANKABILITY_FACTORS.map((factor) => [factor.id, factor.weight])
) as Record<RankabilityFactorId, number>;
