import OpenAI from "openai";

import type { CategoryModel } from "@/lib/models";
import type { ProjectScanRun } from "@/lib/scan/types";
import {
  DISCOVERABILITY_FACTORS,
  DISCOVERABILITY_PROMPT_COUNT,
  DISCOVERABILITY_SCORING_PROFILE_ID,
  DISCOVERABILITY_TOP_N,
  DISCOVERABILITY_WEIGHTS,
  type AggregatedCandidate,
  type DiscoverabilitySourceCoverage,
  type DiscoverabilityFactorId,
  type DiscoverabilityFactorScore,
  type DiscoverabilityScorecard,
  type DiscoveryCandidate,
  type DiscoveryRun,
  type DiscoverySourceOpportunity,
  type DiscoverySource,
  type DiscoverySourceType,
  type SourceFrequencySummary,
  type TargetDiscoveryResult
} from "@/lib/discoverability/types";

const DEFAULT_MODEL = process.env.SITEINTENT_DISCOVERABILITY_MODEL || "gpt-5-mini";
const FALLBACK_MODEL = "gpt-5.4-mini";
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

const PROMPT_VARIATIONS = [
  "What are the top 10 {category} websites or providers for {context}?",
  "Recommend the top 10 {category} websites or providers for {context}.",
  "Which 10 {category} websites or providers would you shortlist for {context}?",
  "Give me the top 10 {category} websites or providers for {context}.",
  "If you had to choose 10 {category} websites or providers for {context}, which would you include?"
];

type ScoreDiscoverabilityInput = {
  scan: ProjectScanRun;
  categoryModel: CategoryModel;
};

type RawSource = {
  source_name?: unknown;
  source_domain?: unknown;
  source_type?: unknown;
  source_url?: unknown;
  influence?: unknown;
  evidence_found?: unknown;
};

type RawCandidate = {
  rank?: unknown;
  name?: unknown;
  website?: unknown;
  reason_included?: unknown;
  discovery_sources?: unknown;
};

type RawRunPayload = {
  category?: unknown;
  context?: unknown;
  top_candidates?: unknown;
  target_website?: {
    appeared?: unknown;
    rank?: unknown;
    reason_found_or_missed?: unknown;
    entity_match_clarity_score?: unknown;
    supporting_sources?: unknown;
  };
  common_sources?: unknown;
  summary?: unknown;
  warnings?: unknown;
};

type RawSourceOpportunity = {
  source_name?: unknown;
  source_domain?: unknown;
  source_type?: unknown;
  influence?: unknown;
  why_it_matters?: unknown;
  target_present?: unknown;
  target_evidence?: unknown;
  competitor_evidence?: unknown;
  competitor_count?: unknown;
  recommended_action?: unknown;
};

type RawSourceAuditPayload = {
  category?: unknown;
  source_opportunities?: unknown;
  summary?: unknown;
  warnings?: unknown;
};

const DISCOVERABILITY_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["category", "context", "top_candidates", "target_website", "common_sources", "summary", "warnings"],
  properties: {
    category: { type: "string" },
    context: { type: "string" },
    top_candidates: {
      type: "array",
      minItems: DISCOVERABILITY_TOP_N,
      maxItems: DISCOVERABILITY_TOP_N,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rank", "name", "website", "reason_included", "discovery_sources"],
        properties: {
          rank: { type: "integer", minimum: 1, maximum: DISCOVERABILITY_TOP_N },
          name: { type: "string" },
          website: { type: "string" },
          reason_included: { type: "string" },
          discovery_sources: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["source_name", "source_domain", "source_type", "source_url", "influence", "evidence_found"],
              properties: {
                source_name: { type: "string" },
                source_domain: { type: "string" },
                source_type: { type: "string" },
                source_url: { type: "string" },
                influence: { type: "string", enum: ["high", "medium", "low"] },
                evidence_found: { type: "string" }
              }
            }
          }
        }
      }
    },
    target_website: {
      type: "object",
      additionalProperties: false,
      required: ["appeared", "rank", "reason_found_or_missed", "entity_match_clarity_score", "supporting_sources"],
      properties: {
        appeared: { type: "boolean" },
        rank: { anyOf: [{ type: "integer", minimum: 1, maximum: DISCOVERABILITY_TOP_N }, { type: "null" }] },
        reason_found_or_missed: { type: "string" },
        entity_match_clarity_score: { type: "number", minimum: 0, maximum: 100 },
        supporting_sources: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["source_name", "source_domain", "source_type", "source_url", "influence", "evidence_found"],
            properties: {
              source_name: { type: "string" },
              source_domain: { type: "string" },
              source_type: { type: "string" },
              source_url: { type: "string" },
              influence: { type: "string", enum: ["high", "medium", "low"] },
              evidence_found: { type: "string" }
            }
          }
        }
      }
    },
    common_sources: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source_name", "source_domain", "source_type", "source_url", "influence", "evidence_found"],
        properties: {
          source_name: { type: "string" },
          source_domain: { type: "string" },
          source_type: { type: "string" },
          source_url: { type: "string" },
          influence: { type: "string", enum: ["high", "medium", "low"] },
          evidence_found: { type: "string" }
        }
      }
    },
    summary: { type: "string" },
    warnings: {
      type: "array",
      items: { type: "string" },
      maxItems: 8
    }
  }
};

const SOURCE_AUDIT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["category", "source_opportunities", "summary", "warnings"],
  properties: {
    category: { type: "string" },
    source_opportunities: {
      type: "array",
      minItems: 5,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "source_name",
          "source_domain",
          "source_type",
          "influence",
          "why_it_matters",
          "target_present",
          "target_evidence",
          "competitor_evidence",
          "competitor_count",
          "recommended_action"
        ],
        properties: {
          source_name: { type: "string" },
          source_domain: { type: "string" },
          source_type: { type: "string" },
          influence: { type: "string", enum: ["high", "medium", "low"] },
          why_it_matters: { type: "string" },
          target_present: { type: "boolean" },
          target_evidence: { type: "string" },
          competitor_evidence: {
            type: "array",
            items: { type: "string" },
            maxItems: 10
          },
          competitor_count: { type: "integer", minimum: 0, maximum: DISCOVERABILITY_TOP_N },
          recommended_action: { type: "string" }
        }
      }
    },
    summary: { type: "string" },
    warnings: {
      type: "array",
      items: { type: "string" },
      maxItems: 8
    }
  }
};

export async function scoreDiscoverability(input: ScoreDiscoverabilityInput): Promise<{
  scorecard: DiscoverabilityScorecard | null;
  error: string | null;
}> {
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    return {
      scorecard: null,
      error: "OPENAI_API_KEY is required for Discoverability scoring."
    };
  }

  try {
    const client = new OpenAI({ apiKey: openAiApiKey });
    const runs: DiscoveryRun[] = [];
    const warnings: string[] = [];

    for (let index = 0; index < PROMPT_VARIATIONS.length; index++) {
      const question = formatQuestion(PROMPT_VARIATIONS[index], input.categoryModel);
      const response = await createResponseWithModelFallback(client, {
        model: DEFAULT_MODEL,
        input: [
          {
            role: "system",
            content: [
              "You are evaluating website discoverability for AI recommendations.",
              "Use web search for current evidence.",
              "Return only JSON matching the provided schema.",
              "Do not invent websites or URLs.",
              "Use official provider websites where possible.",
              "Assess the target website honestly. Do not include it unless it genuinely belongs in the top candidates."
            ].join(" ")
          },
          {
            role: "user",
            content: buildDiscoverabilityPrompt(question, input.scan, input.categoryModel)
          }
        ],
        tools: [WEB_SEARCH_TOOL],
        tool_choice: "required",
        text: {
          format: {
            type: "json_schema",
            name: "siteintent_discoverability_score",
            strict: true,
            schema: DISCOVERABILITY_RESPONSE_SCHEMA
          }
        }
      });

      const payload = parseResponseJson(response);
      const run = normalizeDiscoveryRun(payload, {
        promptVariation: index + 1,
        question,
        usesWebSearch: containsWebSearchCall(response),
        rawResponse: response
      });
      warnings.push(...run.warnings);
      runs.push(run);
    }

    const sourceCoverage = await auditDiscoverySources(client, runs, input.scan, input.categoryModel);
    warnings.push(...sourceCoverage.warnings);
    const scorecard = buildDiscoverabilityScorecard(runs, input.scan, input.categoryModel, warnings, sourceCoverage.coverage);
    return {
      scorecard,
      error: null
    };
  } catch (error) {
    return {
      scorecard: null,
      error: error instanceof Error ? error.message : "Unable to score website discoverability."
    };
  }
}

async function createResponseWithModelFallback(client: OpenAI, request: OpenAI.Responses.ResponseCreateParamsNonStreaming) {
  try {
    return await client.responses.create(request);
  } catch (error) {
    if (isModelNotFound(error) && request.model !== FALLBACK_MODEL) {
      return client.responses.create({
        ...request,
        model: FALLBACK_MODEL
      });
    }
    throw error;
  }
}

export function normalizeDiscoverabilityScorecard(value: unknown): DiscoverabilityScorecard | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Partial<DiscoverabilityScorecard>;
  if (!payload.targetWebsite || !payload.factorScores || !Array.isArray(payload.discoveryRuns)) {
    return null;
  }

  try {
    const factorScores = Object.fromEntries(
      DISCOVERABILITY_FACTORS.map((factor) => {
        const current = payload.factorScores?.[factor.id];
        return [
          factor.id,
          {
            score: clampScore(current?.score),
            weight: factor.weight,
            weightedContribution: roundOne(clampScore(current?.score) * (factor.weight / 100)),
            evidence: typeof current?.evidence === "string" ? current.evidence : ""
          }
        ];
      })
    ) as Record<DiscoverabilityFactorId, DiscoverabilityFactorScore>;

    return {
      model: typeof payload.model === "string" ? payload.model : DEFAULT_MODEL,
      scoringProfileId: DISCOVERABILITY_SCORING_PROFILE_ID,
      usesWebSearch: Boolean(payload.usesWebSearch),
      category: typeof payload.category === "string" ? payload.category : "",
      context: typeof payload.context === "string" ? payload.context : "",
      discoverabilityScore: clampScore(payload.discoverabilityScore),
      factorScores,
      discoveryRuns: Array.isArray(payload.discoveryRuns) ? payload.discoveryRuns : [],
      aggregatedCandidates: Array.isArray(payload.aggregatedCandidates) ? payload.aggregatedCandidates : [],
      targetWebsite: payload.targetWebsite as TargetDiscoveryResult,
      commonSources: (payload.commonSources as SourceFrequencySummary) ?? {
        byDomain: [],
        byType: [],
        byInfluence: [],
        sourcesSupportingTarget: [],
        sourcesSupportingCompetitors: []
      },
      sourceCoverage: (payload.sourceCoverage as DiscoverabilitySourceCoverage) ?? {
        coverageScore: 0,
        targetSourceCount: 0,
        sourceTypeCoverageScore: 0,
        highValueSourceCoverageScore: 0,
        targetSourceTypes: [],
        strongestSources: [],
        missingHighValueSources: []
      },
      summary: typeof payload.summary === "string" ? payload.summary : "",
      warnings: Array.isArray(payload.warnings) ? payload.warnings.map((warning) => String(warning)) : []
    };
  } catch {
    return null;
  }
}

function buildDiscoverabilityScorecard(
  runs: DiscoveryRun[],
  scan: ProjectScanRun,
  categoryModel: CategoryModel,
  warnings: string[],
  sourceCoverage: DiscoverabilitySourceCoverage
): DiscoverabilityScorecard {
  const targetDomain = normalizeDomain(scan.websiteUrl);
  const aggregatedCandidates = aggregateCandidates(runs, targetDomain);
  const targetWebsite = buildTargetWebsiteResult(runs, aggregatedCandidates, scan.websiteUrl, targetDomain);
  const commonSources = buildSourceFrequencySummary(runs, targetDomain);
  const factorScores = buildFactorScores(runs, targetWebsite, commonSources, sourceCoverage);
  const discoverabilityScore = roundOne(
    DISCOVERABILITY_FACTORS.reduce((sum, factor) => sum + factorScores[factor.id].weightedContribution, 0)
  );

  const missedEveryRun = !targetWebsite.appeared;
  const combinedWarnings = [...warnings];
  if (missedEveryRun) {
    combinedWarnings.push("Target website did not appear in any discovery run.");
  }

  return {
    model: DEFAULT_MODEL,
    scoringProfileId: DISCOVERABILITY_SCORING_PROFILE_ID,
    usesWebSearch: runs.every((run) => run.usesWebSearch),
    category: categoryModel.category,
    context: buildUserContext(categoryModel),
    discoverabilityScore,
    factorScores,
    discoveryRuns: runs,
    aggregatedCandidates,
    targetWebsite,
    commonSources,
    sourceCoverage,
    summary: buildDiscoverabilitySummary(targetWebsite, commonSources, sourceCoverage),
    warnings: uniqueStrings(combinedWarnings)
  };
}

function buildFactorScores(
  runs: DiscoveryRun[],
  targetWebsite: TargetDiscoveryResult,
  commonSources: SourceFrequencySummary,
  sourceCoverage: DiscoverabilitySourceCoverage
): Record<DiscoverabilityFactorId, DiscoverabilityFactorScore> {
  const appearanceRate = roundOne((targetWebsite.appearanceCount / DISCOVERABILITY_PROMPT_COUNT) * 100);
  const averageDiscoveredRank = targetWebsite.averageRank == null
    ? 0
    : roundOne(((DISCOVERABILITY_TOP_N + 1 - targetWebsite.averageRank) / DISCOVERABILITY_TOP_N) * 100);
  const promptResilience = roundOne((targetWebsite.promptVariationsAppeared.length / DISCOVERABILITY_PROMPT_COUNT) * 100);
  const sourcePathDiversity = roundOne(
    sourceCoverage.targetSourceTypes.length
      ? sourceCoverage.sourceTypeCoverageScore
      : (Math.min(targetWebsite.sourceTypes.length, 5) / 5) * 100
  );
  const thirdPartySourceStrength = roundOne(
    sourceCoverage.highValueSourceCoverageScore > 0
      ? sourceCoverage.highValueSourceCoverageScore
      : computeSourceStrength(commonSources.sourcesSupportingTarget)
  );
  const entityMatchClarity = roundOne(
    average(
      runs.map((run) => clampScore(run.targetAssessment.entityMatchClarityScore))
    )
  );

  const rawScores: Record<DiscoverabilityFactorId, { score: number; evidence: string }> = {
    appearance_rate: {
      score: appearanceRate,
      evidence: `${targetWebsite.appearanceCount} of ${DISCOVERABILITY_PROMPT_COUNT} discovery prompts included the target website.`
    },
    average_discovered_rank: {
      score: averageDiscoveredRank,
      evidence:
        targetWebsite.averageRank == null
          ? "The target website never appeared, so it has no discovered rank."
          : `When discovered, the target website averaged rank ${roundOne(targetWebsite.averageRank)}.`
    },
    prompt_resilience: {
      score: promptResilience,
      evidence: `The target appeared across ${targetWebsite.promptVariationsAppeared.length} distinct prompt variations.`
    },
    source_path_diversity: {
      score: sourcePathDiversity,
      evidence:
        sourceCoverage.targetSourceTypes.length
          ? `The target website was present across ${sourceCoverage.targetSourceTypes.length} important discovery source types, producing a source-path coverage score of ${roundOne(sourceCoverage.sourceTypeCoverageScore)}%.`
          : `Discovery evidence for the target came from ${targetWebsite.sourceTypes.length} source types.`
    },
    third_party_source_strength: {
      score: thirdPartySourceStrength,
      evidence:
        sourceCoverage.strongestSources.length
          ? `High-value source coverage scored ${roundOne(sourceCoverage.highValueSourceCoverageScore)}%, based on ${sourceCoverage.targetSourceCount} supporting source opportunities and ${sourceCoverage.missingHighValueSources.length} missing high-value sources.`
          : `Third-party discoverability strength was derived from ${commonSources.sourcesSupportingTarget.length} supporting sources.`
    },
    entity_match_clarity: {
      score: entityMatchClarity,
      evidence: "Entity match clarity was averaged from the model's target-website assessment across discovery runs."
    }
  };

  return Object.fromEntries(
    DISCOVERABILITY_FACTORS.map((factor) => [
      factor.id,
      {
        score: rawScores[factor.id].score,
        weight: DISCOVERABILITY_WEIGHTS[factor.id],
        weightedContribution: roundOne(rawScores[factor.id].score * (DISCOVERABILITY_WEIGHTS[factor.id] / 100)),
        evidence: rawScores[factor.id].evidence
      }
    ])
  ) as Record<DiscoverabilityFactorId, DiscoverabilityFactorScore>;
}

function aggregateCandidates(runs: DiscoveryRun[], targetDomain: string): AggregatedCandidate[] {
  const byDomain = new Map<string, AggregatedCandidate & { _ranks: number[] }>();

  for (const run of runs) {
    for (const candidate of run.candidates) {
      const domain = normalizeDomain(candidate.website || candidate.name);
      if (!domain) {
        continue;
      }

      const existing = byDomain.get(domain);
      if (existing) {
        existing.appearanceCount += 1;
        existing.supportingPromptVariations.push(run.promptVariation);
        existing._ranks.push(candidate.rank);
        existing.averageRank = average(existing._ranks);
        existing.bestRank = existing.bestRank == null ? candidate.rank : Math.min(existing.bestRank, candidate.rank);
        existing.reasons.push(candidate.reasonIncluded);
        existing.sources.push(...candidate.discoverySources);
      } else {
        byDomain.set(domain, {
          domain,
          name: candidate.name,
          website: candidate.website,
          appearanceCount: 1,
          appearanceRate: 0,
          averageRank: candidate.rank,
          bestRank: candidate.rank,
          supportingPromptVariations: [run.promptVariation],
          reasons: [candidate.reasonIncluded],
          sources: [...candidate.discoverySources],
          isTargetWebsite: domain === targetDomain,
          _ranks: [candidate.rank]
        });
      }
    }
  }

  const candidates = [...byDomain.values()].map((candidate) => {
    const { _ranks, ...rest } = candidate;
    return {
      ...rest,
      appearanceRate: roundOne((candidate.appearanceCount / DISCOVERABILITY_PROMPT_COUNT) * 100),
      averageRank: roundOne(average(_ranks)),
      supportingPromptVariations: uniqueNumbers(candidate.supportingPromptVariations).sort((a, b) => a - b),
      reasons: uniqueStrings(candidate.reasons).slice(0, 10),
      sources: dedupeSources(candidate.sources)
    };
  });

  return candidates.sort((a, b) => {
    if (b.appearanceCount !== a.appearanceCount) {
      return b.appearanceCount - a.appearanceCount;
    }

    return (a.averageRank ?? DISCOVERABILITY_TOP_N + 1) - (b.averageRank ?? DISCOVERABILITY_TOP_N + 1);
  });
}

function buildTargetWebsiteResult(
  runs: DiscoveryRun[],
  aggregatedCandidates: AggregatedCandidate[],
  website: string,
  targetDomain: string
): TargetDiscoveryResult {
  const candidate = aggregatedCandidates.find((item) => item.domain === targetDomain);
  const allSources = dedupeSources(
    runs.flatMap((run) => run.targetAssessment.supportingSources)
  );
  const reasons = uniqueStrings(runs.map((run) => run.targetAssessment.reasonFoundOrMissed).filter(Boolean));

  return {
    website,
    domain: targetDomain,
    appeared: Boolean(candidate),
    appearanceCount: candidate?.appearanceCount ?? 0,
    appearanceRate: candidate?.appearanceRate ?? 0,
    averageRank: candidate?.averageRank ?? null,
    bestRank: candidate?.bestRank ?? null,
    promptVariationsAppeared: candidate?.supportingPromptVariations ?? [],
    reasonsFoundOrMissed: reasons,
    sourceTypes: uniqueStrings(allSources.map((source) => source.sourceType)) as DiscoverySourceType[],
    sources: allSources
  };
}

function buildSourceFrequencySummary(runs: DiscoveryRun[], targetDomain: string): SourceFrequencySummary {
  const targetSources = dedupeSources(runs.flatMap((run) => run.targetAssessment.supportingSources));
  const competitorSources = dedupeSources(
    runs.flatMap((run) =>
      run.candidates
        .filter((candidate) => normalizeDomain(candidate.website) !== targetDomain)
        .flatMap((candidate) => candidate.discoverySources)
    )
  );
  const allSources = dedupeSources([...targetSources, ...competitorSources, ...runs.flatMap((run) => run.commonSources)]);

  return {
    byDomain: countValues(allSources.map((source) => source.sourceDomain || source.sourceName || "unknown")),
    byType: countValues(allSources.map((source) => source.sourceType)) as Array<{ key: DiscoverySourceType; count: number }>,
    byInfluence: countValues(allSources.map((source) => source.influence)) as Array<{
      key: "high" | "medium" | "low";
      count: number;
    }>,
    sourcesSupportingTarget: targetSources,
    sourcesSupportingCompetitors: competitorSources
  };
}

function buildDiscoverabilitySummary(
  targetWebsite: TargetDiscoveryResult,
  commonSources: SourceFrequencySummary,
  sourceCoverage: DiscoverabilitySourceCoverage
) {
  const sourceHint = commonSources.byDomain.slice(0, 3).map((item) => item.key).join(", ") || "no repeated sources";
  if (!targetWebsite.appeared) {
    return `The target website was missed in all discovery runs. The most repeated source paths were ${sourceHint}. Source coverage scored ${roundOne(sourceCoverage.coverageScore)}%.`;
  }

  return `The target website appeared in ${targetWebsite.appearanceCount} of ${DISCOVERABILITY_PROMPT_COUNT} discovery runs with an average discovered rank of ${roundOne(targetWebsite.averageRank ?? 0)}. Repeated source paths included ${sourceHint}. Source coverage scored ${roundOne(sourceCoverage.coverageScore)}%.`;
}

async function auditDiscoverySources(
  client: OpenAI,
  runs: DiscoveryRun[],
  scan: ProjectScanRun,
  categoryModel: CategoryModel
): Promise<{ coverage: DiscoverabilitySourceCoverage; warnings: string[] }> {
  const aggregatedCandidates = aggregateCandidates(runs, normalizeDomain(scan.websiteUrl));
  const competitorContext = aggregatedCandidates
    .filter((candidate) => !candidate.isTargetWebsite)
    .slice(0, 8)
    .map((candidate) => `${candidate.name} - ${candidate.website}`)
    .join("\n");

  try {
    const response = await createResponseWithModelFallback(client, {
      model: DEFAULT_MODEL,
      input: [
        {
          role: "system",
          content: [
            "You are auditing category-level discovery sources for AI recommendations.",
            "Use web search for current evidence.",
            "Return only JSON matching the provided schema.",
            "Focus on external source paths that help AI discover websites in this category.",
            "For each source, state whether the target website appears to be present and which competitors are supported."
          ].join(" ")
        },
        {
          role: "user",
          content: [
            `Category: ${categoryModel.category}`,
            `User context: ${buildUserContext(categoryModel)}`,
            `Target website: ${scan.websiteUrl}`,
            `Target website name: ${scan.projectName}`,
            "",
            "Competitor websites discovered across repeated runs:",
            competitorContext || "No competitor context provided.",
            "",
            "Identify the most valuable source paths for discoverability in this category.",
            "These can include review platforms, Google Business Profile, directories, marketplaces, editorial pages, government registers, forums, or social profiles.",
            "Only include official sites if they are clearly acting as a discovery-supporting source beyond the main homepage."
          ].join("\n")
        }
      ],
      tools: [WEB_SEARCH_TOOL],
      tool_choice: "required",
      text: {
        format: {
          type: "json_schema",
          name: "siteintent_discoverability_source_audit",
          strict: true,
          schema: SOURCE_AUDIT_RESPONSE_SCHEMA
        }
      }
    });

    const payload = parseResponseJson(response) as RawSourceAuditPayload;
    const opportunities = normalizeSourceOpportunities(payload.source_opportunities);
    return {
      coverage: buildSourceCoverage(opportunities),
      warnings: Array.isArray(payload.warnings) ? payload.warnings.map((warning) => String(warning)) : []
    };
  } catch (error) {
    return {
      coverage: buildSourceCoverage([]),
      warnings: [error instanceof Error ? error.message : "Unable to audit discoverability sources."]
    };
  }
}

function normalizeSourceOpportunities(value: unknown): DiscoverySourceOpportunity[] {
  return Array.isArray(value)
    ? value
        .map((item) => normalizeSourceOpportunity(item))
        .filter((item): item is DiscoverySourceOpportunity => Boolean(item))
        .slice(0, 12)
    : [];
}

function normalizeSourceOpportunity(value: unknown): DiscoverySourceOpportunity | null {
  const payload = (value && typeof value === "object" ? value : {}) as RawSourceOpportunity;
  return {
    sourceName: typeof payload.source_name === "string" ? payload.source_name.trim() : "",
    sourceDomain: typeof payload.source_domain === "string" ? payload.source_domain.trim() : "",
    sourceType: normalizeSourceType(payload.source_type),
    influence: normalizeInfluence(payload.influence),
    whyItMatters: typeof payload.why_it_matters === "string" ? payload.why_it_matters.trim() : "",
    targetPresent: Boolean(payload.target_present),
    targetEvidence: typeof payload.target_evidence === "string" ? payload.target_evidence.trim() : "",
    competitorEvidence: Array.isArray(payload.competitor_evidence)
      ? payload.competitor_evidence.map((item) => String(item).trim()).filter(Boolean).slice(0, 10)
      : [],
    competitorCount: Math.min(DISCOVERABILITY_TOP_N, Math.max(0, Number.parseInt(String(payload.competitor_count ?? "0"), 10) || 0)),
    recommendedAction: typeof payload.recommended_action === "string" ? payload.recommended_action.trim() : ""
  };
}

function buildSourceCoverage(opportunities: DiscoverySourceOpportunity[]): DiscoverabilitySourceCoverage {
  const strongestSources = [...opportunities].sort((a, b) => sourceOpportunityScore(b) - sourceOpportunityScore(a));
  const targetPresentSources = strongestSources.filter((source) => source.targetPresent);
  const missingHighValueSources = strongestSources.filter((source) => !source.targetPresent && source.competitorCount > 0).slice(0, 6);
  const targetSourceTypes = uniqueStrings(targetPresentSources.map((source) => source.sourceType)) as DiscoverySourceType[];
  const sourceTypeCoverageScore = roundOne((Math.min(targetSourceTypes.length, 5) / 5) * 100);
  const totalPossibleWeight = strongestSources.reduce((sum, source) => sum + sourceOpportunityWeight(source), 0);
  const capturedWeight = targetPresentSources.reduce((sum, source) => sum + sourceOpportunityWeight(source), 0);
  const highValueSourceCoverageScore = totalPossibleWeight === 0 ? 0 : roundOne((capturedWeight / totalPossibleWeight) * 100);

  return {
    coverageScore: roundOne(sourceTypeCoverageScore * 0.35 + highValueSourceCoverageScore * 0.65),
    targetSourceCount: targetPresentSources.length,
    sourceTypeCoverageScore,
    highValueSourceCoverageScore,
    targetSourceTypes,
    strongestSources: strongestSources.slice(0, 8),
    missingHighValueSources
  };
}

function sourceOpportunityScore(source: DiscoverySourceOpportunity) {
  return sourceOpportunityWeight(source) + source.competitorCount * 2 + (source.targetPresent ? 5 : 0);
}

function sourceOpportunityWeight(source: DiscoverySourceOpportunity) {
  const influenceWeight = source.influence === "high" ? 1 : source.influence === "medium" ? 0.7 : 0.45;
  return influenceWeight * getSourceTypeWeight(source.sourceType) * 100;
}

function normalizeDiscoveryRun(
  value: unknown,
  options: { promptVariation: number; question: string; usesWebSearch: boolean; rawResponse: unknown }
): DiscoveryRun {
  const payload = (value && typeof value === "object" ? value : {}) as RawRunPayload;
  const candidates = Array.isArray(payload.top_candidates)
    ? payload.top_candidates.map((candidate, index) => normalizeCandidate(candidate, index + 1)).slice(0, DISCOVERABILITY_TOP_N)
    : [];
  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings.map((warning) => String(warning).trim()).filter(Boolean)
    : [];

  return {
    promptVariation: options.promptVariation,
    question: options.question,
    usesWebSearch: options.usesWebSearch,
    candidates,
    targetAssessment: {
      appeared: Boolean(payload.target_website?.appeared),
      rank: normalizeNullableRank(payload.target_website?.rank),
      reasonFoundOrMissed: typeof payload.target_website?.reason_found_or_missed === "string" ? payload.target_website.reason_found_or_missed.trim() : "",
      entityMatchClarityScore: clampScore(payload.target_website?.entity_match_clarity_score),
      supportingSources: normalizeSources(payload.target_website?.supporting_sources)
    },
    commonSources: normalizeSources(payload.common_sources),
    rawResponse: options.rawResponse,
    warnings
  };
}

function normalizeCandidate(value: unknown, fallbackRank: number): DiscoveryCandidate {
  const payload = (value && typeof value === "object" ? value : {}) as RawCandidate;
  return {
    rank: normalizeRank(payload.rank, fallbackRank),
    name: typeof payload.name === "string" ? payload.name.trim() : "",
    website: typeof payload.website === "string" ? payload.website.trim() : "",
    reasonIncluded: typeof payload.reason_included === "string" ? payload.reason_included.trim() : "",
    discoverySources: normalizeSources(payload.discovery_sources)
  };
}

function normalizeSources(value: unknown): DiscoverySource[] {
  return Array.isArray(value)
    ? value
        .map((item) => normalizeSource(item))
        .filter((item): item is DiscoverySource => Boolean(item))
        .slice(0, 20)
    : [];
}

function normalizeSource(value: unknown): DiscoverySource | null {
  const payload = (value && typeof value === "object" ? value : {}) as RawSource;
  const sourceType = normalizeSourceType(payload.source_type);

  return {
    sourceName: typeof payload.source_name === "string" ? payload.source_name.trim() : "",
    sourceDomain: typeof payload.source_domain === "string" ? payload.source_domain.trim() : "",
    sourceType,
    sourceUrl: typeof payload.source_url === "string" ? payload.source_url.trim() : "",
    influence: normalizeInfluence(payload.influence),
    evidenceFound: typeof payload.evidence_found === "string" ? payload.evidence_found.trim() : ""
  };
}

function buildDiscoverabilityPrompt(question: string, scan: ProjectScanRun, categoryModel: CategoryModel) {
  const homepage = scan.websiteScanPages.find((page) => page.pageType === "homepage");
  const homepageSummary = homepage
    ? [
        `Homepage title: ${homepage.pageTitle || "n/a"}`,
        `Homepage meta title: ${homepage.metaTitle || "n/a"}`,
        `Homepage H1: ${homepage.h1 || "n/a"}`,
        `Homepage headings: ${homepage.headings.slice(0, 5).map((heading) => heading.text).join(" | ") || "n/a"}`
      ].join("\n")
    : "No homepage summary available.";

  return [
    `Question: ${question}`,
    `Target website URL: ${scan.websiteUrl}`,
    `Target website name: ${scan.projectName}`,
    "",
    "Return the top candidates and explain which sources led to each inclusion.",
    "Prefer official provider websites rather than listicles or directory pages in the top candidates.",
    "Also assess the target website even if it does not appear in the top candidates.",
    "",
    "Target website context",
    homepageSummary,
    `Category: ${categoryModel.category}`,
    `User context: ${buildUserContext(categoryModel)}`,
    `Customer: ${categoryModel.customer}`,
    `Problem: ${categoryModel.problem}`,
    `Expected concepts: ${categoryModel.expectedConcepts.slice(0, 8).join(", ") || "none"}`
  ].join("\n");
}

function buildUserContext(categoryModel: CategoryModel) {
  return `${categoryModel.customer} looking for ${categoryModel.category} options in Australia`;
}

function formatQuestion(template: string, categoryModel: CategoryModel) {
  return template
    .replaceAll("{category}", categoryModel.category.toLowerCase())
    .replaceAll("{context}", buildUserContext(categoryModel));
}

function parseResponseJson(response: { output_text?: string; output?: unknown[] }) {
  const text = response.output_text || extractTextFromOutput(response.output);
  if (!text) {
    throw new Error("OpenAI response did not include output text.");
  }

  return JSON.parse(stripJsonFence(text));
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

function stripJsonFence(value: string) {
  return value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
}

function containsWebSearchCall(response: { output?: unknown[] }) {
  return Array.isArray(response.output)
    ? response.output.some((item) => item && typeof item === "object" && (item as { type?: string }).type === "web_search_call")
    : false;
}

function normalizeRank(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(DISCOVERABILITY_TOP_N, Math.max(1, numeric));
}

function normalizeNullableRank(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  return normalizeRank(value, DISCOVERABILITY_TOP_N);
}

function normalizeSourceType(value: unknown): DiscoverySourceType {
  const normalized = String(value ?? "").trim() as DiscoverySourceType;
  switch (normalized) {
    case "official_site":
    case "review_platform":
    case "google_business_profile":
    case "industry_directory":
    case "editorial_media":
    case "government_register":
    case "marketplace":
    case "forum":
    case "social":
      return normalized;
    default:
      return "unknown";
  }
}

function normalizeInfluence(value: unknown): "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function clampScore(value: unknown) {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return roundOne(Math.min(100, Math.max(0, numeric)));
}

function normalizeDomain(value: string) {
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return value.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

function computeSourceStrength(sources: DiscoverySource[]) {
  if (!sources.length) {
    return 0;
  }

  return average(
    sources.map((source) => {
      const influenceWeight = source.influence === "high" ? 1 : source.influence === "medium" ? 0.7 : 0.45;
      const typeWeight = getSourceTypeWeight(source.sourceType);
      return influenceWeight * typeWeight * 100;
    })
  );
}

function getSourceTypeWeight(sourceType: DiscoverySourceType) {
  switch (sourceType) {
    case "review_platform":
    case "google_business_profile":
    case "government_register":
      return 1;
    case "editorial_media":
      return 0.95;
    case "industry_directory":
      return 0.9;
    case "marketplace":
      return 0.85;
    case "official_site":
      return 0.75;
    case "forum":
      return 0.65;
    case "social":
      return 0.5;
    default:
      return 0.45;
  }
}

function dedupeSources(sources: DiscoverySource[]) {
  const seen = new Set<string>();
  const result: DiscoverySource[] = [];
  for (const source of sources) {
    const key = [
      source.sourceDomain,
      source.sourceUrl,
      source.sourceType,
      source.influence,
      source.evidenceFound
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(source);
  }
  return result;
}

function countValues<T extends string>(values: T[]) {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values)];
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function isModelNotFound(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "model_not_found"
  );
}
