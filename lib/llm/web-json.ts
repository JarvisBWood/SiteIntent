import OpenAI from "openai";

import type { ModelProvider } from "@/lib/llm/provider-models";

type UserLocation = {
  country?: string;
  region?: string;
  city?: string;
  timezone?: string;
} | null | undefined;

export type ProviderJsonResponse<T> = {
  provider: ModelProvider;
  model: string;
  content: T;
  raw: unknown;
  usesWebSearch: boolean;
};

export async function generateJsonWithProviderSearch<T>(options: {
  provider: ModelProvider;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  temperature?: number;
  userLocation?: UserLocation;
}): Promise<ProviderJsonResponse<T>> {
  switch (options.provider) {
    case "openai":
      return generateWithOpenAI<T>({ ...options, provider: "openai" });
    case "anthropic":
      return generateWithAnthropic<T>({ ...options, provider: "anthropic" });
    case "google":
      return generateWithGemini<T>({ ...options, provider: "google" });
  }
}

async function generateWithOpenAI<T>(options: {
  provider: "openai";
  model: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  temperature?: number;
  userLocation?: UserLocation;
}): Promise<ProviderJsonResponse<T>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: options.model,
    input: [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userPrompt }
    ],
    tools: [
      {
        type: "web_search",
        user_location: buildOpenAiUserLocation(options.userLocation)
      }
    ],
    tool_choice: "required",
    text: {
      format: {
        type: "json_schema",
        name: "siteintent_provider_json",
        strict: true,
        schema: options.responseSchema
      }
    },
    temperature: options.temperature
  });

  return {
    provider: "openai",
    model: response.model || options.model,
    content: JSON.parse(extractOpenAiText(response)) as T,
    raw: response,
    usesWebSearch: Array.isArray(response.output)
      ? response.output.some((item) => item && typeof item === "object" && (item as { type?: string }).type === "web_search_call")
      : true
  };
}

async function generateWithAnthropic<T>(options: {
  provider: "anthropic";
  model: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  temperature?: number;
  userLocation?: UserLocation;
}): Promise<ProviderJsonResponse<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: 4096,
      temperature: options.temperature ?? 0.1,
      system: `${options.systemPrompt} Return only valid JSON matching the requested schema.`,
      messages: [{ role: "user", content: options.userPrompt }],
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 6,
          user_location: buildAnthropicUserLocation(options.userLocation)
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic request failed with status ${response.status}.`);
  }

  const raw = (await response.json()) as {
    model?: string;
    content?: Array<{ type?: string; text?: string }>;
  };

  const text = stripJsonFence(
    (raw.content ?? [])
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n")
      .trim()
  );

  if (!text) {
    throw new Error("Anthropic response did not include JSON text.");
  }

  return {
    provider: "anthropic",
    model: raw.model || options.model,
    content: JSON.parse(text) as T,
    raw,
    usesWebSearch: Array.isArray(raw.content)
      ? raw.content.some((block) => String(block?.type ?? "").toLowerCase().includes("search"))
      : true
  };
}

async function generateWithGemini<T>(options: {
  provider: "google";
  model: string;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: Record<string, unknown>;
  temperature?: number;
  userLocation?: UserLocation;
}): Promise<ProviderJsonResponse<T>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required.");
  }

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
      "Api-Revision": "2026-05-20"
    },
    body: JSON.stringify({
      model: options.model,
      input: `${options.systemPrompt}\n\n${options.userPrompt}`,
      tools: [{ type: "google_search" }],
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: options.responseSchema
      },
      generation_config: {
        temperature: options.temperature ?? 0.1
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed with status ${response.status}.`);
  }

  const raw = (await response.json()) as {
    output_text?: string;
    steps?: Array<{ type?: string }>;
  };

  const text = stripJsonFence(raw.output_text ?? "");
  if (!text) {
    throw new Error("Gemini response did not include JSON text.");
  }

  return {
    provider: "google",
    model: options.model,
    content: JSON.parse(text) as T,
    raw,
    usesWebSearch: Array.isArray(raw.steps)
      ? raw.steps.some((step) => {
          const type = String(step?.type ?? "").toLowerCase();
          return type === "google_search_call" || type === "google_search_result";
        })
      : true
  };
}

function buildOpenAiUserLocation(location: UserLocation) {
  return {
    type: "approximate" as const,
    country: location?.country || "AU",
    region: location?.region || "New South Wales",
    city: location?.city || "Sydney",
    timezone: location?.timezone || "Australia/Sydney"
  };
}

function buildAnthropicUserLocation(location: UserLocation) {
  return {
    type: "approximate" as const,
    country: location?.country || "AU",
    region: location?.region || "New South Wales",
    city: location?.city || "Sydney",
    timezone: location?.timezone || "Australia/Sydney"
  };
}

function extractOpenAiText(response: { output_text?: string; output?: unknown[] }) {
  if (response.output_text?.trim()) {
    return stripJsonFence(response.output_text);
  }

  const texts: string[] = [];
  for (const item of response.output ?? []) {
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

  const text = stripJsonFence(texts.join("\n").trim());
  if (!text) {
    throw new Error("OpenAI response did not include JSON text.");
  }

  return text;
}

function stripJsonFence(value: string) {
  return value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
}
