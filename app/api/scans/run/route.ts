import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { logScanEvent, toErrorDetails } from "@/lib/scan/logging";
import { runProjectScan } from "@/lib/scan/run-scan";
import {
  persistCompletedScanInSqlite,
  persistScanRunSnapshotInSqlite,
  updateScanProgressInSqlite
} from "@/lib/sqlite-state";
import type { ProjectScanRequest } from "@/lib/site-state";
import type { ScanProgressEvent } from "@/lib/scan/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    hydrateEnvFromDotEnv();
    const body = (await request.json()) as ProjectScanRequest;

    if (!body.projectId || !body.websiteUrl) {
      return NextResponse.json({ error: "Project ID and website URL are required." }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const payload = {
      projectId: body.projectId,
      projectName: body.projectName ?? "Untitled project",
      websiteUrl: body.websiteUrl,
      competitorUrls: Array.isArray(body.competitorUrls) ? body.competitorUrls : [],
      scanMode: body.scanMode ?? "full",
      scanDepth: Number.isFinite(body.scanDepth) ? body.scanDepth : 1,
      pageAnalysisModel: typeof body.pageAnalysisModel === "string" ? body.pageAnalysisModel : undefined,
      scoringModel: typeof body.scoringModel === "string" ? body.scoringModel : undefined,
      targetIntentModel: body.targetIntentModel
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let streamClosed = false;
        const send = (data: unknown) => {
          if (streamClosed) {
            return;
          }

          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(data)}\n`));
          } catch {
            streamClosed = true;
          }
        };
        const close = () => {
          if (streamClosed) {
            return;
          }

          streamClosed = true;
          try {
            controller.close();
          } catch {
            // Ignore stream close races after the client disconnects.
          }
        };

        try {
          const restoreEnv = applyRequestLocalModels(payload.pageAnalysisModel, payload.scoringModel);
          try {
            logScanEvent({
              level: "info",
              event: "scan_request_received",
              projectId: payload.projectId,
              projectName: payload.projectName,
              websiteUrl: payload.websiteUrl,
              scanMode: payload.scanMode,
              message: "Starting scan request.",
              details: {
                competitorCount: payload.competitorUrls.length,
                scanDepth: payload.scanDepth,
                pageAnalysisModel: payload.pageAnalysisModel ?? null,
                scoringModel: payload.scoringModel ?? null
              }
            });
            const scan = await runProjectScan(payload, {
              onProgress(progress: ScanProgressEvent) {
                updateScanProgressInSqlite(payload.projectId, progress);
                send({ type: "progress", progress });
              },
              onScanSnapshot(scanSnapshot) {
                persistScanRunSnapshotInSqlite(scanSnapshot);
              }
            });

            persistCompletedScanInSqlite(scan);
            updateScanProgressInSqlite(payload.projectId, null);
            logScanEvent({
              level: "info",
              event: "scan_request_completed",
              projectId: payload.projectId,
              projectName: payload.projectName,
              websiteUrl: payload.websiteUrl,
              scanId: scan.id,
              scanMode: scan.scanMode,
              message: "Scan request completed.",
              details: {
                status: scan.status,
                scoringStatus: scan.scoringStatus,
                scoringError: scan.scoringError ?? null,
                errorCount: scan.errors.length
              }
            });
            send({ type: "result", scan });
            close();
          } finally {
            restoreEnv();
          }
        } catch (error) {
          updateScanProgressInSqlite(payload.projectId, null);
          logScanEvent({
            level: "error",
            event: "scan_request_failed",
            projectId: payload.projectId,
            projectName: payload.projectName,
            websiteUrl: payload.websiteUrl,
            scanMode: payload.scanMode,
            message: error instanceof Error ? error.message : "Unable to run the scan.",
            details: toErrorDetails(error)
          });
          send({
            type: "error",
            error: error instanceof Error ? error.message : "Unable to run the scan."
          });
          close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to run the scan."
      },
      { status: 500 }
    );
  }
}

function applyRequestLocalModels(pageAnalysisModel?: string, scoringModel?: string) {
  if (!pageAnalysisModel?.trim() && !scoringModel?.trim()) {
    return () => {};
  }

  const overrides = {
    OLLAMA_MODEL: pageAnalysisModel || scoringModel,
    SITEINTENT_PAGE_ANALYSIS_LOCAL_MODEL: pageAnalysisModel,
    SITEINTENT_DISCOVERABILITY_LOCAL_MODEL: scoringModel,
    SITEINTENT_RANKABILITY_LOCAL_MODEL: scoringModel,
    SITEINTENT_COMPETITOR_VALIDATION_LOCAL_MODEL: scoringModel
  } as const;
  const keys = Object.keys(overrides) as Array<keyof typeof overrides>;
  const previous = new Map<string, string | undefined>();

  for (const key of keys) {
    previous.set(key, process.env[key]);
    const nextValue = overrides[key];
    if (nextValue?.trim()) {
      process.env[key] = nextValue;
    }
  }

  return () => {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function hydrateEnvFromDotEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
