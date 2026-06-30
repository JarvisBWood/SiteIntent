import type { CompetitorAnalysis } from "@/lib/models";
import type {
  AnalysisPassName,
  AnalysisPassResult,
  PageOutput,
  PageScanRecord,
  ProjectScanRequest,
  ProjectScanRun,
  WebsiteScan,
  WebsiteScanPage
} from "@/lib/scan/types";

export type { AnalysisPassName, AnalysisPassResult, PageOutput, PageScanRecord, ProjectScanRequest, ProjectScanRun, WebsiteScan, WebsiteScanPage };

export type SiteIntentSession = {
  displayName: string;
  signedInAt: string;
};

export type SiteIntentProject = {
  id: string;
  name: string;
  websiteUrl: string;
  websiteDisplayUrl: string;
  websiteFaviconUrl: string | null;
  competitorUrls: string[];
  competitorDisplayUrls: string[];
  competitorFaviconUrls: Array<string | null>;
  competitorAnalysesByUrl: Record<string, CompetitorAnalysis>;
  competitorRefreshStatusByUrl: Record<string, CompetitorRefreshStatus>;
  scanDepth: number;
  createdAt: string;
  updatedAt: string;
};

export type CompetitorRefreshStatus = {
  status: "idle" | "scanning";
  startedAt: string | null;
  completedAt: string | null;
};

export type ObservedIntent = {
  topic: string;
  audience: string[];
  problem: string[];
  outcome: string[];
  confidence: {
    score: number;
    reason: string;
  };
  updatedAt: string;
};

export type TargetIntentModel = {
  category: string;
  lockedConcepts: string[];
  removableConcepts: string[];
  addableConcepts: string[];
  notes: string;
  updatedAt: string;
  isUserOwned?: boolean;
};

export type ProjectOnboardingState = {
  status:
    | "idle"
    | "setup_completed"
    | "website_scanning"
    | "website_scored"
    | "competitor_scoring"
    | "competitor_scored";
  observedIntent: ObservedIntent | null;
  firstScanAt: string | null;
  reviewedAt: string | null;
  backgroundScanStartedAt?: string | null;
  reviewModalOpen?: boolean;
};

export type SiteIntentSessionState = {
  session: SiteIntentSession | null;
  projects: SiteIntentProject[];
  activeProjectId: string | null;
  scanRuns: ProjectScanRun[];
  targetIntentModels: Record<string, TargetIntentModel>;
  projectOnboarding: Record<string, ProjectOnboardingState>;
};

export type SiteIntentProjectDraft = {
  name: string;
  websiteUrl: string;
  competitorUrls: string[];
  scanDepth: number;
};

export function createEmptyState(): SiteIntentSessionState {
  return {
    session: null,
    projects: [],
    activeProjectId: null,
    scanRuns: [],
    targetIntentModels: {},
    projectOnboarding: {}
  };
}

export function buildProjectDraft(websiteUrl: string): string {
  try {
    const url = new URL(normalizeUrlLikeInput(websiteUrl));
    return url.hostname.replace(/^www\./i, "") || "Untitled project";
  } catch {
    return "Untitled project";
  }
}

export function normalizeUrlLikeInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function validateHttpUrl(value: string) {
  if (!value.trim()) {
    return "Website URL is required.";
  }

  try {
    const url = new URL(normalizeUrlLikeInput(value));
    if (!["http:", "https:"].includes(url.protocol)) {
      return "Website URL must use http or https.";
    }
    return "";
  } catch {
    return "Enter a valid website URL.";
  }
}

export function validateCompetitorUrl(value: string) {
  if (!value.trim()) {
    return "";
  }

  try {
    const url = new URL(normalizeUrlLikeInput(value));
    if (!["http:", "https:"].includes(url.protocol)) {
      return "Use an http or https competitor URL.";
    }
    return "";
  } catch {
    return "Enter a valid competitor URL.";
  }
}

export function sanitizeProjectName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function sanitizeWebsiteUrl(value: string) {
  return normalizeUrlLikeInput(value).trim();
}

export function sanitizeCompetitorUrls(values: string[]) {
  return values.map((value) => normalizeUrlLikeInput(value).trim()).filter(Boolean);
}

export function shortenDisplayUrl(value: string) {
  const normalized = normalizeUrlLikeInput(value);
  if (!normalized) {
    return "";
  }

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.replace(/^www\./i, "");
    const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    const search = url.search;
    const hash = url.hash;
    return `${hostname}${pathname}${search}${hash}`;
  } catch {
    return normalized.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  }
}

export function ensureProjectName(name: string, websiteUrl: string) {
  const sanitized = sanitizeProjectName(name);
  if (sanitized) {
    return sanitized;
  }

  return buildProjectDraft(websiteUrl);
}

export function normalizeProjectScanDepth(value: unknown) {
  const numeric = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric)) {
    return 1;
  }

  // Legacy builds stored a page-count here, so collapse large values to the new default depth.
  if (numeric > 5) {
    return 1;
  }

  return Math.min(Math.max(numeric, 0), 5);
}
