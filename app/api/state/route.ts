import { NextResponse } from "next/server";

import { ensureSqliteState, saveStateToSqlite } from "@/lib/sqlite-state";
import type { SiteIntentSessionState } from "@/lib/site-state";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ state: ensureSqliteState() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load state." },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { state?: SiteIntentSessionState };
    if (!body.state) {
      return NextResponse.json({ error: "State payload is required." }, { status: 400 });
    }

    const persistedState = ensureSqliteState();
    saveStateToSqlite(mergeStateWithPersistedScans(body.state, persistedState));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save state." },
      { status: 500 }
    );
  }
}

function mergeStateWithPersistedScans(nextState: SiteIntentSessionState, persistedState: SiteIntentSessionState): SiteIntentSessionState {
  const persistedScansById = new Map(persistedState.scanRuns.map((scan) => [scan.id, scan]));
  const nextScansById = new Map(nextState.scanRuns.map((scan) => [scan.id, scan]));
  const mergedScanRuns = nextState.scanRuns.map((scan) => {
    const persisted = persistedScansById.get(scan.id);
    if (!persisted) {
      return scan;
    }

    return {
      ...scan,
      competitorAnalyses: scan.competitorAnalyses?.length ? scan.competitorAnalyses : persisted.competitorAnalyses,
      rankability: scan.rankability ?? persisted.rankability,
      discoverability: scan.discoverability ?? persisted.discoverability,
      observedIntent: scan.observedIntent ?? persisted.observedIntent,
      scoringError: scan.scoringError ?? persisted.scoringError
    };
  });

  for (const persistedScan of persistedState.scanRuns) {
    if (!nextScansById.has(persistedScan.id)) {
      mergedScanRuns.push(persistedScan);
    }
  }

  return {
    ...nextState,
    scanProgressByProject: {
      ...persistedState.scanProgressByProject,
      ...nextState.scanProgressByProject
    },
    scanRuns: mergedScanRuns
  };
}
