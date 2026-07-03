export type WebSearchResult = {
  title: string;
  url: string;
  displayUrl: string;
  snippet: string;
  sourceDomain: string;
};

export type WebSearchRun = {
  query: string;
  results: WebSearchResult[];
  error?: string;
};

type SearchOptions = {
  maxResults?: number;
  region?: string;
  fetchImpl?: typeof fetch;
};

const DEFAULT_REGION = "au-en";
const DEFAULT_MAX_RESULTS = 8;

export async function searchWeb(query: string, options: SearchOptions = {}): Promise<WebSearchRun> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return { query, results: [], error: "Search query was empty." };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const region = options.region ?? DEFAULT_REGION;
  const apiKey = process.env.SERPER_API_KEY ?? "";

  if (apiKey) {
    return searchWithSerper(trimmedQuery, apiKey, fetchImpl, maxResults);
  }

  return searchWithDuckDuckGo(trimmedQuery, fetchImpl, maxResults, region);
}

async function searchWithSerper(
  query: string,
  apiKey: string,
  fetchImpl: typeof fetch,
  maxResults: number
): Promise<WebSearchRun> {
  try {
    const response = await fetchImpl("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ q: query, num: maxResults })
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      return { query, results: [], error: `Serper API returned ${response.status}: ${errorBody}` };
    }

    const data = (await response.json()) as {
      organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    };

    const results: WebSearchResult[] = (data.organic ?? [])
      .map((item) => {
        const url = item.link ?? "";
        const title = (item.title ?? "").trim();
        const snippet = (item.snippet ?? "").trim();
        if (!title || !url) return null;
        return {
          title,
          url,
          displayUrl: url,
          snippet,
          sourceDomain: normalizeDomain(url)
        };
      })
      .filter((r): r is WebSearchResult => r !== null);

    return { query, results };
  } catch (error) {
    return {
      query,
      results: [],
      error: error instanceof Error ? error.message : "Unknown Serper search error."
    };
  }
}

async function searchWithDuckDuckGo(
  query: string,
  fetchImpl: typeof fetch,
  maxResults: number,
  region: string
): Promise<WebSearchRun> {
  try {
    const body = new URLSearchParams({ q: query, kl: region });

    const response = await fetchImpl("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
      },
      body: body.toString()
    });

    if (!response.ok) {
      return { query, results: [], error: `DuckDuckGo returned ${response.status}.` };
    }

    const html = await response.text();
    return { query, results: parseDuckDuckGoResults(html).slice(0, maxResults) };
  } catch (error) {
    return {
      query,
      results: [],
      error: error instanceof Error ? error.message : "Unknown DuckDuckGo search error."
    };
  }
}

function parseDuckDuckGoResults(html: string) {
  const segments = html.split(/<div class="result results_links[^"]*">/g).slice(1);
  const results: WebSearchResult[] = [];

  for (const segment of segments) {
    if (segment.includes("badge--ad")) {
      continue;
    }

    const titleMatch = segment.match(/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) {
      continue;
    }

    const resolvedUrl = unwrapDuckDuckGoLink(titleMatch[1]);
    if (!resolvedUrl || !/^https?:\/\//i.test(resolvedUrl)) {
      continue;
    }

    const displayUrlMatch = segment.match(/class="result__url[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = segment.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    const title = cleanHtml(titleMatch[2]);
    const snippet = cleanHtml(snippetMatch?.[1] ?? "");
    const displayUrl = cleanHtml(displayUrlMatch?.[1] ?? resolvedUrl);
    const sourceDomain = normalizeDomain(resolvedUrl);

    if (!title || !sourceDomain) {
      continue;
    }

    results.push({
      title,
      url: resolvedUrl,
      displayUrl,
      snippet,
      sourceDomain
    });
  }

  return dedupeResults(results);
}

function unwrapDuckDuckGoLink(rawHref: string) {
  const absolute = rawHref.startsWith("//") ? `https:${rawHref}` : rawHref;

  try {
    const url = new URL(absolute);
    const redirectTarget = url.searchParams.get("uddg");
    return redirectTarget ? decodeURIComponent(redirectTarget) : absolute;
  } catch {
    return absolute;
  }
}

function cleanHtml(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/");
}

function normalizeDomain(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function dedupeResults(results: WebSearchResult[]) {
  const seen = new Set<string>();
  const unique: WebSearchResult[] = [];

  for (const result of results) {
    if (seen.has(result.url)) {
      continue;
    }
    seen.add(result.url);
    unique.push(result);
  }

  return unique;
}
