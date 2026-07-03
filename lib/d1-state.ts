import {
  buildCategoryModel,
  buildObservedIntent,
  createTargetIntentModelFromObservedIntent
} from "@/lib/models";
import { getIncludedPageRecords } from "@/lib/scan/storage";
import type { ProjectScanRun, SiteIntentSessionState } from "@/lib/site-state";
import { createDefaultPreferences, createEmptyState, shortenDisplayUrl } from "@/lib/site-state";

type StoredScanRow = Omit<ProjectScanRun, "websiteScanPages" | "pages">;

type JsonRow = { data_json: string };
type UiStateRow = { active_project_id: string | null; preferences_json: string | null; scan_progress_json: string | null };
type TargetIntentRow = { project_id: string; data_json: string };
type PageRow = { scan_id: string; page_index: number; data_json: string };
type ScanRow = { id: string; data_json: string };

export async function loadStateFromD1(db: D1Database): Promise<SiteIntentSessionState> {
  const [uiStateRow, projectRows, targetIntentRows, onboardingRows, scanRows, pageRows] = await Promise.all([
    db.prepare("SELECT active_project_id, preferences_json, scan_progress_json FROM app_ui_state WHERE id = 1").first<UiStateRow>(),
    db.prepare("SELECT data_json FROM projects ORDER BY sort_order ASC").all<JsonRow>(),
    db.prepare("SELECT project_id, data_json FROM target_intent_models").all<TargetIntentRow>(),
    db.prepare("SELECT project_id, data_json FROM project_onboarding").all<TargetIntentRow>(),
    db.prepare("SELECT id, data_json FROM scan_runs ORDER BY sort_order ASC").all<ScanRow>(),
    db.prepare("SELECT scan_id, page_index, data_json FROM scan_pages ORDER BY scan_id ASC, page_index ASC").all<PageRow>()
  ]);

  const pagesByScanId = new Map<string, unknown[]>();
  for (const row of pageRows.results ?? []) {
    const current = pagesByScanId.get(row.scan_id) ?? [];
    current.push(JSON.parse(row.data_json));
    pagesByScanId.set(row.scan_id, current);
  }

  const scanRuns = (scanRows.results ?? []).map((row) => {
    const storedScan = JSON.parse(row.data_json) as StoredScanRow;
    const websiteScanPages = (pagesByScanId.get(row.id) ?? []) as ProjectScanRun["websiteScanPages"];
    return {
      ...storedScan,
      websiteScanPages,
      pages: getIncludedPageRecords({ websiteScanPages })
    } satisfies ProjectScanRun;
  });

  return {
    session: null,
    projects: (projectRows.results ?? []).map((row) => JSON.parse(row.data_json)),
    activeProjectId:
      uiStateRow?.active_project_id ??
      (scanRuns.length || projectRows.results?.length
        ? scanRuns[0]?.projectId ?? JSON.parse(projectRows.results?.[0]?.data_json ?? "null")?.id ?? null
        : null),
    scanRuns,
    scanProgressByProject: uiStateRow?.scan_progress_json ? JSON.parse(uiStateRow.scan_progress_json) : {},
    targetIntentModels: Object.fromEntries((targetIntentRows.results ?? []).map((row) => [row.project_id, JSON.parse(row.data_json)])),
    projectOnboarding: Object.fromEntries((onboardingRows.results ?? []).map((row) => [row.project_id, JSON.parse(row.data_json)])),
    preferences: uiStateRow?.preferences_json
      ? {
          ...createDefaultD1Preferences(),
          ...(JSON.parse(uiStateRow.preferences_json) as Partial<SiteIntentSessionState["preferences"]>)
        }
      : createDefaultD1Preferences()
  };
}

export async function saveStateToD1(db: D1Database, state: SiteIntentSessionState) {
  await db.batch([
    db.prepare("DELETE FROM scan_pages"),
    db.prepare("DELETE FROM scan_runs"),
    db.prepare("DELETE FROM target_intent_models"),
    db.prepare("DELETE FROM project_onboarding"),
    db.prepare("DELETE FROM projects"),
    db.prepare("DELETE FROM app_session"),
    db.prepare("DELETE FROM app_ui_state")
  ]);

  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO app_ui_state (id, active_project_id, preferences_json, scan_progress_json) VALUES (1, ?, ?, ?)").bind(
      state.activeProjectId,
      JSON.stringify(state.preferences),
      JSON.stringify(state.scanProgressByProject)
    ),
    ...state.projects.map((project, index) =>
      db.prepare("INSERT INTO projects (id, sort_order, data_json) VALUES (?, ?, ?)").bind(project.id, index, JSON.stringify(project))
    ),
    ...Object.entries(state.targetIntentModels).map(([projectId, model]) =>
      db.prepare("INSERT INTO target_intent_models (project_id, data_json) VALUES (?, ?)").bind(projectId, JSON.stringify(model))
    ),
    ...Object.entries(state.projectOnboarding).map(([projectId, onboarding]) =>
      db.prepare("INSERT INTO project_onboarding (project_id, data_json) VALUES (?, ?)").bind(projectId, JSON.stringify(onboarding))
    )
  ];

  state.scanRuns.forEach((scan, scanIndex) => {
    const { websiteScanPages, pages: _pages, ...storedScan } = scan;
    statements.push(
      db.prepare("INSERT INTO scan_runs (id, project_id, sort_order, started_at, completed_at, data_json) VALUES (?, ?, ?, ?, ?, ?)").bind(
        scan.id,
        scan.projectId,
        scanIndex,
        scan.startedAt,
        scan.completedAt,
        JSON.stringify(storedScan)
      )
    );

    websiteScanPages.forEach((page, pageIndex) => {
      statements.push(
        db.prepare("INSERT INTO scan_pages (scan_id, page_index, data_json) VALUES (?, ?, ?)").bind(
          scan.id,
          pageIndex,
          JSON.stringify(page)
        )
      );
    });
  });

  if (statements.length) {
    await db.batch(statements);
  }
}

export async function ensureD1State(db: D1Database) {
  try {
    return await loadStateFromD1(db);
  } catch {
    return createEmptyState();
  }
}

export async function updateScanProgressInD1(
  db: D1Database,
  projectId: string,
  progress: SiteIntentSessionState["scanProgressByProject"][string]
) {
  const existingRow = await db
    .prepare("SELECT active_project_id, preferences_json, scan_progress_json FROM app_ui_state WHERE id = 1")
    .first<UiStateRow>();
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

  await db.prepare(
    "INSERT INTO app_ui_state (id, active_project_id, preferences_json, scan_progress_json) VALUES (1, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET active_project_id=excluded.active_project_id, preferences_json=excluded.preferences_json, scan_progress_json=excluded.scan_progress_json"
  ).bind(
    existingRow?.active_project_id ?? null,
    existingRow?.preferences_json ?? JSON.stringify(createDefaultD1Preferences()),
    JSON.stringify(nextProgress)
  ).run();
}

export async function persistScanRunSnapshotInD1(db: D1Database, scan: ProjectScanRun) {
  const existingRow = await db.prepare("SELECT sort_order FROM scan_runs WHERE id = ?").bind(scan.id).first<{ sort_order: number }>();
  const topRow = await db.prepare("SELECT COALESCE(MIN(sort_order), 0) AS min_sort_order FROM scan_runs").first<{ min_sort_order: number | null }>();
  const sortOrder = existingRow?.sort_order ?? Math.min((topRow?.min_sort_order ?? 0) - 1, -1);
  const { websiteScanPages, pages: _pages, ...storedScan } = scan;

  await db.batch([
    db.prepare(
      "INSERT INTO scan_runs (id, project_id, sort_order, started_at, completed_at, data_json) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, started_at=excluded.started_at, completed_at=excluded.completed_at, data_json=excluded.data_json"
    ).bind(scan.id, scan.projectId, sortOrder, scan.startedAt, scan.completedAt, JSON.stringify(storedScan)),
    db.prepare("DELETE FROM scan_pages WHERE scan_id = ?").bind(scan.id),
    ...websiteScanPages.map((page, pageIndex) =>
      db.prepare("INSERT INTO scan_pages (scan_id, page_index, data_json) VALUES (?, ?, ?)").bind(
        scan.id,
        pageIndex,
        JSON.stringify(page)
      )
    )
  ]);
}

function createDefaultD1Preferences() {
  return createDefaultPreferences();
}

export async function persistCompletedScanInD1(db: D1Database, scan: ProjectScanRun) {
  const currentState = await ensureD1State(db);
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

  const existingOnboarding = currentState.projectOnboarding[scan.projectId];
  await saveStateToD1(db, {
    ...currentState,
    projects: currentState.projects.map((entry) => (entry.id === scan.projectId ? updatedProject : entry)),
    activeProjectId: scan.projectId,
    scanRuns: [scan, ...currentState.scanRuns.filter((entry) => entry.id !== scan.id)],
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
  });
}
