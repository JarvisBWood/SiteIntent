import OpenAI from "openai";

import { getCloudflareEnv, isCloudflareRuntime } from "@/lib/cloudflare-runtime";
import { createOllamaClient } from "@/lib/llm";
import { isOpenAIModelName } from "@/lib/llm/provider";
import type {
  AnalysisPassName,
  AnalysisPassResult,
  PageExtraction,
  PageOutput,
  PageScanRecord
} from "@/lib/scan/types";

type AnalysisContext = {
  projectName: string;
  websiteUrl: string;
  competitorUrls: string[];
};

type AnalyzedPageRecord = Omit<PageScanRecord, "discoverySources">;

const PAGE_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "audience", "product", "supporting_signals", "weakening_signals", "confidence"],
  properties: {
    intent: { type: "string" },
    audience: { type: "string" },
    product: { type: "string" },
    supporting_signals: {
      type: "array",
      items: { type: "string" },
      maxItems: 8
    },
    weakening_signals: {
      type: "array",
      items: { type: "string" },
      maxItems: 8
    },
    confidence: { type: "number" }
  }
} as const;

export async function analyzePage(page: PageExtraction, context: AnalysisContext): Promise<AnalyzedPageRecord> {
  const model = getPageAnalysisModel();
  if (isOpenAIModelName(model)) {
    return analyzePageWithOpenAI(page, context, model);
  }

  const client = createOllamaClient({ defaultModel: model });

  const passA = await runPass("A", page, context, client, model);
  const passB = await runPass("B", page, context, client, model);

  const stable = isStable(passA.parsed, passB.parsed);
  if (stable) {
    return finalizeAnalysis(page, [passA, passB], "stable", null);
  }

  const passC = await runPass("C", page, context, client, model, {
    focus: "Resolve the conflict and produce the best final single-page interpretation."
  });

  return finalizeAnalysis(page, [passA, passB, passC], "unstable", describeInstability(passA.parsed, passB.parsed, passC.parsed));
}

async function analyzePageWithOpenAI(page: PageExtraction, context: AnalysisContext, model: string): Promise<AnalyzedPageRecord> {
  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    return buildFallbackAnalysisRecord(page, context, "C", "OpenAI API key is not configured.");
  }

  const client = new OpenAI({ apiKey: openAiApiKey });
  const passA = await runOpenAiPass("A", page, context, client, model, 0.2);
  const passB = await runOpenAiPass("B", page, context, client, model, 0.35);

  const stable = isStable(passA.parsed, passB.parsed);
  if (stable) {
    return finalizeAnalysis(page, [passA, passB], "stable", null);
  }

  const passC = await runOpenAiPass("C", page, context, client, model, 0.15, {
    focus: "Resolve the conflict and produce the best final single-page interpretation."
  });

  return finalizeAnalysis(page, [passA, passB, passC], "unstable", describeInstability(passA.parsed, passB.parsed, passC.parsed));
}

async function runPass(
  pass: AnalysisPassName,
  page: PageExtraction,
  context: AnalysisContext,
  client: ReturnType<typeof createOllamaClient>,
  model: string,
  extra: { focus?: string } = {}
): Promise<AnalysisPassResult> {
  const prompt = buildPrompt(pass, page, context, extra.focus);
  const result = await client.generate<Record<string, unknown>>({
    model,
    responseFormat: "json",
    responseSchema: PAGE_ANALYSIS_SCHEMA,
    temperature: pass === "A" ? 0.2 : pass === "B" ? 0.35 : 0.15,
    messages: [
      {
        role: "system",
        content:
          "You are an analytical website intent model. Return only valid JSON matching the requested keys. " +
          "Identify the actual product, audience, and outcome from the page content rather than generic website advice. " +
          "Prefer concrete language like software category, user type, and job-to-be-done. " +
          "Be concise, specific, and grounded in the page content."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  });

  if (result.ok) {
    return {
      pass,
      model: result.model,
      raw: result.raw,
      prompt,
      parsed: normalizeAnalysisOutput(page.url, page.pageType, result.content)
    };
  }

  const fallback = buildFallbackAnalysis(page, context, pass, result.error);
  return {
    pass,
    model: result.model,
    raw: result.raw ?? { error: result.error, fallback: true },
    prompt,
    parsed: fallback
  };
}

async function runOpenAiPass(
  pass: AnalysisPassName,
  page: PageExtraction,
  context: AnalysisContext,
  client: OpenAI,
  model: string,
  temperature: number,
  extra: { focus?: string } = {}
): Promise<AnalysisPassResult> {
  const prompt = buildPrompt(pass, page, context, extra.focus);
  const response = await createOpenAiAnalysisResponse(client, {
    model,
    input: [
      {
        role: "system",
        content:
          "You are an analytical website intent model. Return only valid JSON matching the requested keys. " +
          "Identify the actual product, audience, and outcome from the page content rather than generic website advice. " +
          "Prefer concrete language like software category, user type, and job-to-be-done. " +
          "Be concise, specific, and grounded in the page content."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    tools: [],
    temperature,
    text: {
      format: {
        type: "json_schema",
        name: "siteintent_page_analysis",
        strict: true,
        schema: PAGE_ANALYSIS_SCHEMA
      }
    }
  });

  const parsed = parseResponseJson(response);
  return {
    pass,
    model: response.model || model,
    raw: response,
    prompt,
    parsed: normalizeAnalysisOutput(page.url, page.pageType, parsed)
  };
}

function getPageAnalysisModel() {
  if (isCloudflareRuntime()) {
    return getCloudflareEnv()?.SITEINTENT_PAGE_ANALYSIS_MODEL || process.env.SITEINTENT_PAGE_ANALYSIS_MODEL || "gpt-5-mini";
  }

  return process.env.SITEINTENT_PAGE_ANALYSIS_LOCAL_MODEL || process.env.OLLAMA_MODEL || "llama3.1:8b";
}

async function createOpenAiAnalysisResponse(
  client: OpenAI,
  request: OpenAI.Responses.ResponseCreateParamsNonStreaming
) {
  try {
    return await client.responses.create(request);
  } catch (error) {
    if (isModelNotFound(error) && request.model !== "gpt-5.4-mini") {
      return client.responses.create({
        ...request,
        model: "gpt-5.4-mini"
      });
    }
    throw error;
  }
}

function parseResponseJson(response: { output_text?: string; output?: unknown[] }) {
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

function isModelNotFound(error: unknown) {
  return error instanceof OpenAI.APIError && error.status === 404 && typeof error.message === "string";
}

function finalizeAnalysis(
  page: PageExtraction,
  passes: AnalysisPassResult[],
  mergeDecision: "stable" | "unstable",
  unstableReason: string | null
): AnalyzedPageRecord {
  const finalPass = passes[passes.length - 1] ?? passes[0];
  const merged = {
    ...finalPass.parsed,
    stability: calculateStability(passes.map((pass) => pass.parsed)),
    timestamp: new Date().toISOString()
  };

  return {
    url: page.url,
    normalizedUrl: page.normalizedUrl,
    pageType: page.pageType,
    pageTitle: page.metadata.title,
    metaTitle: page.metadata.metaTitle,
    metaDescription: page.metadata.metaDescription,
    h1: page.metadata.h1,
    headings: page.metadata.headings,
    mainText: page.mainText,
    excerpt: page.excerpt,
    wordCount: page.wordCount,
    contentHash: page.contentHash,
    httpStatus: page.httpStatus,
    crawlDepth: page.crawlDepth,
    internalLinks: page.internalLinks,
    scrapeTimestamp: page.scrapeTimestamp,
    canonicalUrl: page.metadata.canonicalUrl,
    passes,
    merged,
    mergeDecision,
    unstableReason
  };
}

function buildPrompt(
  pass: AnalysisPassName,
  page: PageExtraction,
  context: AnalysisContext,
  focus?: string
) {
  return [
    `Pass ${pass} analysis for Site Intent.`,
    `Project: ${context.projectName}`,
    `Website: ${context.websiteUrl}`,
    context.competitorUrls.length ? `Competitors: ${context.competitorUrls.join(", ")}` : "Competitors: none",
    `URL: ${page.url}`,
    `Page type guess: ${page.pageType}`,
    `Page title: ${page.metadata.title}`,
    `Meta title: ${page.metadata.metaTitle || "n/a"}`,
    `Meta description: ${page.metadata.metaDescription || "n/a"}`,
    `H1: ${page.metadata.h1 || "n/a"}`,
    `Headings: ${page.metadata.headings.map((heading) => `${heading.level}:${heading.text}`).join(" | ") || "n/a"}`,
    `Content excerpt: ${page.excerpt}`,
    focus ? `Focus: ${focus}` : "",
    "Return JSON with keys: intent, audience, product, supporting_signals, weakening_signals, confidence.",
    "intent should describe what this page is trying to communicate or help the visitor do.",
    "audience should name the real user group, such as teachers, schools, or school leaders when supported by the page.",
    "product should name the actual offer, such as AI school report writer software, not a generic software platform.",
    "confidence must be a number from 0 to 1."
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeAnalysisOutput(url: string, pageType: string, output: Record<string, unknown>): PageOutput {
  const now = new Date().toISOString();
  return {
    url,
    page_type: pageType,
    intent: asString(output.intent, "The page communicates the core value proposition."),
    audience: asString(output.audience, "Website visitors and potential buyers."),
    product: asString(output.product, "The product or service described on the page."),
    supporting_signals: asStringArray(output.supporting_signals, []),
    weakening_signals: asStringArray(output.weakening_signals, []),
    confidence: clampNumber(asNumber(output.confidence, 0.55), 0, 1),
    stability: clampNumber(asNumber(output.stability, 0.5), 0, 1),
    timestamp: now
  };
}

function buildFallbackAnalysis(
  page: PageExtraction,
  context: AnalysisContext,
  pass: AnalysisPassName,
  error: string
): PageOutput {
  const text = `${page.metadata.title} ${page.metadata.metaTitle} ${page.metadata.metaDescription} ${page.mainText}`.toLowerCase();
  const confidence = estimateConfidence(text, page.pageType);
  const intent = inferIntent(text, page.pageType);
  const audience = inferAudience(text, context.projectName);
  const product = inferProduct(text, context.projectName, context.websiteUrl);
  const signals = inferSignals(text, page);
  const weakeningSignals = inferWeakeningSignals(text, page, error);
  const stability = pass === "C" ? 0.55 : 0.42;

  return {
    url: page.url,
    page_type: page.pageType,
    intent,
    audience,
    product,
    supporting_signals: signals,
    weakening_signals: weakeningSignals,
    confidence: clampNumber(confidence, 0, 1),
    stability,
    timestamp: new Date().toISOString()
  };
}

function buildFallbackAnalysisRecord(
  page: PageExtraction,
  context: AnalysisContext,
  pass: AnalysisPassName,
  error: string
): AnalyzedPageRecord {
  const parsed = buildFallbackAnalysis(page, context, pass, error);
  const fallbackPass: AnalysisPassResult = {
    pass,
    model: "fallback",
    raw: { error, fallback: true },
    prompt: "",
    parsed
  };

  return finalizeAnalysis(page, [fallbackPass], "unstable", error);
}

function inferIntent(text: string, pageType: string) {
  if (matchesEducationReportPattern(text)) {
    return "Help teachers write personalised school reports and student comments faster with AI.";
  }
  if (matchesVisitorManagementPattern(text)) {
    return "Help workplaces manage visitors, contractors, staff notifications, and on-site safety through a visitor management system.";
  }
  if (matchesAccountingSoftwarePattern(text)) {
    return "Help businesses manage bookkeeping, invoicing, payroll, and compliance with accounting software.";
  }
  if (pageType === "homepage") {
    return "Explain the primary value proposition and frame the brand clearly for the real product category.";
  }
  if (text.includes("pricing")) {
    return "Translate the product into a purchase decision and pricing context.";
  }
  if (text.includes("demo") || text.includes("book a call")) {
    return "Move the visitor toward a demo or sales conversation.";
  }
  if (text.includes("documentation") || pageType === "docs") {
    return "Help the visitor understand how to use the product.";
  }
  return "Clarify a specific part of the product, workflow, or supporting information.";
}

function inferAudience(text: string, projectName: string) {
  if (matchesEducationReportPattern(text)) {
    if (text.includes("school") || text.includes("department of education")) {
      return "Teachers and schools writing student reports.";
    }
    return "Teachers writing student reports.";
  }
  if (matchesVisitorManagementPattern(text)) {
    return "Workplaces, offices, schools, and operations teams managing visitors and contractors.";
  }
  if (matchesAccountingSoftwarePattern(text)) {
    return "Businesses, finance teams, accountants, and bookkeepers evaluating accounting software.";
  }
  if (text.includes("team") || text.includes("workflow")) {
    return "Teams evaluating the product for their workflow.";
  }
  if (text.includes("founder") || text.includes("startup")) {
    return "Founders and small teams comparing options.";
  }
  return `People researching ${projectName.toLowerCase()} and similar solutions.`;
}

function inferProduct(text: string, projectName: string, websiteUrl: string) {
  if (matchesEducationReportPattern(text)) {
    return "AI school report writer software for generating personalised student comments.";
  }
  if (matchesVisitorManagementPattern(text)) {
    return "Visitor management system software.";
  }
  if (matchesAccountingSoftwarePattern(text)) {
    return "Accounting software.";
  }
  if (text.includes("visitor management")) {
    return "Visitor management system software.";
  }
  if (text.includes("platform") || text.includes("software") || text.includes("system")) {
    return `${projectName} as a software product for its stated category.`;
  }
  return `The offering described by ${new URL(websiteUrl).hostname}.`;
}

function inferSignals(text: string, page: PageExtraction) {
  const signals: string[] = [];
  if (page.metadata.title) signals.push(`Title: ${page.metadata.title}`);
  if (page.metadata.metaDescription) signals.push(`Description: ${page.metadata.metaDescription}`);
  if (page.metadata.headings.length) signals.push(`Headings: ${page.metadata.headings.slice(0, 3).map((heading) => heading.text).join(" | ")}`);
  if (matchesEducationReportPattern(text)) signals.push("Repeated teacher, school report, and AI writing language.");
  if (matchesVisitorManagementPattern(text)) signals.push("Repeated visitor management, digital sign in, contractor, evacuation, and on-site safety language.");
  if (matchesAccountingSoftwarePattern(text)) signals.push("Repeated accounting, bookkeeping, invoicing, payroll, BAS, or compliance language.");
  if (text.includes("intent")) signals.push("Mentions intent language.");
  if (text.includes("audience")) signals.push("Mentions audience language.");
  if (text.includes("pricing")) signals.push("Contains pricing context.");
  return signals.slice(0, 6);
}

function inferWeakeningSignals(text: string, page: PageExtraction, error: string) {
  const signals: string[] = [];
  if (!page.metadata.metaDescription) signals.push("No meta description detected.");
  if (page.internalLinks.length === 0) signals.push("No internal links discovered on page.");
  if (text.length < 500) signals.push("Limited body text extracted.");
  if (/coming soon|under construction|placeholder/i.test(text)) {
    signals.push("Placeholder language reduces confidence.");
  }
  if (error) signals.push(`Analysis fallback used: ${error}`);
  return signals.slice(0, 6);
}

function describeInstability(first: PageOutput, second: PageOutput, third: PageOutput) {
  const differences: string[] = [];
  if (normalize(first.intent) !== normalize(second.intent)) differences.push("intent");
  if (normalize(first.audience) !== normalize(second.audience)) differences.push("audience");
  if (normalize(first.product) !== normalize(second.product)) differences.push("product");
  if (Math.abs(first.confidence - second.confidence) > 0.15) differences.push("confidence");

  if (third.intent && normalize(third.intent) !== normalize(first.intent)) {
    differences.push("pass C correction");
  }

  return differences.length ? `Unstable across ${[...new Set(differences)].join(", ")}.` : "Unstable page analysis.";
}

function isStable(first: PageOutput, second: PageOutput) {
  const fields = [similarity(first.intent, second.intent), similarity(first.audience, second.audience), similarity(first.product, second.product)];
  const confidenceGap = 1 - Math.min(1, Math.abs(first.confidence - second.confidence));
  const score = fields.reduce((sum, value) => sum + value, 0) / fields.length * 0.8 + confidenceGap * 0.2;
  return score >= 0.68;
}

function calculateStability(outputs: PageOutput[]) {
  if (outputs.length < 2) {
    return outputs[0]?.stability ?? 0.5;
  }

  const pairs: number[] = [];
  for (let i = 0; i < outputs.length; i += 1) {
    for (let j = i + 1; j < outputs.length; j += 1) {
      pairs.push(
        (similarity(outputs[i].intent, outputs[j].intent) +
          similarity(outputs[i].audience, outputs[j].audience) +
          similarity(outputs[i].product, outputs[j].product)) /
          3
      );
    }
  }

  const average = pairs.reduce((sum, value) => sum + value, 0) / pairs.length;
  return clampNumber(average, 0, 1);
}

function similarity(a: string, b: string) {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  const leftTokens = new Set(left.split(/\s+/));
  const rightTokens = new Set(right.split(/\s+/));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function estimateConfidence(text: string, pageType: string) {
  const lengthScore = Math.min(text.length / 2200, 1);
  const typeBonus = pageType === "homepage" ? 0.15 : pageType === "product" ? 0.12 : 0.08;
  const educationBonus = matchesEducationReportPattern(text) ? 0.12 : 0;
  return clampNumber(0.4 + lengthScore * 0.45 + typeBonus + educationBonus, 0, 1);
}

function asString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }

  return fallback;
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchesEducationReportPattern(text: string) {
  return (
    (text.includes("school report") || text.includes("student report") || text.includes("report writing")) &&
    (text.includes("teacher") || text.includes("teachers") || text.includes("student feedback") || text.includes("comments"))
  ) || (text.includes("ai school report writer"));
}

function matchesVisitorManagementPattern(text: string) {
  return (
    text.includes("visitor management") ||
    text.includes("digital sign in") ||
    text.includes("visitor sign in") ||
    text.includes("contractor management") ||
    text.includes("check in") && (text.includes("visitor") || text.includes("contractor")) ||
    text.includes("evacuation") ||
    text.includes("on site")
  );
}

function matchesAccountingSoftwarePattern(text: string) {
  return (
    text.includes("accounting software") ||
    text.includes("bookkeeping") ||
    text.includes("invoicing") ||
    text.includes("payroll") ||
    text.includes("bas") ||
    text.includes("gst") ||
    text.includes("reconcile") ||
    text.includes("accounts payable") ||
    text.includes("accounts receivable")
  );
}
