import { getIncludedPageRecords } from "@/lib/scan/storage";
import type { ProjectScanRun, SiteIntentSessionState } from "@/lib/site-state";
import { createEmptyState } from "@/lib/site-state";
import { getSqliteDb } from "@/lib/sqlite";

type StoredScanRow = Omit<ProjectScanRun, "websiteScanPages" | "pages">;

export function loadStateFromSqlite(): SiteIntentSessionState {
  const db = getSqliteDb();
  const sessionRow = db.prepare("SELECT data_json FROM app_session WHERE id = 1").get() as { data_json: string } | undefined;
  const uiStateRow = db.prepare("SELECT active_project_id FROM app_ui_state WHERE id = 1").get() as { active_project_id: string | null } | undefined;
  const projectRows = db.prepare("SELECT data_json FROM projects ORDER BY sort_order ASC").all() as Array<{ data_json: string }>;
  const targetIntentRows = db.prepare("SELECT project_id, data_json FROM target_intent_models").all() as Array<{ project_id: string; data_json: string }>;
  const onboardingRows = db.prepare("SELECT project_id, data_json FROM project_onboarding").all() as Array<{ project_id: string; data_json: string }>;
  const scanRows = db
    .prepare("SELECT id, data_json FROM scan_runs ORDER BY sort_order ASC")
    .all() as Array<{ id: string; data_json: string }>;
  const pageRows = db
    .prepare("SELECT scan_id, page_index, data_json FROM scan_pages ORDER BY scan_id ASC, page_index ASC")
    .all() as Array<{ scan_id: string; page_index: number; data_json: string }>;

  const pagesByScanId = new Map<string, unknown[]>();
  for (const row of pageRows) {
    const current = pagesByScanId.get(row.scan_id) ?? [];
    current.push(JSON.parse(row.data_json));
    pagesByScanId.set(row.scan_id, current);
  }

  const scanRuns = scanRows.map((row) => {
    const storedScan = JSON.parse(row.data_json) as StoredScanRow;
    const websiteScanPages = (pagesByScanId.get(row.id) ?? []) as ProjectScanRun["websiteScanPages"];
    return {
      ...storedScan,
      websiteScanPages,
      pages: getIncludedPageRecords({ websiteScanPages })
    } satisfies ProjectScanRun;
  });

  return {
    session: sessionRow ? JSON.parse(sessionRow.data_json) : null,
    projects: projectRows.map((row) => JSON.parse(row.data_json)),
    activeProjectId:
      uiStateRow?.active_project_id ??
      (scanRuns.length || projectRows.length ? scanRuns[0]?.projectId ?? JSON.parse(projectRows[0]?.data_json ?? "null")?.id ?? null : null),
    scanRuns,
    targetIntentModels: Object.fromEntries(targetIntentRows.map((row) => [row.project_id, JSON.parse(row.data_json)])),
    projectOnboarding: Object.fromEntries(onboardingRows.map((row) => [row.project_id, JSON.parse(row.data_json)]))
  };
}

export function saveStateToSqlite(state: SiteIntentSessionState) {
  const db = getSqliteDb();
  const transaction = db.transaction((nextState: SiteIntentSessionState) => {
    db.prepare("DELETE FROM app_session").run();
    db.prepare("DELETE FROM app_ui_state").run();
    db.prepare("DELETE FROM projects").run();
    db.prepare("DELETE FROM target_intent_models").run();
    db.prepare("DELETE FROM project_onboarding").run();
    db.prepare("DELETE FROM scan_pages").run();
    db.prepare("DELETE FROM scan_runs").run();

    if (nextState.session) {
      db.prepare("INSERT INTO app_session (id, data_json) VALUES (1, ?)").run(JSON.stringify(nextState.session));
    }
    db.prepare("INSERT INTO app_ui_state (id, active_project_id) VALUES (1, ?)").run(nextState.activeProjectId);

    const insertProject = db.prepare("INSERT INTO projects (id, sort_order, data_json) VALUES (?, ?, ?)");
    nextState.projects.forEach((project, index) => {
      insertProject.run(project.id, index, JSON.stringify(project));
    });

    const insertTargetIntent = db.prepare("INSERT INTO target_intent_models (project_id, data_json) VALUES (?, ?)");
    Object.entries(nextState.targetIntentModels).forEach(([projectId, model]) => {
      insertTargetIntent.run(projectId, JSON.stringify(model));
    });

    const insertOnboarding = db.prepare("INSERT INTO project_onboarding (project_id, data_json) VALUES (?, ?)");
    Object.entries(nextState.projectOnboarding).forEach(([projectId, onboarding]) => {
      insertOnboarding.run(projectId, JSON.stringify(onboarding));
    });

    const insertScan = db.prepare(
      "INSERT INTO scan_runs (id, project_id, sort_order, started_at, completed_at, data_json) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertPage = db.prepare("INSERT INTO scan_pages (scan_id, page_index, data_json) VALUES (?, ?, ?)");

    nextState.scanRuns.forEach((scan, scanIndex) => {
      const { websiteScanPages, pages: _pages, ...storedScan } = scan;
      insertScan.run(scan.id, scan.projectId, scanIndex, scan.startedAt, scan.completedAt, JSON.stringify(storedScan));
      websiteScanPages.forEach((page, pageIndex) => {
        insertPage.run(scan.id, pageIndex, JSON.stringify(page));
      });
    });
  });

  transaction(state);
}

export function ensureSqliteState() {
  try {
    return loadStateFromSqlite();
  } catch {
    return createEmptyState();
  }
}
