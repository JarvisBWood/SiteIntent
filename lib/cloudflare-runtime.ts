import { getCloudflareContext } from "@opennextjs/cloudflare";

export type CloudflareEnv = {
  DB?: D1Database;
  OPENAI_API_KEY?: string;
  DASH_ADMIN_EMAIL?: string;
  DASH_ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  SITEINTENT_PAGE_ANALYSIS_MODEL?: string;
  SITEINTENT_PAGE_ANALYSIS_LOCAL_MODEL?: string;
  SITEINTENT_DISCOVERABILITY_LOCAL_MODEL?: string;
  SITEINTENT_RANKABILITY_LOCAL_MODEL?: string;
  SITEINTENT_COMPETITOR_VALIDATION_LOCAL_MODEL?: string;
};

export function getCloudflareEnv(): CloudflareEnv | null {
  try {
    return getCloudflareContext().env as CloudflareEnv;
  } catch {
    return null;
  }
}

export function getD1Database(): D1Database | null {
  return getCloudflareEnv()?.DB ?? null;
}

export function isCloudflareRuntime() {
  return Boolean(getD1Database());
}
