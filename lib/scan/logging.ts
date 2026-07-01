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
