import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { runProjectScan } from "@/lib/scan/run-scan";
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
      targetIntentModel: body.targetIntentModel
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(data)}\n`));
        };

        try {
          const scan = await runProjectScan(payload, {
            onProgress(progress: ScanProgressEvent) {
              send({ type: "progress", progress });
            }
          });

          send({ type: "result", scan });
          controller.close();
        } catch (error) {
          send({
            type: "error",
            error: error instanceof Error ? error.message : "Unable to run the scan."
          });
          controller.close();
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

function hydrateEnvFromDotEnv() {
  if (process.env.OPENAI_API_KEY) {
    return;
  }

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
