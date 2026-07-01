const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchWebsiteFavicon(websiteUrl: string): Promise<string | null> {
  try {
    const origin = new URL(websiteUrl).origin;
    const response = await fetch(websiteUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    });

    if (response.ok) {
      const html = await response.text();
      const candidates = extractIconCandidates(html, origin);
      if (candidates.length > 0) {
        return candidates[0];
      }
    }

    return (await probeDefaultFavicon(origin)) ?? buildFallbackFaviconServiceUrl(websiteUrl);
  } catch {
    return buildFallbackFaviconServiceUrl(websiteUrl);
  }
}

export function buildFallbackFaviconServiceUrl(websiteUrl: string) {
  try {
    const hostname = new URL(websiteUrl).hostname;
    return `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(hostname)}`;
  } catch {
    return null;
  }
}

function extractIconCandidates(html: string, origin: string) {
  const candidates: Array<{ href: string; score: number }> = [];
  const matches = html.matchAll(/<link[^>]+rel=["']([^"']+)["'][^>]+href=["']([^"']+)["'][^>]*>/gi);

  for (const match of matches) {
    const rel = match[1]?.toLowerCase() ?? "";
    const href = match[2]?.trim() ?? "";
    if (!href || !/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/i.test(rel)) {
      continue;
    }

    const resolved = toAbsoluteUrl(href, origin);
    if (!resolved) {
      continue;
    }

    candidates.push({
      href: resolved,
      score: scoreIcon(rel, resolved)
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .map((candidate) => candidate.href)
    .filter((href, index, list) => list.indexOf(href) === index);
}

function scoreIcon(rel: string, href: string) {
  let score = 0;
  if (rel.includes("apple-touch-icon")) score += 3;
  if (rel.includes("shortcut icon")) score += 2;
  if (/192|180|512|300|150/.test(href)) score += 2;
  if (href.endsWith(".png")) score += 1;
  return score;
}

async function probeDefaultFavicon(origin: string) {
  const defaultUrl = new URL("/favicon.ico", origin).toString();

  try {
    const response = await fetch(defaultUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    });
    return response.ok ? defaultUrl : null;
  } catch {
    return null;
  }
}

function toAbsoluteUrl(value: string, origin: string) {
  try {
    if (value.startsWith("//")) {
      return new URL(`https:${value}`).toString();
    }

    return new URL(value, origin).toString();
  } catch {
    return null;
  }
}
