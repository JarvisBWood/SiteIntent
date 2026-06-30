import type { ObservedIntent, PageScanRecord, ProjectScanRun, SiteIntentProject } from "@/lib/site-state";
import type { RankabilityScorecard } from "@/lib/scoring/types";

export type CompetitorAnalysis = {
  url: string;
  audience: string;
  outcomes: string[];
  positioning: string;
  differentiators: string[];
  intentScore: number;
  intentAlignment: number;
};

export type CategoryModel = {
  category: string;
  customer: string;
  problem: string;
  expectedConcepts: string[];
  expectedOutcomes: string[];
  sharedSignals: string[];
  updatedAt: string;
};

export type TargetIntentModel = {
  category: string;
  lockedConcepts: string[];
  removableConcepts: string[];
  addableConcepts: string[];
  notes: string;
  updatedAt: string;
  isUserOwned?: boolean;
};

const CATEGORY_STOPWORDS = new Set([
  "about",
  "analysis",
  "and",
  "best",
  "blog",
  "book",
  "case",
  "clear",
  "content",
  "customer",
  "dashboard",
  "demo",
  "expected",
  "guide",
  "homepage",
  "insights",
  "intent",
  "learn",
  "local",
  "model",
  "more",
  "overview",
  "page",
  "pages",
  "product",
  "recommendations",
  "scan",
  "site",
  "support",
  "target",
  "understanding",
  "value",
  "website"
]);

const DIFFERENTIATOR_WORDS = new Set([
  "llms",
  "llm",
  "ollama",
  "local-first",
  "local",
  "automation",
  "fast",
  "premium",
  "confident",
  "unique",
  "differentiator",
  "differentiated",
  "pricing"
]);

export function buildCompetitorAnalyses(competitorUrls: string[]): CompetitorAnalysis[] {
  return competitorUrls.map((url, index) => {
    const parsed = safeUrl(url);
    const host = parsed?.hostname.replace(/^www\./i, "") ?? url;
    const path = parsed?.pathname.replace(/\//g, " ").trim() ?? "";
    const basis = [host, path].filter(Boolean).join(" ").toLowerCase();
    const role = inferAudienceFromText(basis, index);
    const outcomes = inferOutcomesFromText(basis);
    const differentiators = inferDifferentiatorsFromText(basis, host);
    const intentScore = inferCompetitorIntentScore(basis, outcomes, differentiators, index);
    const intentAlignment = inferCompetitorAlignmentScore(basis, outcomes, differentiators, index);

    return {
      url,
      audience: role,
      outcomes,
      positioning: buildPositioningStatement(host, path, outcomes),
      differentiators,
      intentScore,
      intentAlignment
    };
  });
}

export function buildCompetitorAnalysisFromPage(page: PageScanRecord): CompetitorAnalysis {
  const basis = [
    page.merged.intent,
    page.merged.audience,
    page.merged.product,
    page.pageTitle,
    page.metaTitle,
    page.metaDescription,
    ...page.headings.map((heading) => heading.text)
  ]
    .join(" ")
    .toLowerCase();
  const outcomes = uniqueStrings([
    page.merged.intent,
    ...page.merged.supporting_signals
  ]).slice(0, 4);
  const differentiators = uniqueStrings([
    ...page.merged.supporting_signals,
    ...page.headings.map((heading) => heading.text)
  ]).slice(0, 4);

  return {
    url: page.url,
    audience: page.merged.audience,
    outcomes,
    positioning: page.merged.product || page.merged.intent || page.pageTitle || page.url,
    differentiators,
    intentScore: inferCompetitorIntentScore(basis, outcomes, differentiators, 0),
    intentAlignment: inferCompetitorAlignmentScore(basis, outcomes, differentiators, 0)
  };
}

export function buildCategoryModel(input: {
  project: SiteIntentProject;
  latestScan: ProjectScanRun | null;
  competitorAnalyses: CompetitorAnalysis[];
}): CategoryModel {
  const pages = input.latestScan?.pages ?? [];
  const pageSignals = pages.flatMap((page) => [
    page.merged.intent,
    page.merged.audience,
    page.merged.product,
    page.pageTitle,
    page.metaTitle,
    page.metaDescription,
    ...page.headings.map((heading) => heading.text)
  ]);

  const competitorSignals = input.competitorAnalyses.flatMap((competitor) => [
    competitor.audience,
    competitor.positioning,
    ...competitor.outcomes
  ]);

  const signalText = [...pageSignals, ...competitorSignals].join(" ").toLowerCase();
  const category = inferCategory(signalText, input.project.name);
  const customer = inferCustomer(signalText);
  const problem = inferProblem(signalText);
  const expectedConcepts = extractConcepts(signalText, [
    ...pages.flatMap((page) => [page.merged.intent, page.merged.product, ...page.headings.map((heading) => heading.text)]),
    ...competitorSignals
  ]);
  const expectedOutcomes = extractOutcomes(signalText);
  const sharedSignals = pages
    .flatMap((page) => page.merged.supporting_signals)
    .concat(input.competitorAnalyses.flatMap((analysis) => analysis.outcomes))
    .slice(0, 12);

  return {
    category,
    customer,
    problem,
    expectedConcepts,
    expectedOutcomes,
    sharedSignals,
    updatedAt: new Date().toISOString()
  };
}

export function createDefaultTargetIntentModel(category: CategoryModel): TargetIntentModel {
  return {
    category: category.category,
    lockedConcepts: category.expectedConcepts.slice(0, 4),
    removableConcepts: category.expectedConcepts.slice(4, 7),
    addableConcepts: [
      category.customer,
      category.problem,
      ...category.expectedOutcomes.slice(0, 2)
    ].filter(Boolean),
    notes: "Use this target to keep the site focused on the category, customer, and outcome the product should own.",
    updatedAt: new Date().toISOString(),
    isUserOwned: false
  };
}

export function buildObservedIntent(input: {
  categoryModel: CategoryModel;
  latestScan: ProjectScanRun | null;
  competitorAnalyses: CompetitorAnalysis[];
  metrics: RankabilityScorecard | null;
}): ObservedIntent {
  const { categoryModel, latestScan, competitorAnalyses, metrics } = input;
  const homepage = latestScan?.pages.find((page) => page.pageType === "homepage") ?? latestScan?.pages[0] ?? null;
  const pageSignalText = latestScan?.pages
    .flatMap((page) => [
      page.pageTitle,
      page.metaTitle,
      page.metaDescription,
      ...page.headings.map((heading) => heading.text),
      page.merged.intent,
      page.merged.audience,
      page.merged.product,
      ...page.merged.supporting_signals
    ])
    .join(" ")
    .toLowerCase() ?? "";
  const audience = inferObservedAudience(pageSignalText, categoryModel, homepage, competitorAnalyses);
  const problem = inferObservedProblems(pageSignalText, categoryModel, homepage);
  const outcome = inferObservedOutcomes(pageSignalText, categoryModel, homepage, competitorAnalyses);
  const topic = inferObservedTopic(pageSignalText, categoryModel, homepage);

  return {
    topic,
    audience,
    problem,
    outcome,
    confidence: {
      score: metrics ? averagePrimaryScore(metrics) : fallbackObservedConfidence(latestScan),
      reason: buildObservedConfidenceReason(latestScan, metrics)
    },
    updatedAt: new Date().toISOString()
  };
}

export function createTargetIntentModelFromObservedIntent(observedIntent: ObservedIntent): TargetIntentModel {
  return {
    category: observedIntent.topic,
    lockedConcepts: uniqueStrings([
      observedIntent.topic,
      ...observedIntent.audience,
      ...observedIntent.problem,
      ...observedIntent.outcome
    ]),
    removableConcepts: [],
    addableConcepts: [],
    notes: "Locked from the initial observed intent review.",
    updatedAt: new Date().toISOString(),
    isUserOwned: true
  };
}

export function summarizeConceptDelta(categoryModel: CategoryModel, targetIntentModel: TargetIntentModel) {
  return {
    aligned: intersect(categoryModel.expectedConcepts, targetIntentModel.lockedConcepts),
    missing: difference(categoryModel.expectedConcepts, targetIntentModel.lockedConcepts),
    removable: targetIntentModel.removableConcepts,
    addable: targetIntentModel.addableConcepts
  };
}

function inferCategory(signalText: string, projectName: string) {
  const detected = detectCategoryFromSignals(signalText);
  if (detected) {
    return detected;
  }
  if (matchesEducationReportSignals(signalText)) {
    return "AI school report writing software";
  }
  if (signalText.includes("positioning") || signalText.includes("understanding")) {
    return "Website understanding and positioning analysis";
  }
  if (signalText.includes("recommendation")) {
    return "Actionable website analysis";
  }
  return `${projectName} positioning analysis`;
}

function inferCustomer(signalText: string) {
  if (matchesVisitorManagementSignals(signalText)) {
    return "Workplaces and operations teams managing visitors, contractors, and on-site safety";
  }
  if (matchesAccountingSoftwareSignals(signalText)) {
    return "Businesses, accountants, and finance teams";
  }
  if (matchesEducationReportSignals(signalText)) {
    if (signalText.includes("school")) {
      return "Teachers and schools";
    }
    return "Teachers";
  }
  if (signalText.includes("team")) {
    return "Marketing and product teams";
  }
  if (signalText.includes("founder")) {
    return "Founders and small teams";
  }
  return "Teams that need clearer website positioning";
}

function inferProblem(signalText: string) {
  if (matchesVisitorManagementSignals(signalText)) {
    return "Managing visitors, contractors, employee notifications, and evacuation visibility manually is slow and risky.";
  }
  if (matchesAccountingSoftwareSignals(signalText)) {
    return "Managing bookkeeping, invoicing, payroll, and compliance manually takes too much time and creates reporting risk.";
  }
  if (matchesEducationReportSignals(signalText)) {
    return "Writing personalised student reports and report comments takes too much teacher time.";
  }
  if (signalText.includes("clarity") || signalText.includes("understanding")) {
    return "The website is not clearly communicating what it does and who it is for.";
  }
  return "The market cannot quickly understand the site’s promise and value.";
}

function inferAudienceFromText(text: string, index: number) {
  if (matchesVisitorManagementSignals(text)) {
    return index === 0 ? "Operations and workplace teams" : "Workplaces managing visitors and contractors";
  }
  if (matchesAccountingSoftwareSignals(text)) {
    return index === 0 ? "Business and finance teams" : "Businesses comparing accounting platforms";
  }
  if (matchesEducationReportSignals(text)) {
    return index === 0 ? "Teachers" : "Schools";
  }
  if (text.includes("enterprise")) {
    return "Enterprise buyers";
  }
  if (text.includes("developer") || text.includes("docs")) {
    return "Technical users";
  }
  if (text.includes("marketing")) {
    return "Marketing teams";
  }
  return index === 0 ? "Comparable category leaders" : "Category alternatives";
}

function inferOutcomesFromText(text: string) {
  const outcomes = new Set<string>();
  if (matchesEducationReportSignals(text)) outcomes.add("Write school reports faster");
  if (matchesVisitorManagementSignals(text)) outcomes.add("Manage visitors and contractors safely");
  if (matchesVisitorManagementSignals(text) && text.includes("evacuation")) outcomes.add("Improve on-site emergency visibility");
  if (matchesAccountingSoftwareSignals(text)) outcomes.add("Manage bookkeeping and compliance faster");
  if (text.includes("teacher")) outcomes.add("Reduce teacher admin time");
  if (text.includes("comment")) outcomes.add("Generate personalised report comments");
  if (text.includes("clarity")) outcomes.add("Increase clarity");
  if (text.includes("speed")) outcomes.add("Move faster");
  if (text.includes("revenue") || text.includes("convert")) outcomes.add("Improve conversions");
  if (text.includes("automation")) outcomes.add("Reduce manual work");
  if (text.includes("analysis")) outcomes.add("Understand the site");
  return [...outcomes].slice(0, 4);
}

function buildPositioningStatement(host: string, path: string, outcomes: string[]) {
  const suffix = path ? ` via ${path}` : "";
  const outcomeCopy = outcomes.length ? ` to ${outcomes[0].toLowerCase()}` : "";
  return `${host}${suffix}${outcomeCopy}`.trim();
}

function inferDifferentiatorsFromText(text: string, host: string) {
  const matches = new Set<string>();
  if (text.includes("ai")) matches.add("AI-led workflow");
  if (text.includes("local")) matches.add("Local execution");
  if (text.includes("free")) matches.add("Free access");
  if (text.includes("enterprise")) matches.add("Enterprise readiness");
  if (matchesVisitorManagementSignals(text)) matches.add("Visitor and contractor workflows");
  if (matchesAccountingSoftwareSignals(text)) matches.add("Finance and compliance workflows");
  if (host.includes("app")) matches.add("Product-led dashboard");
  return [...matches].slice(0, 4);
}

function inferCompetitorIntentScore(text: string, outcomes: string[], differentiators: string[], index: number) {
  const signalCount = new Set([
    ...tokenize(text),
    ...outcomes.flatMap((value) => tokenize(value)),
    ...differentiators.flatMap((value) => tokenize(value))
  ]).size;

  return clamp(0.42 + Math.min(signalCount / 28, 0.34) + Math.max(0, 0.08 - index * 0.03), 0, 1);
}

function inferCompetitorAlignmentScore(text: string, outcomes: string[], differentiators: string[], index: number) {
  const alignmentSignals = [
    text.includes("analysis") ? 0.12 : 0,
    text.includes("intent") ? 0.12 : 0,
    text.includes("positioning") ? 0.1 : 0,
    outcomes.length ? 0.08 : 0,
    differentiators.length ? 0.08 : 0,
    text.includes("dashboard") ? 0.06 : 0
  ];

  return clamp(0.38 + alignmentSignals.reduce((sum, value) => sum + value, 0) - index * 0.025, 0, 1);
}

function extractConcepts(signalText: string, sourceTexts: string[]) {
  const counts = new Map<string, number>();
  for (const text of sourceTexts) {
    for (const token of tokenize(text)) {
      if (CATEGORY_STOPWORDS.has(token) || DIFFERENTIATOR_WORDS.has(token) || token.length < 4) {
        continue;
      }
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([word]) => signalText.includes(word))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([word]) => word);
}

function extractOutcomes(signalText: string) {
  const outcomes = new Set<string>();
  if (matchesEducationReportSignals(signalText)) outcomes.add("Generate school reports faster");
  if (matchesVisitorManagementSignals(signalText)) outcomes.add("Manage visitors and contractors digitally");
  if (matchesVisitorManagementSignals(signalText) && signalText.includes("evacuation")) outcomes.add("Improve evacuation and on-site safety visibility");
  if (matchesAccountingSoftwareSignals(signalText)) outcomes.add("Manage accounting, payroll, and compliance in one system");
  if (signalText.includes("teacher")) outcomes.add("Reduce teacher admin time");
  if (signalText.includes("comment") || signalText.includes("feedback")) outcomes.add("Create personalised student feedback");
  if (signalText.includes("clarity")) outcomes.add("Improve clarity");
  if (signalText.includes("alignment")) outcomes.add("Increase alignment");
  if (signalText.includes("confidence")) outcomes.add("Raise understanding confidence");
  if (signalText.includes("recommendation")) outcomes.add("Create actionable recommendations");
  if (signalText.includes("compare")) outcomes.add("Compare positioning");
  if (signalText.includes("scan")) outcomes.add("Scan the site");
  return [...outcomes].slice(0, 5);
}

function similarity(left: string, right: string) {
  const a = normalizeToken(left);
  const b = normalizeToken(right);
  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  const leftTokens = new Set(a.split(/\s+/));
  const rightTokens = new Set(b.split(/\s+/));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const total = new Set([...leftTokens, ...rightTokens]).size;
  return total ? shared / total : 0;
}

function intersect(left: string[], right: string[]) {
  const rightSet = new Set(right.map(normalizeToken));
  return left.filter((item) => rightSet.has(normalizeToken(item)));
}

function difference(left: string[], right: string[]) {
  const rightSet = new Set(right.map(normalizeToken));
  return left.filter((item) => !rightSet.has(normalizeToken(item)));
}

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value: string) {
  return normalizeToken(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function inferObservedTopic(signalText: string, categoryModel: CategoryModel, homepage: ProjectScanRun["pages"][number] | null) {
  if (matchesEducationReportSignals(signalText)) {
    return "AI school report writing software";
  }

  const detected = detectCategoryFromSignals(signalText);
  if (detected) {
    return detected;
  }

  return homepage?.merged.product || categoryModel.category;
}

function inferObservedAudience(
  signalText: string,
  categoryModel: CategoryModel,
  homepage: ProjectScanRun["pages"][number] | null,
  competitorAnalyses: CompetitorAnalysis[]
) {
  if (matchesEducationReportSignals(signalText)) {
    return uniqueStrings(["Teachers", signalText.includes("school") ? "Schools" : "", signalText.includes("department of education") ? "School leaders" : ""]).slice(0, 4);
  }

  return uniqueStrings([
    homepage?.merged.audience ?? "",
    categoryModel.customer,
    ...competitorAnalyses.map((analysis) => analysis.audience)
  ]).slice(0, 4);
}

function inferObservedProblems(signalText: string, categoryModel: CategoryModel, homepage: ProjectScanRun["pages"][number] | null) {
  if (matchesEducationReportSignals(signalText)) {
    return [
      "Writing student reports takes too much time.",
      "Creating personalised report comments is repetitive.",
      "Teachers need feedback that still sounds like their own style."
    ];
  }

  return uniqueStrings([categoryModel.problem, homepage?.merged.intent ?? ""]).slice(0, 4);
}

function inferObservedOutcomes(
  signalText: string,
  categoryModel: CategoryModel,
  homepage: ProjectScanRun["pages"][number] | null,
  competitorAnalyses: CompetitorAnalysis[]
) {
  if (matchesEducationReportSignals(signalText)) {
    return [
      "Generate personalised school reports faster.",
      "Reduce teacher administration time.",
      "Create accurate student comments aligned to report-writing guidelines."
    ];
  }

  return uniqueStrings([
    ...categoryModel.expectedOutcomes,
    homepage?.merged.intent ?? "",
    ...competitorAnalyses.flatMap((analysis) => analysis.outcomes)
  ]).slice(0, 5);
}

function buildObservedConfidenceReason(latestScan: ProjectScanRun | null, metrics: RankabilityScorecard | null) {
  const analyzedPages = latestScan?.analyzedPages ?? 0;
  const stablePages = latestScan?.pages.filter((page) => page.mergeDecision === "stable").length ?? 0;
  if (!metrics) {
    return `Derived from ${analyzedPages} analyzed pages and ${stablePages} stable page interpretations.`;
  }

  return `Derived from ${analyzedPages} analyzed pages, ${stablePages} stable page interpretations, and a ${metrics.weightedTotalScore}% rankability score backed by website content, external validation, and trust signals.`;
}

function averagePrimaryScore(metrics: RankabilityScorecard) {
  return Math.round(metrics.weightedTotalScore);
}

function fallbackObservedConfidence(latestScan: ProjectScanRun | null) {
  const pages = latestScan?.pages ?? [];
  if (!pages.length) {
    return 0;
  }

  const averageConfidence = pages.reduce((sum, page) => sum + page.merged.confidence, 0) / pages.length;
  return Math.round(averageConfidence * 100);
}

function avg(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function safeUrl(value: string) {
  try {
    return new URL(value.startsWith("http") ? value : `https://${value}`);
  } catch {
    return null;
  }
}

function matchesEducationReportSignals(text: string) {
  return (
    text.includes("ai school report writer") ||
    ((text.includes("school report") || text.includes("student report") || text.includes("report writing")) &&
      (text.includes("teacher") || text.includes("teachers") || text.includes("student feedback") || text.includes("comments")))
  );
}

function matchesVisitorManagementSignals(text: string) {
  return (
    text.includes("visitor management") ||
    text.includes("visitor sign in") ||
    text.includes("digital sign in") ||
    text.includes("contractor management") ||
    (text.includes("check in") && (text.includes("visitor") || text.includes("contractor"))) ||
    text.includes("evacuation") ||
    text.includes("on site")
  );
}

function matchesAccountingSoftwareSignals(text: string) {
  return (
    text.includes("accounting software") ||
    text.includes("bookkeeping") ||
    text.includes("invoicing") ||
    text.includes("payroll") ||
    text.includes("bas") ||
    text.includes("gst") ||
    text.includes("reconcile")
  );
}

function detectCategoryFromSignals(text: string) {
  if (matchesVisitorManagementSignals(text)) {
    return "Visitor management system";
  }
  if (matchesAccountingSoftwareSignals(text)) {
    return "Accounting software";
  }
  if (matchesEducationReportSignals(text)) {
    return "AI school report writing software";
  }
  return "";
}
