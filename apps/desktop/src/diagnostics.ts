import { invoke } from "@tauri-apps/api/core";
import { compactLabel, overallScore, type ContentAnalysisController, type StoredReport } from "./use-content-analysis";

type NavigatorWithMemory = Navigator & {
  deviceMemory?: number;
};

type DiagnosticsController = Pick<
  ContentAnalysisController,
  | "languageHint"
  | "genre"
  | "goal"
  | "showRaw"
  | "proofreadingEnabled"
  | "languageToolUrl"
  | "loading"
  | "error"
  | "reports"
  | "selectedReportId"
>;

export function buildSystemStatusReport(controller: DiagnosticsController): string {
  const generatedAt = new Date();
  const lastReport = latestReport(controller.reports);
  const statusCounts = reportStatusCounts(controller.reports);
  const nav = navigator as NavigatorWithMemory;

  return [
    "FlavorPress Content Analyzer - System Status Report",
    `Generated: ${generatedAt.toISOString()}`,
    `Generated local time: ${generatedAt.toLocaleString()}`,
    "",
    "Application",
    `- Runtime: ${isDesktopRuntime() ? "Desktop" : "Browser preview"}`,
    `- Build mode: ${buildMode()}`,
    `- Page URL: ${location.href}`,
    `- Analysis running: ${yesNo(controller.loading)}`,
    `- Last UI error: ${controller.error ? redactDiagnosticText(controller.error) : "None"}`,
    "",
    "Analyzer Settings",
    `- Language hint: ${controller.languageHint}`,
    `- Default genre: ${controller.genre}`,
    `- Default review focus: ${controller.goal}`,
    `- Local proofreading enabled: ${yesNo(controller.proofreadingEnabled)}`,
    `- Local LanguageTool URL configured: ${controller.languageToolUrl ? "Yes" : "No"}`,
    `- Raw diagnostics enabled: ${yesNo(controller.showRaw)}`,
    `- Private-network URL requests blocked: Yes`,
    "",
    "Session Reports",
    `- Total reports: ${controller.reports.length}`,
    `- In progress: ${statusCounts.in_progress}`,
    `- Complete: ${statusCounts.complete}`,
    `- Failed: ${statusCounts.failed}`,
    `- Selected report ID: ${controller.selectedReportId ?? "None"}`,
    "",
    "System",
    `- User agent: ${navigator.userAgent}`,
    `- Platform: ${navigator.platform}`,
    `- Languages: ${navigator.languages?.join(", ") || navigator.language || "Unknown"}`,
    `- Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown"}`,
    `- Online: ${yesNo(navigator.onLine)}`,
    `- Viewport: ${window.innerWidth} x ${window.innerHeight}`,
    `- Screen: ${window.screen.width} x ${window.screen.height}`,
    `- Device pixel ratio: ${window.devicePixelRatio}`,
    `- CPU threads reported: ${navigator.hardwareConcurrency ?? "Unknown"}`,
    `- Device memory reported: ${nav.deviceMemory ? `${nav.deviceMemory} GB` : "Unknown"}`,
    `- Clipboard write API: ${typeof navigator.clipboard?.writeText === "function" ? "Available" : "Fallback required"}`,
    `- Local storage: ${storageAvailable("localStorage") ? "Available" : "Unavailable"}`,
    `- Session storage: ${storageAvailable("sessionStorage") ? "Available" : "Unavailable"}`,
    `- Storage estimate API: ${typeof navigator.storage?.estimate === "function" ? "Available" : "Unavailable"}`,
    "",
    "Latest Analysis Run",
    ...latestReportLines(lastReport),
    "",
  ].join("\n");
}

export async function copyTextToClipboard(text: string): Promise<void> {
  let clipboardError: unknown;

  if (isDesktopRuntime()) {
    try {
      await withTimeout(invoke("desktop_copy_text", { text }), 5_000, "Desktop clipboard copy timed out.");
      return;
    } catch (error) {
      throw new Error(clipboardErrorMessage(error));
    }
  }

  if (typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.append(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error(clipboardErrorMessage(clipboardError));
    }
  } finally {
    textarea.remove();
  }
}

function latestReport(reports: StoredReport[]): StoredReport | null {
  return [...reports].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
}

function reportStatusCounts(reports: StoredReport[]): Record<StoredReport["status"], number> {
  return reports.reduce(
    (counts, report) => ({
      ...counts,
      [report.status]: counts[report.status] + 1,
    }),
    {
      in_progress: 0,
      complete: 0,
      failed: 0,
    },
  );
}

function latestReportLines(report: StoredReport | null): string[] {
  if (!report) {
    return ["- No analysis has run in this session."];
  }

  const lines = [
    `- Report ID: ${report.id}`,
    `- Status: ${compactLabel(report.status)}`,
    `- Input type: ${report.inputMode === "url" ? "URL" : "Text"}`,
    `- Source: ${diagnosticSourceLabel(report)}`,
    `- Created: ${report.createdAt}`,
    `- Completed: ${report.completedAt ?? "Not completed"}`,
    `- Duration: ${report.durationMs === undefined ? "Unknown" : `${report.durationMs} ms`}`,
  ];

  if (report.errorMessage) {
    lines.push(`- Error: ${redactDiagnosticText(report.errorMessage)}`);
  }

  if (!report.result) {
    return lines;
  }

  const result = report.result;
  lines.push(
    `- Result generated: ${result.generatedAt}`,
    `- Overall score: ${overallScore(result)}`,
    `- Quality band: ${result.summary.qualityBand}`,
    `- Provenance-risk band: ${compactLabel(result.summary.provenanceBand)}`,
    `- Provenance confidence: ${Math.round(result.summary.provenanceConfidence * 100)}%`,
    `- Source-support band: ${compactLabel(result.summary.sourceBand)}`,
    `- Word count: ${result.context.wordCount}`,
    `- Sentence count: ${result.context.sentenceCount}`,
    `- Paragraph count: ${result.context.paragraphCount}`,
    `- Detected language: ${result.context.detectedLanguage} (${Math.round(result.context.languageConfidence * 100)}%)`,
    `- Detected genre: ${result.context.detectedGenre} (${Math.round(result.context.genreConfidence * 100)}%)`,
    `- Provided sources: ${result.inputSummary.sourceCount}`,
    `- Total claims: ${result.claimReview.totalClaims}`,
    `- Factual claims: ${result.claimReview.factualClaims}`,
    `- Claims supported by provided material: ${result.claimReview.supportedByProvidedMaterial}`,
    `- Claims partially supported by provided material: ${result.claimReview.partiallySupportedByProvidedMaterial}`,
    `- Inline citation only claims: ${result.claimReview.inlineCitationOnly}`,
    `- Unsupported claims: ${result.claimReview.unsupportedClaims}`,
    `- Not checked claims: ${result.claimReview.notCheckedClaims}`,
    `- Freshness-risk claims: ${result.claimReview.freshnessRiskClaims}`,
    `- Proofreading status: ${compactLabel(result.proofreading.status)}`,
    `- Proofreading issues: ${result.proofreading.issues.length}`,
    `- Proofreading providers: ${result.proofreading.providers.map((provider) => provider.id).join(", ") || "None"}`,
    `- Dimensions: ${result.dimensions.length}`,
    `- Spans: ${result.spans.length}`,
    `- Score contributions: ${result.scoreContributions.length}`,
    `- Report sections: ${result.analysisSections.length}`,
    `- Caveats: ${result.summary.caveats.length > 0 ? result.summary.caveats.join(" | ") : "None"}`,
  );

  return lines;
}

function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function buildMode(): string {
  return import.meta.env?.MODE ?? "unknown";
}

function diagnosticSourceLabel(report: StoredReport): string {
  if (report.inputMode !== "url") {
    return "Pasted text (content excerpt omitted)";
  }

  return summarizeUrlForDiagnostics(report.sourceLabel);
}

function summarizeUrlForDiagnostics(value: string): string {
  const rawValue = value.trim();
  const candidate = rawValue.includes("://") ? rawValue : `https://${rawValue}`;
  try {
    const parsed = new URL(candidate);
    const pathSegments = parsed.pathname.split("/").filter(Boolean).length;
    const details = [
      pathSegments > 0 ? `${pathSegments} path segment(s) omitted` : "",
      parsed.search ? `${parsed.searchParams.size} query parameter(s) omitted` : "",
      parsed.hash ? "fragment omitted" : "",
    ].filter(Boolean);

    return details.length > 0 ? `${parsed.origin} (${details.join("; ")})` : parsed.origin;
  } catch {
    return "URL input (source omitted)";
  }
}

function redactDiagnosticText(value: string): string {
  return value.replace(/\bhttps?:\/\/[^\s<>"'`]+/giu, (match) => summarizeUrlForDiagnostics(match));
}

function storageAvailable(kind: "localStorage" | "sessionStorage"): boolean {
  try {
    const storage = window[kind];
    const key = "__content_analyzer_diagnostics__";
    storage.setItem(key, "1");
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function clipboardErrorMessage(_error: unknown): string {
  return "Clipboard copy failed. Focus the app window and try again.";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}
