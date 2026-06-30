import { createHash } from "node:crypto";

import {
  type CrawlSeed,
  type HeadingRecord,
  type PageDiscoveryRecord,
  type PageExtraction,
  type PageMetadata,
  type PageType,
  type ScanDiscoverySource,
  type WebsiteScanPage
} from "@/lib/scan/types";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_DISCOVERY_PAGES = 100;
const EXCLUDED_PATH_PATTERNS = [
  ["/privacy", "privacy"],
  ["policy", "policy"],
  ["/terms", "terms"],
  ["/legal", "legal"],
  ["/login", "login"],
  ["/cart", "cart"],
  ["/checkout", "checkout"],
  ["/signup", "signup"],
  ["/sign-up", "sign-up"],
  ["/get-started", "get-started"],
  ["/support", "support"],
  ["/account", "account"],
  ["/admin", "admin"],
  ["/wp-login", "wp-login"]
] as const;
const EXCLUDED_FILE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico", ".bmp", ".tif", ".tiff",
  ".pdf", ".zip", ".rar", ".7z", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".mp3", ".mp4", ".mov", ".avi", ".csv", ".xml", ".json", ".txt"
]);

export async function crawlSite(request: {
  websiteUrl: string;
  scanDepth: number;
  homepageOnly?: boolean;
  scanId?: string;
}): Promise<{ seeds: CrawlSeed[]; websiteScanPages: WebsiteScanPage[]; pagesToAnalyze: PageExtraction[]; errors: string[] }> {
  const normalizedStartUrl = normalizeUrl(request.websiteUrl);
  if (!normalizedStartUrl) {
    return { seeds: [], websiteScanPages: [], pagesToAnalyze: [], errors: ["Invalid start URL."] };
  }

  const startUrl = normalizedStartUrl;
  const origin = new URL(startUrl).origin;
  const errors: string[] = [];
  const discovery = new Map<string, PageDiscoveryRecord>();
  const queue: Array<{ url: string; depth: number }> = [];
  const websiteScanPages: WebsiteScanPage[] = [];
  const pagesToAnalyze: PageExtraction[] = [];
  const visited = new Set<string>();
  const maxDepth = request.homepageOnly ? 0 : Math.max(request.scanDepth, 0);

  function buildStoredPage(input: Omit<WebsiteScanPage, "id" | "scanId">): WebsiteScanPage {
    return {
      id: crypto.randomUUID(),
      scanId: request.scanId ?? "",
      ...input
    };
  }

  async function addSeed(url: string, source: ScanDiscoverySource, depth = 0) {
    const normalized = normalizeInternalUrl(url, origin);
    if (!normalized) {
      return;
    }

    if (discovery.size >= MAX_DISCOVERY_PAGES && !discovery.has(normalized)) {
      return;
    }

    const existing = discovery.get(normalized);
    if (existing) {
      if (!existing.discoverySources.includes(source)) {
        existing.discoverySources.push(source);
      }
      existing.depth = Math.min(existing.depth, depth);
      return;
    }

    const record = {
      url: normalized,
      discoverySources: [source],
      depth
    };

    discovery.set(normalized, record);
    queue.push({ url: normalized, depth });
  }

  await addSeed(startUrl, "internal-link", 0);

  queue.sort((a, b) => a.url.localeCompare(b.url));

  while (queue.length && websiteScanPages.length < MAX_DISCOVERY_PAGES) {
    const next = queue.shift();
    if (!next) {
      break;
    }

    if (visited.has(next.url) || next.depth > maxDepth) {
      continue;
    }
    visited.add(next.url);

    const discoveryRecord = discovery.get(next.url);
    const exclusionReason = classifyExclusion(next.url);
    if (exclusionReason) {
      websiteScanPages.push(
        buildStoredPage({
          url: next.url,
          normalizedUrl: next.url,
          pageType: detectPageType(next.url, emptyMetadata(next.url), ""),
          pageTitle: "",
          metaTitle: "",
          metaDescription: "",
          h1: "",
          headings: [],
          mainText: "",
          wordCount: 0,
          contentHash: "",
          httpStatus: null,
          crawlDepth: next.depth,
          includeInScoring: false,
          exclusionReason,
          scrapeTimestamp: new Date().toISOString(),
          internalLinks: [],
          discoverySources: discoveryRecord?.discoverySources ?? ["internal-link"],
          canonicalUrl: null
        })
      );
      continue;
    }

    try {
      const extraction = await extractPage(next.url, origin, next.depth);
      if (!extraction) {
        websiteScanPages.push(
          buildStoredPage({
            url: next.url,
            normalizedUrl: next.url,
            pageType: detectPageType(next.url, emptyMetadata(next.url), ""),
            pageTitle: "",
            metaTitle: "",
            metaDescription: "",
            h1: "",
            headings: [],
            mainText: "",
            wordCount: 0,
            contentHash: "",
            httpStatus: null,
            crawlDepth: next.depth,
            includeInScoring: false,
            exclusionReason: "fetch-failed",
            scrapeTimestamp: new Date().toISOString(),
            internalLinks: [],
            discoverySources: discoveryRecord?.discoverySources ?? ["internal-link"],
            canonicalUrl: null
          })
        );
        continue;
      }

      const isHtmlContent =
        extraction.contentType.includes("text/html") || extraction.contentType.includes("application/xhtml+xml");
      if (!isHtmlContent) {
        websiteScanPages.push(
          buildStoredPage({
            url: extraction.url,
            normalizedUrl: extraction.normalizedUrl,
            pageType: extraction.pageType,
            pageTitle: "",
            metaTitle: "",
            metaDescription: "",
            h1: "",
            headings: [],
            mainText: "",
            wordCount: 0,
            contentHash: "",
            httpStatus: extraction.httpStatus,
            crawlDepth: extraction.crawlDepth,
            includeInScoring: false,
            exclusionReason: "non-html",
            scrapeTimestamp: extraction.scrapeTimestamp,
            internalLinks: [],
            discoverySources: discoveryRecord?.discoverySources ?? ["internal-link"],
            canonicalUrl: null
          })
        );
        continue;
      }

      websiteScanPages.push(
        buildStoredPage({
          url: extraction.url,
          normalizedUrl: extraction.normalizedUrl,
          pageType: extraction.pageType,
          pageTitle: extraction.metadata.title,
          metaTitle: extraction.metadata.metaTitle,
          metaDescription: extraction.metadata.metaDescription,
          h1: extraction.metadata.h1,
          headings: extraction.metadata.headings,
          mainText: extraction.mainText,
          wordCount: extraction.wordCount,
          contentHash: extraction.contentHash,
          httpStatus: extraction.httpStatus,
          crawlDepth: extraction.crawlDepth,
          includeInScoring: true,
          exclusionReason: "",
          scrapeTimestamp: extraction.scrapeTimestamp,
          internalLinks: extraction.internalLinks,
          discoverySources: discoveryRecord?.discoverySources ?? ["internal-link"],
          canonicalUrl: extraction.metadata.canonicalUrl
        })
      );
      pagesToAnalyze.push(extraction);

      if (next.depth < maxDepth) {
        for (const link of extraction.internalLinks) {
          const normalized = normalizeInternalUrl(link, origin);
          if (!normalized || visited.has(normalized)) {
            continue;
          }

          const existing = discovery.get(normalized);
          if (existing) {
            if (!existing.discoverySources.includes("internal-link")) {
              existing.discoverySources.push("internal-link");
            }
            existing.depth = Math.min(existing.depth, next.depth + 1);
          } else if (discovery.size < MAX_DISCOVERY_PAGES) {
            discovery.set(normalized, {
              url: normalized,
              discoverySources: ["internal-link"],
              depth: next.depth + 1
            });
            queue.push({ url: normalized, depth: next.depth + 1 });
          }
        }
      }
    } catch (error) {
      errors.push(formatError(error, `Failed to extract ${next.url}.`));
      websiteScanPages.push(
        buildStoredPage({
          url: next.url,
          normalizedUrl: next.url,
          pageType: detectPageType(next.url, emptyMetadata(next.url), ""),
          pageTitle: "",
          metaTitle: "",
          metaDescription: "",
          h1: "",
          headings: [],
          mainText: "",
          wordCount: 0,
          contentHash: "",
          httpStatus: null,
          crawlDepth: next.depth,
          includeInScoring: false,
          exclusionReason: "fetch-error",
          scrapeTimestamp: new Date().toISOString(),
          internalLinks: [],
          discoverySources: discoveryRecord?.discoverySources ?? ["internal-link"],
          canonicalUrl: null
        })
      );
    }

    queue.sort((a, b) => a.url.localeCompare(b.url));
  }

  return {
    seeds: [...discovery.values()].sort((a, b) => a.url.localeCompare(b.url)),
    websiteScanPages,
    pagesToAnalyze,
    errors
  };
}

async function extractPage(url: string, origin: string, crawlDepth: number): Promise<PageExtraction | null> {
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return {
        url,
        normalizedUrl: url,
        pageType: detectPageType(url, emptyMetadata(url), ""),
        metadata: emptyMetadata(url),
        mainText: "",
        excerpt: "",
        internalLinks: [],
        wordCount: 0,
        contentHash: "",
        httpStatus: response.status,
        contentType,
        crawlDepth,
        scrapeTimestamp: new Date().toISOString()
      };
  }

  const html = await response.text();
  const metadata = extractMetadata(html, url);
  const mainText = extractMainText(html);
  const pageType = detectPageType(url, metadata, mainText);
  const internalLinks = extractInternalLinks(html, origin, url);
  const wordCount = countWords(mainText);
  const scrapeTimestamp = new Date().toISOString();

  return {
    url,
    normalizedUrl: url,
    pageType,
    metadata,
    mainText,
    excerpt: mainText.slice(0, 4000),
    internalLinks,
    wordCount,
    contentHash: hashContent(mainText),
    httpStatus: response.status,
    contentType,
    crawlDepth,
    scrapeTimestamp
  };
}

function emptyMetadata(url: string): PageMetadata {
  return {
    title: inferTitleFromUrl(url),
    metaTitle: "",
    metaDescription: "",
    canonicalUrl: null,
    h1: "",
    headings: []
  };
}

function extractMetadata(html: string, url: string): PageMetadata {
  const headings = extractHeadings(html);
  const h1 = headings.find((heading) => heading.level === "h1")?.text ?? "";

  return {
    title: extractTagText(html, "title") || inferTitleFromUrl(url),
    metaTitle: extractMetaTitle(html),
    metaDescription: extractMetaContent(html, "description"),
    canonicalUrl: extractCanonicalUrl(html, url),
    h1,
    headings
  };
}

function extractMainText(html: string) {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  return decodeHtml(
    withoutNoise
      .replace(/<\/p>|<\/div>|<\/section>|<\/article>|<\/li>|<\/h[1-6]>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function extractInternalLinks(html: string, origin: string, currentUrl: string) {
  const links = new Set<string>();
  const hrefMatches = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)];

  for (const match of hrefMatches) {
    const href = match[1]?.trim();
    if (!href) {
      continue;
    }

    const normalized = normalizeInternalUrl(href, origin, currentUrl);
    if (normalized) {
      links.add(normalized);
    }
  }

  return [...links].sort((a, b) => a.localeCompare(b));
}

function detectPageType(url: string, metadata: PageMetadata, content: string): PageType {
  const path = new URL(url).pathname.toLowerCase();
  const haystack = `${metadata.title} ${metadata.metaDescription} ${content}`.toLowerCase();

  if (path === "/" || path === "/index.html") {
    return "homepage";
  }
  if (path.includes("/pricing") || haystack.includes("pricing")) {
    return "pricing";
  }
  if (path.includes("/blog") || path.includes("/news") || haystack.includes("blog")) {
    return "blog";
  }
  if (path.includes("/docs") || path.includes("/help") || haystack.includes("documentation")) {
    return "docs";
  }
  if (path.includes("/product") || path.includes("/solution") || path.includes("/feature")) {
    return "product";
  }
  if (path.includes("/about")) {
    return "about";
  }
  if (path.includes("/contact")) {
    return "contact";
  }

  return "content";
}

function extractHeadings(html: string): HeadingRecord[] {
  const headings: HeadingRecord[] = [];

  for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
    const matches = [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))];
    for (const match of matches) {
      const text = decodeHtml(match[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "");
      if (text) {
        headings.push({ level: tag, text });
      }
    }
  }

  return headings.slice(0, 20);
}

function extractTagText(html: string, tag: string) {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeHtml(match?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "");
}

function extractMetaTitle(html: string) {
  return (
    extractMetaContent(html, "title") ||
    extractMetaProperty(html, "og:title") ||
    extractMetaProperty(html, "twitter:title")
  );
}

function extractMetaContent(html: string, name: string) {
  const match = html.match(new RegExp(`<meta[^>]+name=["']${escapeRegExp(name)}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"))
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escapeRegExp(name)}["'][^>]*>`, "i"));
  return decodeHtml(match?.[1]?.trim() ?? "");
}

function extractMetaProperty(html: string, property: string) {
  const match = html.match(new RegExp(`<meta[^>]+property=["']${escapeRegExp(property)}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"))
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escapeRegExp(property)}["'][^>]*>`, "i"));
  return decodeHtml(match?.[1]?.trim() ?? "");
}

function extractCanonicalUrl(html: string, pageUrl: string) {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i);
  if (!match?.[1]) {
    return null;
  }

  try {
    return new URL(match[1], pageUrl).toString();
  } catch {
    return null;
  }
}

function normalizeInternalUrl(value: string, origin: string, currentUrl?: string) {
  if (!value || value.startsWith("mailto:") || value.startsWith("tel:") || value.startsWith("javascript:")) {
    return null;
  }

  try {
    const url = new URL(value, currentUrl ?? origin);
    if (url.origin !== origin) {
      return null;
    }

    url.hash = "";
    if (url.pathname.endsWith("/index.html")) {
      url.pathname = url.pathname.replace(/\/index\.html$/i, "/");
    }
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return null;
  }
}

function normalizeUrl(value: string, origin?: string) {
  try {
    const url = new URL(value, origin ?? value);
    url.hash = "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function classifyExclusion(url: string) {
  const parsed = new URL(url);
  const path = parsed.pathname.toLowerCase();

  for (const [needle, reason] of EXCLUDED_PATH_PATTERNS) {
    if (path.includes(needle)) {
      return reason;
    }
  }

  for (const extension of EXCLUDED_FILE_EXTENSIONS) {
    if (path.endsWith(extension)) {
      return extension === ".jpg" || extension === ".jpeg" || extension === ".png" || extension === ".gif" || extension === ".svg" || extension === ".webp" || extension === ".ico" || extension === ".bmp" || extension === ".tif" || extension === ".tiff"
        ? "image"
        : "file-download";
    }
  }

  return "";
}

function hashContent(value: string) {
  if (!value) {
    return "";
  }

  return createHash("sha256").update(value).digest("hex");
}

function countWords(value: string) {
  if (!value.trim()) {
    return 0;
  }

  return value.trim().split(/\s+/).length;
}

function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  return fetch(url, {
    ...init,
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function inferTitleFromUrl(url: string) {
  const pathname = new URL(url).pathname.replace(/\/$/, "");
  if (!pathname) {
    return "Homepage";
  }

  const lastSegment = pathname.split("/").pop() ?? "Page";
  return lastSegment
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return `${fallback} ${error.message}`;
  }

  return fallback;
}
