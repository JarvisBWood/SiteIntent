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

// ── Remote D1 via Cloudflare API ──────────────────────────────────────────
//
// When CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_D1_DATABASE_ID
// are set in the environment, getD1Database() returns a client that talks to
// the remote Cloudflare D1 HTTP API instead of the local miniflare D1 binding.
// This lets local dev work against production/remote D1 databases.

type RemoteD1Row = Record<string, unknown>;

interface RemoteD1ApiError {
  errors: Array<{ code: number; message: string }>;
}

interface RemoteD1ApiResult {
  results: RemoteD1Row[];
  success: boolean;
  meta?: { changes?: number; duration?: number };
}

interface RemoteD1ApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
  result: RemoteD1ApiResult[];
}

type BindableValue = string | number | boolean | null;

class RemoteD1PreparedStatement {
  private sql: string;
  private params: BindableValue[] = [];

  constructor(sql: string) {
    this.sql = sql;
  }

  bind(...values: BindableValue[]): this {
    this.params = values;
    return this;
  }

  async first<T = unknown>(col?: string): Promise<T | null> {
    const results = await this.query<T>();
    const row = results[0] ?? null;
    if (row && col !== undefined) {
      return (row as Record<string, unknown>)[col] as T ?? null;
    }
    return row as T | null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const results = await this.query<T>();
    return { results, success: true };
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    await this.query<T>();
    return { success: true };
  }

  raw<T = unknown>(): Promise<T[]> {
    return this.query<T>();
  }

  toApiBody() {
    return { sql: this.sql, params: this.params };
  }

  private async query<T>(): Promise<T[]> {
    const body = this.toApiBody();
    const response = await fetchRemoteD1(body);
    const results = response.flatMap((r) => r.results as T[]);
    return results;
  }
}

class RemoteD1Database {
  prepare(sql: string): RemoteD1PreparedStatement {
    return new RemoteD1PreparedStatement(sql);
  }

  async batch<T = unknown>(statements: RemoteD1PreparedStatement[]): Promise<D1Result<T>[]> {
    const allResults: D1Result<T>[] = [];
    for (const stmt of statements) {
      const body = stmt.toApiBody();
      const response = await fetchRemoteD1(body);
      for (const r of response) {
        allResults.push({ results: r.results as T[], success: r.success });
      }
    }
    return allResults;
  }

  dump(): Promise<ArrayBuffer> {
    throw new Error("RemoteD1Database.dump() is not implemented");
  }

  async exec<T = unknown>(_sql: string): Promise<D1Result<T>[]> {
    throw new Error("RemoteD1Database.exec() is not implemented");
  }
}

let remoteD1: RemoteD1Database | null = null;

function getRemoteD1Config() {
  const token = process.env.CLOUDFLARE_API ?? process.env.CLOUDFLARE_API_TOKEN;
  const apiEmail = process.env.CLOUDFLARE_API_EMAIL;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  if ((token || apiEmail) && accountId && databaseId) {
    return { token, apiEmail, accountId, databaseId };
  }
  return null;
}

function buildAuthHeaders(config: {
  token?: string;
  apiEmail?: string;
}): Record<string, string> {
  if (config.apiEmail && config.token) {
    return { "X-Auth-Email": config.apiEmail, "X-Auth-Key": config.token };
  }
  return { Authorization: `Bearer ${config.token}` };
}

async function fetchRemoteD1(
  body: Record<string, unknown>
): Promise<RemoteD1ApiResult[]> {
  const config = getRemoteD1Config();
  if (!config) {
    throw new Error("Remote D1 is not configured. Set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_D1_DATABASE_ID.");
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildAuthHeaders(config),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    const msg = `D1 API error (${response.status}): ${text.length > 500 ? text.slice(0, 500) + "..." : text}`;
    throw new Error(msg);
  }

  const json = (await response.json()) as RemoteD1ApiResponse;

  if (!json.success) {
    const errors = json.errors?.map((e) => `[${e.code}] ${e.message}`).join(", ") ?? "unknown error";
    throw new Error(`D1 API error: ${errors}`);
  }

  return json.result;
}

export function getD1Database(): D1Database | null {
  const remoteConfig = getRemoteD1Config();
  if (remoteConfig) {
    if (!remoteD1) {
      remoteD1 = new RemoteD1Database();
    }
    return remoteD1 as unknown as D1Database;
  }

  return getCloudflareEnv()?.DB ?? null;
}

export function isCloudflareRuntime() {
  return Boolean(getCloudflareEnv());
}
