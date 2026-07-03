import { LLMAdapterError, type LLMRequest, type LLMResult } from "@/lib/llm/types";

type RemoteClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = parseInt(value, 10);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

function extractRetryDelay(body: string): number | null {
  const retryMatch = body.match(/try again in (\d+(?:\.\d+)?)\s*s/i);
  if (retryMatch) {
    return Math.ceil(parseFloat(retryMatch[1]) * 1000) + 200;
  }
  return null;
}

export function createRemoteLLMClient(options: RemoteClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? process.env.SITEINTENT_AI_API_URL ?? "").replace(/\/+$/, "");
  const apiKey = options.apiKey ?? process.env.SITEINTENT_AI_API_KEY ?? "";
  const defaultModel = options.defaultModel ?? process.env.SITEINTENT_AI_MODEL ?? "";
  const maxRetries = options.maxRetries ?? 3;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!baseUrl) {
    throw new Error("SITEINTENT_AI_API_URL is required for the remote LLM provider.");
  }
  if (!apiKey) {
    throw new Error("SITEINTENT_AI_API_KEY is required for the remote LLM provider.");
  }
  if (!defaultModel) {
    throw new Error("SITEINTENT_AI_MODEL is required for the remote LLM provider.");
  }

  async function generate<T = string>(request: LLMRequest): Promise<LLMResult<T>> {
    const model = request.model ?? defaultModel;
    let lastError: LLMAdapterError | Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: request.messages,
            temperature: request.temperature,
            response_format:
              request.responseFormat === "json" || request.responseSchema
                ? { type: "json_object" }
                : undefined
          })
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "");
          const err = new LLMAdapterError(
            `Remote API request failed with status ${response.status}`,
            { model, status: response.status, raw: errorBody }
          );

          if (attempt >= maxRetries || !isRetryableStatus(response.status)) {
            return { ok: false, model, error: err.message, raw: err.raw };
          }

          const delay =
            parseRetryAfter(response) ??
            extractRetryDelay(errorBody) ??
            Math.min(1000 * 2 ** attempt, 30000);
          lastError = err;
          await sleep(delay);
          continue;
        }

        const raw = await response.json() as Record<string, unknown>;
        const content: unknown = (raw as any)?.choices?.[0]?.message?.content;

        if (typeof content !== "string" || !content.trim()) {
          throw new LLMAdapterError("Remote API returned empty or missing content.", { model, raw });
        }

        return {
          ok: true,
          model,
          content: normalizeResponse<T>(content as string, model, request.responseFormat, request.responseSchema),
          raw
        };
      } catch (error) {
        if (attempt >= maxRetries) {
          return {
            ok: false,
            model,
            error: error instanceof Error ? error.message : "Unknown remote LLM error.",
            raw: error instanceof LLMAdapterError ? error.raw : null
          };
        }

        lastError = error instanceof Error ? error : new Error("Unknown remote LLM error.");
        const delay = Math.min(1000 * 2 ** attempt, 30000);
        await sleep(delay);
      }
    }

    return {
      ok: false,
      model,
      error: lastError instanceof Error ? lastError.message : "Remote LLM failed after retries.",
      raw: lastError instanceof LLMAdapterError ? lastError.raw : null
    };
  }

  function isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  return {
    baseUrl,
    defaultModel,
    generate
  };
}

function normalizeResponse<T>(
  content: string,
  model: string,
  responseFormat?: LLMRequest["responseFormat"],
  responseSchema?: LLMRequest["responseSchema"]
): T {
  if (responseFormat !== "json" && !responseSchema) {
    return content as T;
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new LLMAdapterError("Remote API returned invalid JSON content.", { model, raw: content });
  }
}
