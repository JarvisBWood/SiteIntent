#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import OpenAI from "openai";

const SCRIPT_VERSION = "1.0.0";
const OUTPUT_DIR = path.resolve(process.cwd(), "research-results");
await loadRootEnv();

const MODEL = process.env.OPENAI_RESEARCH_MODEL || "gpt-5.5";
const LIMIT = parsePositiveInteger(process.env.OPENAI_RESEARCH_LIMIT);
const DRY_RUN = process.env.OPENAI_RESEARCH_DRY_RUN === "1" || process.argv.includes("--dry-run");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const USER_LOCATION = {
  country: "AU",
  region: "NSW",
  city: "Sydney",
  timezone: "Australia/Sydney"
};

const WEB_SEARCH_TOOL = {
  type: "web_search",
  user_location: {
    type: "approximate",
    country: "AU",
    region: "New South Wales",
    city: "Sydney",
    timezone: "Australia/Sydney"
  }
};

const DATASETS = [
  {
    id: "no_web",
    file: "no-web-recommendations.json",
    description: "Top 5 recommendations without web search, followed by a separate reasoning call."
  },
  {
    id: "web",
    file: "web-recommendations.json",
    description: "Top 5 recommendations using OpenAI hosted web search."
  },
  {
    id: "web_with_reasoning",
    file: "web-recommendations-with-reasoning.json",
    description: "Top 5 recommendations and ranking rationale using OpenAI hosted web search."
  }
];

const CATEGORIES = [
  { name: "Visitor management system", context: "an Australian business comparing vendor websites", scope: "business" },
  { name: "Accounting software", context: "an Australian small business", scope: "australia" },
  { name: "Cleaning services", context: "a customer in Sydney, NSW, Australia", scope: "sydney" },
  { name: "Barbers", context: "a customer in Sydney, NSW, Australia", scope: "sydney" },
  { name: "Skip hire", context: "a customer in Sydney, NSW, Australia", scope: "sydney" },
  { name: "Men's t-shirts", context: "a shopper in Australia", scope: "australia" },
  { name: "Italian restaurants", context: "a diner in Sydney, NSW, Australia", scope: "sydney" },
  { name: "AI school report writer", context: "Australian teachers and schools", scope: "australia" },
  { name: "Pool towels", context: "a shopper in Australia", scope: "australia" },
  { name: "Dog grooming", context: "a pet owner in Sydney, NSW, Australia", scope: "sydney" }
];

const QUESTION_TEMPLATES = [
  "What are the 5 best {category} for {context}?",
  "Recommend the top 5 {category} for {context}.",
  "Which 5 {category} would you recommend for {context}?",
  "Give me the top 5 {category} websites or providers for {context}.",
  "If you had to shortlist 5 {category}, which would you choose for {context}?"
];

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recommended_top_5", "ranking_breakdown"],
  properties: {
    recommended_top_5: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rank", "name", "website", "reason"],
        properties: {
          rank: { type: "integer", minimum: 1, maximum: 5 },
          name: { type: "string" },
          website: { type: "string" },
          reason: { type: "string" }
        }
      }
    },
    ranking_breakdown: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "factors", "per_website_weighting"],
      properties: {
        summary: { type: "string" },
        factors: {
          type: "array",
          minItems: 0,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["factor", "weight_percent", "explanation"],
            properties: {
              factor: { type: "string" },
              weight_percent: { type: "number" },
              explanation: { type: "string" }
            }
          }
        },
        per_website_weighting: {
          type: "array",
          minItems: 0,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["rank", "name", "website", "weighted_reasons"],
            properties: {
              rank: { type: "integer", minimum: 1, maximum: 5 },
              name: { type: "string" },
              website: { type: "string" },
              weighted_reasons: {
                type: "array",
                minItems: 0,
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["factor", "weight_percent", "evidence"],
                  properties: {
                    factor: { type: "string" },
                    weight_percent: { type: "number" },
                    evidence: { type: "string" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

const SYSTEM_PROMPT = [
  "You are running a research experiment about how AI recommends websites, products, services, and local providers.",
  "Return only JSON matching the provided schema.",
  "Always provide exactly 5 recommendations.",
  "Prefer official websites or provider websites over marketplaces unless the marketplace is central to discovery.",
  "If you are unsure about a website URL, leave website as an empty string rather than inventing a URL.",
  "For reasoning, describe the signals you used. Do not claim exact internal model weights; provide an estimated decision breakdown based on your observable reasoning."
].join(" ");

function buildQuestionMatrix() {
  return CATEGORIES.flatMap((category) =>
    QUESTION_TEMPLATES.map((template, index) => ({
      category: category.name,
      category_scope: category.scope,
      prompt_variation: index + 1,
      question: template.replace("{category}", category.name).replace("{context}", category.context),
      context: category.context
    }))
  );
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const matrix = buildQuestionMatrix();
  const prompts = LIMIT ? matrix.slice(0, LIMIT) : matrix;
  const client = DRY_RUN ? null : createOpenAIClient();

  for (const dataset of DATASETS) {
    const document = await loadOrCreateDocument(dataset, matrix.length, prompts.length);

    for (const item of prompts) {
      const recordId = buildRecordId(dataset.id, item);
      if (document.records.some((record) => record.record_id === recordId && !record.error && isSameRunMode(record))) {
        continue;
      }

      const startedAt = new Date().toISOString();
      try {
        const record = DRY_RUN
          ? createDryRunRecord(dataset.id, item, startedAt)
          : await runDatasetCall(client, dataset.id, item, startedAt);

        removeExistingRecord(document, record.record_id);
        document.records.push(record);
      } catch (error) {
        const errorRecord = createErrorRecord(dataset.id, item, startedAt, error);
        removeExistingRecord(document, errorRecord.record_id);
        document.records.push(errorRecord);
        document.errors.push({
          record_id: errorRecord.record_id,
          dataset: dataset.id,
          category: item.category,
          prompt_variation: item.prompt_variation,
          message: getErrorMessage(error),
          occurred_at: new Date().toISOString()
        });
      }

      document.metadata.completed_at = new Date().toISOString();
      document.metadata.records_completed = document.records.filter((record) => !record.error).length;
      document.metadata.records_failed = document.records.filter((record) => record.error).length;
      await saveDocument(dataset, document);
    }
  }

  console.log(`Research run complete. Results are in ${OUTPUT_DIR}`);
  if (DRY_RUN) {
    console.log("Dry-run mode was enabled; no OpenAI API calls were made.");
  }
}

async function loadRootEnv() {
  for (const filename of [".env", ".env.txt"]) {
    const filePath = path.resolve(process.cwd(), filename);
    try {
      const content = await fs.readFile(filePath, "utf8");
      parseEnvContent(content);
      return filename;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return null;
}

function parseEnvContent(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = stripEnvQuotes(rawValue);
  }
}

function stripEnvQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function createOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required in the environment, .env, or .env.txt. Use OPENAI_RESEARCH_DRY_RUN=1 for a no-API dry run.");
  }

  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function runDatasetCall(client, datasetId, item, startedAt) {
  if (datasetId === "no_web") {
    return runNoWebCall(client, item, startedAt);
  }

  if (datasetId === "web") {
    return runWebCall(client, item, startedAt, false);
  }

  return runWebCall(client, item, startedAt, true);
}

async function runNoWebCall(client, item, startedAt) {
  const firstPrompt = buildTopFivePrompt(item.question, {
    requireWeb: false,
    includeReasoning: false
  });
  const firstResponse = await createResponseWithRetry(client, {
    model: MODEL,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: firstPrompt }
    ],
    text: responseTextFormat()
  });
  const firstPayload = parseResponseJson(firstResponse);

  const reasoningPrompt = [
    "Now break down how you came to this conclusion.",
    "I want to know why you recommended these websites specifically.",
    "Give me a breakdown of the top 5 reasons and the weighting you gave for each website.",
    "Example factors: Website Content, Reviews, Backlinks, Proximity to the user, Trust signals.",
    "The five factor weights must add to 100%."
  ].join(" ");

  const secondResponse = await createResponseWithRetry(client, {
    model: MODEL,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: firstPrompt },
      { role: "assistant", content: JSON.stringify(firstPayload) },
      { role: "user", content: reasoningPrompt }
    ],
    text: responseTextFormat()
  });
  const secondPayload = parseResponseJson(secondResponse);

  return buildRecord({
    datasetId: "no_web",
    item,
    startedAt,
    payload: {
      recommended_top_5: firstPayload.recommended_top_5,
      ranking_breakdown: secondPayload.ranking_breakdown
    },
    rawResponse: {
      recommendations_response: sanitizeRawResponse(firstResponse),
      reasoning_response: sanitizeRawResponse(secondResponse)
    }
  });
}

async function runWebCall(client, item, startedAt, includeReasoning) {
  const response = await createResponseWithRetry(client, {
    model: MODEL,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: buildTopFivePrompt(item.question, {
          requireWeb: true,
          includeReasoning
        })
      }
    ],
    tools: [WEB_SEARCH_TOOL],
    tool_choice: "required",
    text: responseTextFormat()
  });
  const payload = parseResponseJson(response);

  return buildRecord({
    datasetId: includeReasoning ? "web_with_reasoning" : "web",
    item,
    startedAt,
    payload,
    rawResponse: sanitizeRawResponse(response),
    usesWebSearch: containsWebSearchCall(response),
    webSources: extractWebSources(response)
  });
}

function buildTopFivePrompt(question, options) {
  const lines = [
    question,
    "",
    "Return exactly 5 recommendations in ranked order.",
    "For each recommendation include rank, name, website, and a concise reason."
  ];

  if (options.requireWeb) {
    lines.push("Use web search to answer this question with current information.");
  } else {
    lines.push("Do not use web search or live browsing. Answer from your existing model knowledge.");
  }

  if (options.includeReasoning) {
    lines.push(
      "After the top 5, explain how you came to the conclusion.",
      "Provide the top 5 ranking factors and percentage weights adding to 100%.",
      "Then provide the weighted reasons for each recommended website."
    );
  } else {
    lines.push(
      "For this answer-only run, leave ranking_breakdown.summary as an empty string and both ranking_breakdown arrays empty."
    );
  }

  return lines.join("\n");
}

async function createResponseWithRetry(client, request, attempt = 1) {
  try {
    return await client.responses.create(request);
  } catch (error) {
    if (attempt >= 4 || !isRetryableError(error)) {
      throw error;
    }

    const delay = 1000 * 2 ** (attempt - 1);
    await sleep(delay);
    return createResponseWithRetry(client, request, attempt + 1);
  }
}

function responseTextFormat() {
  return {
    format: {
      type: "json_schema",
      name: "ai_recommendation_ranking_research",
      strict: true,
      schema: RESULT_SCHEMA
    }
  };
}

function parseResponseJson(response) {
  const text = response.output_text || extractTextFromOutput(response.output);
  if (!text) {
    throw new Error("OpenAI response did not include output text.");
  }

  try {
    return JSON.parse(stripJsonFence(text));
  } catch (error) {
    throw new Error(`Unable to parse structured response JSON: ${getErrorMessage(error)}`);
  }
}

function buildRecord(options) {
  const validation_warnings = validatePayload(options.payload, options.usesWebSearch ?? false);
  return {
    record_id: buildRecordId(options.datasetId, options.item),
    run_id: RUN_ID,
    dataset: options.datasetId,
    category: options.item.category,
    category_scope: options.item.category_scope,
    prompt_variation: options.item.prompt_variation,
    question: options.item.question,
    model: MODEL,
    dry_run: DRY_RUN,
    uses_web_search: options.usesWebSearch ?? false,
    user_location: USER_LOCATION,
    recommended_top_5: normalizeRecommendations(options.payload.recommended_top_5),
    ranking_breakdown: normalizeBreakdown(options.payload.ranking_breakdown),
    web_sources: options.webSources ?? [],
    validation_warnings,
    raw_response: options.rawResponse ?? {},
    started_at: options.startedAt,
    completed_at: new Date().toISOString(),
    error: null
  };
}

function createDryRunRecord(datasetId, item, startedAt) {
  const includeReasoning = datasetId === "no_web" || datasetId === "web_with_reasoning";
  const usesWebSearch = datasetId === "web" || datasetId === "web_with_reasoning";
  const payload = {
    recommended_top_5: Array.from({ length: 5 }, (_, index) => ({
      rank: index + 1,
      name: `Dry Run ${item.category} Recommendation ${index + 1}`,
      website: `https://example.com/${slugify(item.category)}-${index + 1}`,
      reason: `Synthetic dry-run reason for ${item.category} recommendation ${index + 1}.`
    })),
    ranking_breakdown: includeReasoning
      ? {
          summary: "Synthetic dry-run ranking rationale.",
          factors: [
            { factor: "Website content", weight_percent: 40, explanation: "Clear category and offer relevance." },
            { factor: "Reviews and reputation", weight_percent: 25, explanation: "Strong perceived social proof." },
            { factor: "Search visibility", weight_percent: 15, explanation: "Likely to appear in discovery paths." },
            { factor: "Trust signals", weight_percent: 10, explanation: "Clear contact, policies, and credibility markers." },
            { factor: "Location or market fit", weight_percent: 10, explanation: "Fit for the requested geography or buyer." }
          ],
          per_website_weighting: Array.from({ length: 5 }, (_, index) => ({
            rank: index + 1,
            name: `Dry Run ${item.category} Recommendation ${index + 1}`,
            website: `https://example.com/${slugify(item.category)}-${index + 1}`,
            weighted_reasons: [
              { factor: "Website content", weight_percent: 40, evidence: "Synthetic evidence." },
              { factor: "Reviews and reputation", weight_percent: 25, evidence: "Synthetic evidence." },
              { factor: "Search visibility", weight_percent: 15, evidence: "Synthetic evidence." },
              { factor: "Trust signals", weight_percent: 10, evidence: "Synthetic evidence." },
              { factor: "Location or market fit", weight_percent: 10, evidence: "Synthetic evidence." }
            ]
          }))
        }
      : emptyBreakdown()
  };

  return buildRecord({
    datasetId,
    item,
    startedAt,
    payload,
    usesWebSearch,
    webSources: usesWebSearch ? ["https://example.com/dry-run-source"] : [],
    rawResponse: { dry_run: true }
  });
}

function createErrorRecord(datasetId, item, startedAt, error) {
  return {
    record_id: buildRecordId(datasetId, item),
    run_id: RUN_ID,
    dataset: datasetId,
    category: item.category,
    category_scope: item.category_scope,
    prompt_variation: item.prompt_variation,
    question: item.question,
    model: MODEL,
    dry_run: DRY_RUN,
    uses_web_search: false,
    user_location: USER_LOCATION,
    recommended_top_5: [],
    ranking_breakdown: emptyBreakdown(),
    web_sources: [],
    validation_warnings: [],
    raw_response: {},
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    error: getErrorMessage(error)
  };
}

async function loadOrCreateDocument(dataset, totalPrompts, activePrompts) {
  const filePath = path.join(OUTPUT_DIR, dataset.file);
  try {
    const existing = JSON.parse(await fs.readFile(filePath, "utf8"));
    const freshMetadata = createMetadata(dataset, totalPrompts, activePrompts);
    existing.metadata = {
      ...existing.metadata,
      script: freshMetadata.script,
      script_version: freshMetadata.script_version,
      dataset: freshMetadata.dataset,
      description: freshMetadata.description,
      model: freshMetadata.model,
      dry_run: freshMetadata.dry_run,
      total_prompt_matrix_size: freshMetadata.total_prompt_matrix_size,
      active_prompt_count: freshMetadata.active_prompt_count,
      expected_records: freshMetadata.expected_records,
      web_search_tool: freshMetadata.web_search_tool,
      user_location: freshMetadata.user_location,
      categories: freshMetadata.categories,
      question_templates: freshMetadata.question_templates,
      resumed_at: new Date().toISOString(),
    };
    existing.records ??= [];
    existing.errors ??= [];
    return existing;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    return {
      metadata: createMetadata(dataset, totalPrompts, activePrompts),
      records: [],
      errors: []
    };
  }
}

function createMetadata(dataset, totalPrompts, activePrompts) {
  return {
    script: "scripts/run-ai-ranking-research.mjs",
    script_version: SCRIPT_VERSION,
    dataset: dataset.id,
    description: dataset.description,
    started_at: new Date().toISOString(),
    completed_at: null,
    model: MODEL,
    dry_run: DRY_RUN,
    total_prompt_matrix_size: totalPrompts,
    active_prompt_count: activePrompts,
    expected_records: activePrompts,
    records_completed: 0,
    records_failed: 0,
    web_search_tool: dataset.id === "no_web" ? null : WEB_SEARCH_TOOL,
    user_location: USER_LOCATION,
    categories: CATEGORIES,
    question_templates: QUESTION_TEMPLATES
  };
}

async function saveDocument(dataset, document) {
  const filePath = path.join(OUTPUT_DIR, dataset.file);
  const sorted = {
    ...document,
    records: [...document.records].sort((a, b) => a.record_id.localeCompare(b.record_id))
  };
  await fs.writeFile(filePath, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

function validatePayload(payload, expectsWebSearch) {
  const warnings = [];
  const recommendations = payload.recommended_top_5 ?? [];
  if (recommendations.length !== 5) {
    warnings.push(`Expected exactly 5 recommendations, received ${recommendations.length}.`);
  }

  const factors = payload.ranking_breakdown?.factors ?? [];
  if (factors.length) {
    const total = factors.reduce((sum, factor) => sum + Number(factor.weight_percent || 0), 0);
    if (Math.abs(total - 100) > 0.5) {
      warnings.push(`Ranking factor weights should sum to 100, received ${total}.`);
    }
  }

  if (expectsWebSearch && !payload.recommended_top_5?.length) {
    warnings.push("Web-search run returned no recommendations.");
  }

  return warnings;
}

function normalizeRecommendations(value) {
  return Array.isArray(value) ? value.slice(0, 5) : [];
}

function normalizeBreakdown(value) {
  if (!value || typeof value !== "object") {
    return emptyBreakdown();
  }

  return {
    summary: typeof value.summary === "string" ? value.summary : "",
    factors: Array.isArray(value.factors) ? value.factors.slice(0, 5) : [],
    per_website_weighting: Array.isArray(value.per_website_weighting)
      ? value.per_website_weighting.slice(0, 5)
      : []
  };
}

function emptyBreakdown() {
  return {
    summary: "",
    factors: [],
    per_website_weighting: []
  };
}

function containsWebSearchCall(response) {
  return JSON.stringify(response.output ?? []).includes('"web_search_call"');
}

function extractWebSources(response) {
  const sources = new Set();
  collectUrlsFromValue(response.output, sources);
  return [...sources];
}

function collectUrlsFromValue(value, sources) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrlsFromValue(item, sources);
    }
    return;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if ((key === "url" || key === "uri") && typeof child === "string" && /^https?:\/\//i.test(child)) {
        sources.add(child);
      }
      collectUrlsFromValue(child, sources);
    }
  }
}

function sanitizeRawResponse(response) {
  return {
    id: response.id,
    model: response.model,
    status: response.status,
    output_text: response.output_text,
    output: response.output,
    usage: response.usage
  };
}

function extractTextFromOutput(output) {
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? "")
    .filter(Boolean)
    .join("\n");
}

function stripJsonFence(text) {
  return text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
}

function removeExistingRecord(document, recordId) {
  document.records = document.records.filter((record) => record.record_id !== recordId);
}

function isSameRunMode(record) {
  if (typeof record.dry_run === "boolean") {
    return record.dry_run === DRY_RUN;
  }

  return Boolean(record.raw_response?.dry_run) === DRY_RUN;
}

function buildRecordId(datasetId, item) {
  return `${datasetId}__${slugify(item.category)}__v${item.prompt_variation}`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parsePositiveInteger(value) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isRetryableError(error) {
  const status = error?.status ?? error?.response?.status;
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status < 600);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(getErrorMessage(error));
  process.exit(1);
});
