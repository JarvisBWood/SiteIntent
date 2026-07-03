import { createOllamaClient, createRemoteLLMClient } from "@/lib/llm";
import { shouldUseRemoteProvider } from "@/lib/llm/provider";
import { searchWeb, type WebSearchRun } from "@/lib/search/web-search";

type LocalWebScoringOptions<T> = {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  searchQueries: string[];
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxResultsPerQuery?: number;
  maxAttempts?: number;
};

export async function generateJsonWithLocalSearch<T>(
  options: LocalWebScoringOptions<T>
): Promise<{
  model: string;
  content: T;
  raw: unknown;
  searchRuns: WebSearchRun[];
  warnings: string[];
}> {
  const client = shouldUseRemoteProvider()
    ? createRemoteLLMClient({ defaultModel: options.model })
    : createOllamaClient({ defaultModel: options.model });
  const searchRuns = await Promise.all(
    uniqueStrings(options.searchQueries).map((query) =>
      searchWeb(query, {
        maxResults: options.maxResultsPerQuery ?? 6
      })
    )
  );
  const warnings = searchRuns
    .filter((run) => run.error)
    .map((run) => `${run.query}: ${run.error}`);

  const attempts = Math.max(1, options.maxAttempts ?? 3);
  let lastError = "Local model failed to return valid JSON.";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await client.generate<T>({
      model: options.model,
      responseFormat: "json",
      responseSchema: options.responseSchema,
      temperature: attempt === 0 ? options.temperature ?? 0.1 : 0,
      messages: [
        {
          role: "system",
          content: [
            options.systemPrompt,
            "You are given web search evidence that the app collected separately.",
            "Use that evidence for current external facts.",
            "Only cite source URLs that appear in the provided evidence.",
            "Return only valid JSON with no markdown fences."
          ].join(" ")
        },
        {
          role: "user",
          content: [
            options.userPrompt,
            "",
            attempt > 0
              ? `Retry ${attempt + 1} of ${attempts}. The previous response was not valid JSON for the required schema.`
              : "",
            "Collected web search evidence",
            formatSearchEvidence(searchRuns)
          ]
            .filter(Boolean)
            .join("\n")
        }
      ]
    });

    if (result.ok) {
      return {
        model: result.model,
        content: result.content,
        raw: result.raw,
        searchRuns,
        warnings
      };
    }

    lastError = result.error;
    warnings.push(`Attempt ${attempt + 1}: ${result.error}`);
  }

  throw new Error(lastError);
}

function formatSearchEvidence(searchRuns: WebSearchRun[]) {
  if (!searchRuns.length) {
    return "No search evidence was collected.";
  }

  return searchRuns
    .map((run, index) => {
      const lines = [
        `Query ${index + 1}: ${run.query}`,
        run.error ? `Search error: ${run.error}` : ""
      ];

      if (!run.results.length) {
        lines.push("No results.");
      } else {
        lines.push(
          ...run.results.map(
            (result, resultIndex) =>
              `${resultIndex + 1}. ${result.title}\nURL: ${result.url}\nDomain: ${result.sourceDomain}\nSnippet: ${truncate(
                result.snippet || "n/a",
                320
              )}`
          )
        );
      }

      return lines.filter(Boolean).join("\n");
    })
    .join("\n\n");
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
