import { LLMAdapterError, type LLMFailure, type LLMRequest, type LLMResult } from "@/lib/llm/types";

type OllamaClientOptions = {
  baseUrl?: string;
  defaultModel?: string;
  fetchImpl?: typeof fetch;
};

type OllamaChatResponse = {
  model?: string;
  message?: {
    role?: string;
    content?: string;
  };
  response?: string;
  done?: boolean;
  error?: string;
};

type OllamaChatRequest = {
  model: string;
  messages: LLMRequest["messages"];
  stream: false;
  options?: {
    temperature?: number;
  };
  format?: "json" | Record<string, unknown>;
};

export function createOllamaClient(options: OllamaClientOptions = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434");
  const defaultModel = options.defaultModel ?? process.env.OLLAMA_MODEL ?? "llama3.1:8b";
  const fetchImpl = options.fetchImpl ?? fetch;
  let availableModelsPromise: Promise<string[] | null> | null = null;

  async function generate<T = string>(request: LLMRequest): Promise<LLMResult<T>> {
    const preferredModel = request.model ?? defaultModel;
    const candidates = await buildModelCandidates(preferredModel);

    let lastFailure: LLMFailure | null = null;

    for (const model of candidates) {
      try {
        const response = await fetchImpl(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(buildOllamaRequest(model, request))
        });

        const raw = (await response.json()) as OllamaChatResponse;

        if (!response.ok) {
          throw new LLMAdapterError(raw.error ?? `Ollama request failed with status ${response.status}.`, {
            model,
            status: response.status,
            raw
          });
        }

        const content = extractOllamaContent(raw);

        return {
          ok: true,
          model,
          content: normalizeResponse<T>(content, model, request.responseFormat, request.responseSchema),
          raw
        };
      } catch (error) {
        if (error instanceof LLMAdapterError) {
          lastFailure = {
            ok: false,
            model,
            error: error.message,
            raw: error.raw
          };

          if (shouldTryAnotherModel(error.message, request)) {
            continue;
          }

          return lastFailure;
        }

        lastFailure = {
          ok: false,
          model,
          error: error instanceof Error ? error.message : "Unknown Ollama error."
        };
        return lastFailure;
      }
    }

    return (
      lastFailure ?? {
        ok: false,
        model: preferredModel,
        error: `No Ollama models available for ${preferredModel}.`
      }
    );
  }

  async function buildModelCandidates(preferredModel: string) {
    const availableModels = await loadAvailableModels();
    const fallbackModels = ["qwen2.5:14b", "qwen2.5", "llama3.2", "llama3.1", "mistral", "phi4"];

    if (!availableModels?.length) {
      return uniqueModels([preferredModel, ...fallbackModels]);
    }

    const exact = availableModels.includes(preferredModel) ? [preferredModel] : [];
    const sameFamily = availableModels.filter(
      (model) => model === preferredModel || model.startsWith(`${preferredModel}:`) || preferredModel.startsWith(`${model}:`)
    );
    const rankedAvailableFallbacks = fallbackModels.flatMap((fallback) =>
      availableModels.filter((model) => model === fallback || model.startsWith(`${fallback}:`))
    );

    return uniqueModels([...exact, ...sameFamily, ...rankedAvailableFallbacks, ...availableModels]);
  }

  async function loadAvailableModels() {
    if (!availableModelsPromise) {
      availableModelsPromise = fetchImpl(`${baseUrl}/api/tags`)
        .then(async (response) => {
          if (!response.ok) {
            return null;
          }

          const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
          return (payload.models ?? [])
            .flatMap((item) => [item.name, item.model])
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
        })
        .catch(() => null);
    }

    return availableModelsPromise;
  }

  return {
    baseUrl,
    defaultModel,
    generate
  };
}

function buildOllamaRequest(model: string, request: LLMRequest): OllamaChatRequest {
  const payload: OllamaChatRequest = {
    model,
    messages: request.messages,
    stream: false,
    options: request.temperature === undefined ? undefined : { temperature: request.temperature }
  };

  if (request.responseSchema) {
    payload.format = request.responseSchema;
  } else if (request.responseFormat === "json") {
    payload.format = "json";
  }

  return payload;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function extractOllamaContent(payload: OllamaChatResponse) {
  return payload.message?.content ?? payload.response ?? "";
}

function normalizeResponse<T>(
  content: string,
  model: string,
  responseFormat?: LLMRequest["responseFormat"],
  responseSchema?: LLMRequest["responseSchema"]
) {
  if (responseFormat !== "json" && !responseSchema) {
      return content as T;
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new LLMAdapterError("Ollama returned invalid JSON content.", {
      model,
      raw: content
    });
  }
}

function shouldTryAnotherModel(message: string, request: LLMRequest) {
  if (/model .* not found|unknown model|no such model/i.test(message)) {
    return true;
  }

  return Boolean((request.responseFormat === "json" || request.responseSchema) && /invalid json/i.test(message));
}

function uniqueModels(models: string[]) {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))];
}
