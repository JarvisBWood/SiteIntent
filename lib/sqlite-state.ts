import {
  buildCategoryModel,
  buildObservedIntent,
  createTargetIntentModelFromObservedIntent
} from "@/lib/models";
import { getIncludedPageRecords } from "@/lib/scan/storage";
import type { ProjectScanRun, SiteIntentSessionState } from "@/lib/site-state";
import { createDefaultPreferences, createEmptyState, shortenDisplayUrl } from "@/lib/site-state";
import { getSqliteDb } from "@/lib/sqlite";

type StoredScanRow = Omit<ProjectScanRun, "websiteScanPages" | "pages">;

export function loadStateFromSqlite(): SiteIntentSessionState {
  const db = getSqliteDb();
  const sessionRow = db.prepare("SELECT data_json FROM app_session WHERE id = 1").get() as { data_json: string } | undefined;
  const uiStateRow = db
    .prepare("SELECT active_project_id, preferences_json, scan_progress_json FROM app_ui_state WHERE id = 1")
    .get() as { active_project_id: string | null; preferences_json: string | null; scan_progress_json: string | null } | undefined;
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
    scanProgressByProject: uiStateRow?.scan_progress_json ? JSON.parse(uiStateRow.scan_progress_json) : {},
    targetIntentModels: Object.fromEntries(targetIntentRows.map((row) => [row.project_id, JSON.parse(row.data_json)])),
    projectOnboarding: Object.fromEntries(onboardingRows.map((row) => [row.project_id, JSON.parse(row.data_json)])),
    preferences: uiStateRow?.preferences_json
      ? {
          ...createDefaultPreferences(),
          ...(JSON.parse(uiStateRow.preferences_json) as Partial<SiteIntentSessionState["preferences"]>)
        }
      : createDefaultPreferences()
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
    db
      .prepare("INSERT INTO app_ui_state (id, active_project_id, preferences_json, scan_progress_json) VALUES (1, ?, ?, ?)")
      .run(nextState.activeProjectId, JSON.stringify(nextState.preferences), JSON.stringify(nextState.scanProgressByProject));

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

export function updateScanProgressInSqlite(projectId: string, progress: SiteIntentSessionState["scanProgressByProject"][string]) {
  const db = getSqliteDb();
  const existingRow = db
    .prepare("SELECT active_project_id, preferences_json, scan_progress_json FROM app_ui_state WHERE id = 1")
    .get() as { active_project_id: string | null; preferences_json: string | null; scan_progress_json: string | null } | undefined;
  const existingProgress =
    existingRow?.scan_progress_json && existingRow.scan_progress_json.trim()
      ? (JSON.parse(existingRow.scan_progress_json) as SiteIntentSessionState["scanProgressByProject"])
      : {};

  const nextProgress = { ...existingProgress };
  if (progress == null) {
    delete nextProgress[projectId];
  } else {
    nextProgress[projectId] = progress;
  }

  db.prepare(
    "INSERT INTO app_ui_state (id, active_project_id, preferences_json, scan_progress_json) VALUES (1, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET active_project_id=excluded.active_project_id, preferences_json=excluded.preferences_json, scan_progress_json=excluded.scan_progress_json"
  ).run(
    existingRow?.active_project_id ?? null,
    existingRow?.preferences_json ?? JSON.stringify(createDefaultPreferences()),
    JSON.stringify(nextProgress)
  );
}

export function persistScanRunSnapshotInSqlite(scan: ProjectScanRun) {
  const db = getSqliteDb();
  const transaction = db.transaction((nextScan: ProjectScanRun) => {
    const existingRow = db
      .prepare("SELECT sort_order FROM scan_runs WHERE id = ?")
      .get(nextScan.id) as { sort_order: number } | undefined;
    const topRow = db
      .prepare("SELECT COALESCE(MIN(sort_order), 0) AS min_sort_order FROM scan_runs")
      .get() as { min_sort_order: number | null };
    const sortOrder = existingRow?.sort_order ?? Math.min((topRow.min_sort_order ?? 0) - 1, -1);
    const { websiteScanPages, pages: _pages, ...storedScan } = nextScan;

    db.prepare(
      "INSERT INTO scan_runs (id, project_id, sort_order, started_at, completed_at, data_json) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, started_at=excluded.started_at, completed_at=excluded.completed_at, data_json=excluded.data_json"
    ).run(nextScan.id, nextScan.projectId, sortOrder, nextScan.startedAt, nextScan.completedAt, JSON.stringify(storedScan));

    db.prepare("DELETE FROM scan_pages WHERE scan_id = ?").run(nextScan.id);
    const insertPage = db.prepare("INSERT INTO scan_pages (scan_id, page_index, data_json) VALUES (?, ?, ?)");
    nextScan.websiteScanPages.forEach((page, pageIndex) => {
      insertPage.run(nextScan.id, pageIndex, JSON.stringify(page));
    });
  });

  transaction(scan);
}

export function persistCompletedScanInSqlite(scan: ProjectScanRun) {
  const currentState = ensureSqliteState();
  const project = currentState.projects.find((entry) => entry.id === scan.projectId);
  if (!project) {
    return;
  }

  const autoCompetitorUrls = scan.competitorAnalyses?.map((analysis) => analysis.url) ?? [];
  const updatedProject = {
    ...project,
    competitorUrls: autoCompetitorUrls,
    competitorDisplayUrls: autoCompetitorUrls.map((value) => shortenDisplayUrl(value)),
    competitorFaviconUrls: autoCompetitorUrls.map(() => null),
    competitorAnalysesByUrl: Object.fromEntries((scan.competitorAnalyses ?? []).map((analysis) => [analysis.url, analysis])),
    updatedAt: scan.completedAt ?? new Date().toISOString()
  };

  const categoryModel = buildCategoryModel({
    project: updatedProject,
    latestScan: scan,
    competitorAnalyses: scan.competitorAnalyses ?? []
  });
  const observedIntent =
    scan.observedIntent ??
    buildObservedIntent({
      categoryModel,
      latestScan: scan,
      competitorAnalyses: scan.competitorAnalyses ?? [],
      metrics: scan.rankability ?? null
    });

  const nextScanRuns = [scan, ...currentState.scanRuns.filter((entry) => entry.id !== scan.id)];
  const existingOnboarding = currentState.projectOnboarding[scan.projectId];
  const nextState: SiteIntentSessionState = {
    ...currentState,
    projects: currentState.projects.map((entry) => (entry.id === scan.projectId ? updatedProject : entry)),
    activeProjectId: scan.projectId,
    scanRuns: nextScanRuns,
    scanProgressByProject: {
      ...currentState.scanProgressByProject,
      [scan.projectId]: null
    },
    targetIntentModels: currentState.targetIntentModels[scan.projectId]
      ? currentState.targetIntentModels
      : {
          ...currentState.targetIntentModels,
          [scan.projectId]: createTargetIntentModelFromObservedIntent(observedIntent)
        },
    projectOnboarding: {
      ...currentState.projectOnboarding,
      [scan.projectId]: {
        ...existingOnboarding,
        status: scan.scanMode === "competitors" ? "competitor_scored" : "website_scored",
        observedIntent,
        firstScanAt: existingOnboarding?.firstScanAt ?? scan.completedAt ?? new Date().toISOString(),
        reviewedAt: existingOnboarding?.reviewedAt ?? null,
        backgroundScanStartedAt: scan.scanMode === "full" ? existingOnboarding?.backgroundScanStartedAt ?? null : null,
        reviewModalOpen: false
      }
    }
  };

  saveStateToSqlite(nextState);
}
