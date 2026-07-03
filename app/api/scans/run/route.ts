import { NextResponse } from "next/server";

import { isAuthError, requireRequestSession } from "@/lib/auth";
import { getCloudflareEnv } from "@/lib/cloudflare-runtime";
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
      pageAnalysisModel: undefined,
      scoringModel: undefined,
      comparisonModels: body.comparisonModels,
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
              pageAnalysisModel: null,
              scoringModel: null
            }
          });
          const scan = await runProjectScan(payload, {
            async onProgress(progress: ScanProgressEvent) {
              try {
                await updateScanProgress(payload.projectId, progress);
              } catch (err) {
                console.error("[scan] progress save failed:", err);
              }
              send({ type: "progress", progress });
            },
            async onScanSnapshot(scanSnapshot) {
              try {
                await persistScanRunSnapshot(scanSnapshot);
              } catch (err) {
                console.error("[scan] snapshot save failed:", err);
              }
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
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "SITEINTENT_WORKER_MODEL",
    "SITEINTENT_JUDGE_MODEL",
    "SITEINTENT_ANALYSIS_MODELS",
    "SITEINTENT_PAGE_ANALYSIS_MODEL",
    "SITEINTENT_DISCOVERABILITY_MODEL",
    "SITEINTENT_RANKABILITY_MODEL",
    "SITEINTENT_COMPETITOR_VALIDATION_MODEL",
    "SITEINTENT_ANTHROPIC_MODEL",
    "SITEINTENT_GEMINI_MODEL"
  ] as const;

  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) {
      process.env[key] = value;
    }
  }
}
