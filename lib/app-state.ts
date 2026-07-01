import { getD1Database } from "@/lib/cloudflare-runtime";
import {
  ensureD1State,
  persistCompletedScanInD1,
  persistScanRunSnapshotInD1,
  saveStateToD1,
  updateScanProgressInD1
} from "@/lib/d1-state";
import type { ProjectScanRun, SiteIntentSessionState } from "@/lib/site-state";

export async function loadAppState() {
  const db = getD1Database();
  if (db) {
    return ensureD1State(db);
  }

  const { ensureSqliteState } = await import("@/lib/sqlite-state");
  return ensureSqliteState();
}

export async function saveAppState(state: SiteIntentSessionState) {
  const db = getD1Database();
  if (db) {
    await saveStateToD1(db, state);
    return;
  }

  const { saveStateToSqlite } = await import("@/lib/sqlite-state");
  saveStateToSqlite(state);
}

export async function updateScanProgress(projectId: string, progress: SiteIntentSessionState["scanProgressByProject"][string]) {
  const db = getD1Database();
  if (db) {
    await updateScanProgressInD1(db, projectId, progress);
    return;
  }

  const { updateScanProgressInSqlite } = await import("@/lib/sqlite-state");
  updateScanProgressInSqlite(projectId, progress);
}

export async function persistScanRunSnapshot(scan: ProjectScanRun) {
  const db = getD1Database();
  if (db) {
    await persistScanRunSnapshotInD1(db, scan);
    return;
  }

  const { persistScanRunSnapshotInSqlite } = await import("@/lib/sqlite-state");
  persistScanRunSnapshotInSqlite(scan);
}

export async function persistCompletedScan(scan: ProjectScanRun) {
  const db = getD1Database();
  if (db) {
    await persistCompletedScanInD1(db, scan);
    return;
  }

  const { persistCompletedScanInSqlite } = await import("@/lib/sqlite-state");
  persistCompletedScanInSqlite(scan);
}
