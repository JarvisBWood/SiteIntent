import { cookies } from "next/headers";

import { getCloudflareEnv, getD1Database, isCloudflareRuntime } from "@/lib/cloudflare-runtime";
import type { SiteIntentSession } from "@/lib/site-state";

const SESSION_COOKIE = "siteintent_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

type UserRecord = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
};

type SessionRecord = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
};

export async function getRequestSession(): Promise<SiteIntentSession | null> {
  const cookieStore = await cookies();
  const token = await readSignedSessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!token) {
    return null;
  }

  const tokenHash = await sha256Hex(token);
  const session = await getSessionByHash(tokenHash);
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    await clearSessionCookie();
    return null;
  }

  const user = await getUserById(session.user_id);
  if (!user) {
    await clearSessionCookie();
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    signedInAt: session.created_at
  };
}

export async function requireRequestSession() {
  const session = await getRequestSession();
  if (!session) {
    throw new AuthError();
  }

  return session;
}

export async function signInWithPassword(email: string, password: string): Promise<SiteIntentSession> {
  const normalizedEmail = email.trim().toLowerCase();
  await bootstrapAdminUserIfNeeded();
  const user = await getUserByEmail(normalizedEmail);

  if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
    throw new Error("Invalid email or password.");
  }

  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
  await createSession({
    id: crypto.randomUUID(),
    user_id: user.id,
    token_hash: await sha256Hex(token),
    expires_at: expiresAt,
    created_at: now.toISOString()
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, await signSessionToken(token), {
    httpOnly: true,
    sameSite: "lax",
    secure: isCloudflareRuntime() || process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    signedInAt: now.toISOString()
  };
}

export async function signOutCurrentSession() {
  const cookieStore = await cookies();
  const token = await readSignedSessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (token) {
    await deleteSessionByHash(await sha256Hex(token));
  }
  await clearSessionCookie();
}

export function isAuthError(error: unknown) {
  return error instanceof AuthError;
}

export class AuthError extends Error {
  constructor() {
    super("Authentication required.");
  }
}

async function bootstrapAdminUserIfNeeded() {
  const existingCount = await getUserCount();
  if (existingCount > 0) {
    return;
  }

  const credentials = getAdminCredentials();
  if (!credentials.email || !credentials.password) {
    throw new Error("Admin credentials are not configured.");
  }

  const salt = randomToken();
  const now = new Date().toISOString();
  await createUser({
    id: crypto.randomUUID(),
    email: credentials.email.toLowerCase(),
    display_name: credentials.email,
    password_hash: await hashPassword(credentials.password, salt),
    password_salt: salt,
    created_at: now
  });
}

function getAdminCredentials() {
  const env = getCloudflareEnv();
  const fallbackAllowed = !isCloudflareRuntime() && process.env.NODE_ENV !== "production";
  return {
    email: env?.DASH_ADMIN_EMAIL ?? process.env.DASH_ADMIN_EMAIL ?? (fallbackAllowed ? "admin@localhost" : ""),
    password: env?.DASH_ADMIN_PASSWORD ?? process.env.DASH_ADMIN_PASSWORD ?? (fallbackAllowed ? "password" : "")
  };
}

async function getUserCount() {
  const db = getD1Database();
  if (db) {
    const row = await db.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
    return row?.count ?? 0;
  }

  const sqlite = await getLocalSqliteDb();
  const row = sqlite.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  return row.count;
}

async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const db = getD1Database();
  if (db) {
    return (await db.prepare("SELECT * FROM users WHERE email = ? LIMIT 1").bind(email).first<UserRecord>()) ?? null;
  }

  const sqlite = await getLocalSqliteDb();
  return (sqlite.prepare("SELECT * FROM users WHERE email = ? LIMIT 1").get(email) as UserRecord | undefined) ?? null;
}

async function getUserById(userId: string): Promise<UserRecord | null> {
  const db = getD1Database();
  if (db) {
    return (await db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(userId).first<UserRecord>()) ?? null;
  }

  const sqlite = await getLocalSqliteDb();
  return (sqlite.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(userId) as UserRecord | undefined) ?? null;
}

async function createUser(user: UserRecord) {
  const db = getD1Database();
  if (db) {
    await db.prepare(
      "INSERT INTO users (id, email, display_name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(user.id, user.email, user.display_name, user.password_hash, user.password_salt, user.created_at).run();
    return;
  }

  const sqlite = await getLocalSqliteDb();
  sqlite
    .prepare("INSERT INTO users (id, email, display_name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(user.id, user.email, user.display_name, user.password_hash, user.password_salt, user.created_at);
}

async function createSession(session: SessionRecord) {
  const db = getD1Database();
  if (db) {
    await db.prepare(
      "INSERT INTO user_sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(session.id, session.user_id, session.token_hash, session.expires_at, session.created_at).run();
    return;
  }

  const sqlite = await getLocalSqliteDb();
  sqlite
    .prepare("INSERT INTO user_sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(session.id, session.user_id, session.token_hash, session.expires_at, session.created_at);
}

async function getSessionByHash(tokenHash: string): Promise<SessionRecord | null> {
  const db = getD1Database();
  if (db) {
    return (await db.prepare("SELECT * FROM user_sessions WHERE token_hash = ? LIMIT 1").bind(tokenHash).first<SessionRecord>()) ?? null;
  }

  const sqlite = await getLocalSqliteDb();
  return (sqlite.prepare("SELECT * FROM user_sessions WHERE token_hash = ? LIMIT 1").get(tokenHash) as SessionRecord | undefined) ?? null;
}

async function deleteSessionByHash(tokenHash: string) {
  const db = getD1Database();
  if (db) {
    await db.prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(tokenHash).run();
    return;
  }

  const sqlite = await getLocalSqliteDb();
  sqlite.prepare("DELETE FROM user_sessions WHERE token_hash = ?").run(tokenHash);
}

async function getLocalSqliteDb() {
  const { getSqliteDb } = await import("@/lib/sqlite");
  return getSqliteDb();
}

async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isCloudflareRuntime() || process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

async function hashPassword(password: string, salt: string) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      iterations: 100_000
    },
    keyMaterial,
    256
  );

  return bytesToHex(new Uint8Array(derivedBits));
}

async function verifyPassword(password: string, salt: string, expectedHash: string) {
  return timingSafeEqual(await hashPassword(password, salt), expectedHash);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function signSessionToken(token: string) {
  return `${token}.${await hmacHex(token, getSessionSecret())}`;
}

async function readSignedSessionToken(value: string | undefined) {
  if (!value) {
    return "";
  }

  const [token, signature] = value.split(".");
  if (!token || !signature) {
    return "";
  }

  const expectedSignature = await hmacHex(token, getSessionSecret());
  return timingSafeEqual(signature, expectedSignature) ? token : "";
}

async function hmacHex(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(signature));
}

function getSessionSecret() {
  const env = getCloudflareEnv();
  const secret = env?.SESSION_SECRET ?? process.env.SESSION_SECRET;
  if (secret?.trim()) {
    return secret;
  }

  if (!isCloudflareRuntime() && process.env.NODE_ENV !== "production") {
    return "siteintent-local-development-session-secret";
  }

  throw new Error("SESSION_SECRET is required.");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
