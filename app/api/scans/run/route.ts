import { NextResponse } from "next/server";

import { isAuthError, requireRequestSession } from "@/lib/auth";
import { getCloudflareEnv, isCloudflareRuntime } from "@/lib/cloudflare-runtime";
import {
  persistCompletedScan,
  persistScanRunSnapshot,
  updateScanProgress
} from "@/lib/app-state";
import { logScanEvent, toErrorDetails } from "@/lib/scan/logging";
import { runProjectScan } from "@/lib/scan/run-scan";
import type { ProjectScanRequest } from "@/lib/site-state";
import type { ScanProgressEvent } from "@/lib/scan/types";

export async function POST(request: Request) {
  try {
    await requireRequestSession();
    applyCloudflareEnvToProcess();
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
      pageAnalysisModel: isCloudflareRuntime() ? undefined : typeof body.pageAnalysisModel === "string" ? body.pageAnalysisModel : undefined,
      scoringModel: isCloudflareRuntime() ? undefined : typeof body.scoringModel === "string" ? body.scoringModel : undefined,
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
                void updateScanProgress(payload.projectId, progress);
                send({ type: "progress", progress });
              },
              onScanSnapshot(scanSnapshot) {
                void persistScanRunSnapshot(scanSnapshot);
              }
            });

            await persistCompletedScan(scan);
            await updateScanProgress(payload.projectId, null);
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
          void updateScanProgress(payload.projectId, null);
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
    if (isAuthError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to run the scan."
      },
      { status: 500 }
    );
  }
}

function applyCloudflareEnvToProcess() {
  const env = getCloudflareEnv();
  if (!env) {
    return;
  }

  const keys = [
    "OPENAI_API_KEY",
    "SITEINTENT_PAGE_ANALYSIS_MODEL",
    "SITEINTENT_PAGE_ANALYSIS_LOCAL_MODEL",
    "SITEINTENT_DISCOVERABILITY_LOCAL_MODEL",
    "SITEINTENT_RANKABILITY_LOCAL_MODEL",
    "SITEINTENT_COMPETITOR_VALIDATION_LOCAL_MODEL"
  ] as const;

  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) {
      process.env[key] = value;
    }
  }
}

function applyRequestLocalModels(pageAnalysisModel?: string, scoringModel?: string) {
  if (isCloudflareRuntime() || (!pageAnalysisModel?.trim() && !scoringModel?.trim())) {
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
