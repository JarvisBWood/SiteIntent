#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import OpenAI from "openai";

const MODEL =
  process.env.CATEGORY_SCAN_MODEL ||
  process.env.SITEINTENT_DISCOVERABILITY_MODEL ||
  process.env.SITEINTENT_RANKABILITY_MODEL ||
  "gpt-5-mini";
const FALLBACK_MODEL = "gpt-5.4-mini";
const API_TIMEOUT_MS = 180000;
const OUTPUT_FILE = path.resolve(process.cwd(), "research-results/discovery-source-audit.json");
const INPUT_FILES = [
  "visitor-management-top10-scan.json",
  "accounting-software-top10-scan.json",
  "cleaning-services-top10-scan.json"
];

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

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "source_audit"],
  properties: {
    summary: { type: "string" },
    source_audit: {
      type: "array",
      minItems: 5,
      maxItems: 15,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "source_name",
          "source_domain",
          "source_type",
          "influence_on_discovery",
          "why_it_helped_discovery",
          "supported_websites",
          "example_source_urls"
        ],
        properties: {
          source_name: { type: "string" },
          source_domain: { type: "string" },
          source_type: {
            type: "string",
            enum: [
              "review_platform",
              "google_business_profile",
              "industry_directory",
              "editorial_media",
              "government_register",
              "marketplace",
              "forum",
              "social",
              "official_site",
              "unknown"
            ]
          },
          influence_on_discovery: { type: "string", enum: ["high", "medium", "low"] },
          why_it_helped_discovery: { type: "string" },
          supported_websites: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: { type: "string" }
          },
          example_source_urls: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: { type: "string" }
          }
        }
      }
    }
  }
};

await loadRootEnv();
if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required.");
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const datasets = [];
for (const file of INPUT_FILES) {
  const json = JSON.parse(await fs.readFile(path.resolve(process.cwd(), "research-results", file), "utf8"));
  datasets.push({ file, ...json });
}

const output = {
  generated_at: new Date().toISOString(),
  requested_model: MODEL,
  fallback_model: FALLBACK_MODEL,
  categories: []
};

for (const dataset of datasets) {
  const category = dataset.category || inferCategoryFromFilename(dataset.file);
  console.log(`[source-audit] ${category}`);
  const websites = dataset.scored_results
    .slice(0, 10)
    .map((item) => `${item.rank}. ${item.name} - ${item.website}`)
    .join("\n");

  const response = await createResponseWithModelFallback(client, {
    model: MODEL,
    input: [
      {
        role: "system",
        content: [
          "You are auditing external discovery sources for AI recommendation visibility.",
          "Use web search.",
          "Return only JSON matching the schema.",
          "Focus on external sources that likely helped these websites get discovered.",
          "Prefer non-official sources such as review platforms, Google Business Profile, directories, editorial pages, marketplaces, forums, and citations.",
          "Only include official sites if they were clearly essential to discovery.",
          "Support websites should be website domains or names from the provided list."
        ].join(" ")
      },
      {
        role: "user",
        content: [
          `Category: ${category}`,
          "These were the discovered top 10 websites:",
          websites,
          "",
          "Audit which external sources most likely helped these websites get discovered by AI for this category.",
          "Return the most influential source domains and explain why they mattered.",
          "For each source, specify which of the top 10 websites it supported."
        ].join("\n")
      }
    ],
    tools: [WEB_SEARCH_TOOL],
    tool_choice: "required",
    text: {
      format: {
        type: "json_schema",
        name: `${slugify(category)}_discovery_source_audit`,
        strict: true,
        schema: SCHEMA
      }
    }
  });

  const payload = JSON.parse(stripJsonFence(response.output_text || ""));
  output.categories.push({
    category,
    source_file: dataset.file,
    summary: payload.summary,
    source_audit: payload.source_audit
  });
}

await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote ${OUTPUT_FILE}`);

async function createResponseWithModelFallback(client, request) {
  try {
    return await createResponseWithTimeout(client, request);
  } catch (error) {
    if (error?.code === "model_not_found" && request.model !== FALLBACK_MODEL) {
      console.warn(`Model ${request.model} not found. Falling back to ${FALLBACK_MODEL}.`);
      return createResponseWithTimeout(client, { ...request, model: FALLBACK_MODEL });
    }
    throw error;
  }
}

async function createResponseWithTimeout(client, request) {
  const model = request.model || "unknown";
  let timeoutId;
  try {
    return await Promise.race([
      client.responses.create(request),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`OpenAI response timed out after ${API_TIMEOUT_MS}ms for model ${model}.`)), API_TIMEOUT_MS);
      })
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function inferCategoryFromFilename(filename) {
  if (filename.includes("visitor-management")) return "visitor management system";
  if (filename.includes("accounting-software")) return "accounting software";
  if (filename.includes("cleaning-services")) return "cleaning services";
  return "unknown";
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function stripJsonFence(value) {
  return value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
}

async function loadRootEnv() {
  for (const filename of [".env", ".env.txt"]) {
    const filePath = path.resolve(process.cwd(), filename);
    try {
      const content = await fs.readFile(filePath, "utf8");
      parseEnvContent(content);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function parseEnvContent(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
