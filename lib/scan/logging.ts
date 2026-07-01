import fs from "node:fs";
import path from "node:path";

type ScanLogLevel = "info" | "warn" | "error";

type ScanLogEntry = {
  timestamp: string;
  level: ScanLogLevel;
  event: string;
  projectId?: string;
  projectName?: string;
  websiteUrl?: string;
  scanId?: string;
  scanMode?: string;
  message?: string;
  details?: unknown;
  stack?: string;
};

export function logScanEvent(entry: Omit<ScanLogEntry, "timestamp">) {
  const payload: ScanLogEntry = {
    timestamp: new Date().toISOString(),
    ...entry
  };

  try {
    const logDir = path.resolve(process.cwd(), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, "scan-events.ndjson"), `${JSON.stringify(payload)}\n`, "utf8");
  } catch (error) {
    console.error("Failed to write scan log.", error);
  }

  const consoleMethod = entry.level === "error" ? console.error : entry.level === "warn" ? console.warn : console.log;
  consoleMethod(`[scan:${entry.event}]`, payload);
}

export function toErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: String(error)
  };
}
