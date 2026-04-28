import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  analysisGoals,
  analysisGenres,
  analyzeTextAsync,
  overallQualityScore,
  renderClaimsCsv,
  renderMarkdownReport,
  type AnalysisGenre,
  type AnalysisGoal,
  type AnalysisResult,
  type ExtractionContext,
} from "@flavorpress/analyzer-core";

export type InputMode = "text" | "url";
export type ReportStatus = "in_progress" | "complete" | "failed";
export type StoredReport = {
  id: string;
  inputMode: InputMode;
  sourceLabel: string;
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
  status: ReportStatus;
  result?: AnalysisResult;
  errorMessage?: string;
};

type GenreSelection = "auto" | AnalysisGenre;
type GoalSelection = "auto" | AnalysisGoal;

function labelForGenre(value: string): string {
  return value
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export const genreOptions: Array<{ value: GenreSelection; label: string }> = [
  { value: "auto", label: "Auto-detect" },
  ...analysisGenres.map((genre) => ({ value: genre, label: labelForGenre(genre) })),
];

export const goalOptions: Array<{ value: GoalSelection; label: string }> = [
  { value: "auto", label: "Balanced review" },
  ...analysisGoals.map((goal) => ({ value: goal, label: labelForGenre(goal) })),
];

function sourceLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function extractUrlInDesktop(url: string): Promise<{
  text: string;
  context: ExtractionContext;
}> {
  return await invoke<{
    text: string;
    context: ExtractionContext;
  }>("desktop_extract_url", {
    input: {
      url,
    },
  });
}

export function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export function compactLabel(value: string): string {
  return value.replace(/_/g, " ");
}

export function overallScore(result: AnalysisResult): number {
  return overallQualityScore(result.dimensions);
}

export function downloadReport(result: AnalysisResult, format: "json" | "markdown" | "claims-csv") {
  const text =
    format === "json"
      ? `${JSON.stringify(result, null, 2)}\n`
      : format === "claims-csv"
        ? renderClaimsCsv(result)
        : renderMarkdownReport(result);
  const blob = new Blob([text], {
    type: format === "json" ? "application/json" : format === "claims-csv" ? "text/csv" : "text/markdown",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `content-analysis-${new Date().toISOString().replace(/[:.]/g, "-")}.${
    format === "json" ? "json" : format === "claims-csv" ? "claims.csv" : "md"
  }`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function reportId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sourceLabel(inputMode: InputMode, text: string, url: string): string {
  if (inputMode === "url") {
    return url.trim();
  }
  const excerpt = text
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 72);
  return excerpt ? `${excerpt}${text.trim().length > 72 ? "..." : ""}` : "Pasted text";
}

export function useContentAnalysis() {
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [languageHint, setLanguageHint] = useState("auto");
  const [genre, setGenre] = useState<GenreSelection>("auto");
  const [goal, setGoal] = useState<GoalSelection>("auto");
  const [sources, setSources] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [proofreadingEnabled, setProofreadingEnabled] = useState(true);
  const [languageToolUrl, setLanguageToolUrl] = useState("");
  const [runningCount, setRunningCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<StoredReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const loading = runningCount > 0;

  const selectedReport = useMemo(
    () => (selectedReportId ? reports.find((report) => report.id === selectedReportId) ?? null : null),
    [reports, selectedReportId],
  );
  const result = selectedReport?.result ?? null;

  const dimensionsWithFindings = useMemo(
    () => result?.dimensions.filter((dimension) => dimension.findings.length > 0).slice(0, 8) ?? [],
    [result],
  );

  async function runAnalysis(): Promise<string | null> {
    setError(null);
    const metadata = {
      ...(languageHint !== "auto" ? { languageHint } : {}),
      ...(genre !== "auto" ? { genre } : {}),
      ...(goal !== "auto" ? { goal } : {}),
      ...(sourceLines(sources).length > 0 ? { sources: sourceLines(sources) } : {}),
    };
    const analysisOptions = {
      includeSpans: true,
      includeRawMetrics: showRaw,
      includeProofreading: proofreadingEnabled,
      ...(languageToolUrl.trim() ? { languageToolUrl: languageToolUrl.trim() } : {}),
    };

    if (inputMode === "url" && !url.trim()) {
      setError("Enter a URL to analyze.");
      return null;
    }
    if (inputMode === "text" && text.trim().length < 20) {
      setError("Enter more text before running analysis.");
      return null;
    }

    const nextReportId = reportId();
    const startedAt = performance.now();
    const pendingReport: StoredReport = {
      id: nextReportId,
      inputMode,
      sourceLabel: sourceLabel(inputMode, text, url),
      createdAt: new Date().toISOString(),
      status: "in_progress",
    };

    setReports((current) => [pendingReport, ...current]);
    setRunningCount((current) => current + 1);

    try {
      let nextResult: AnalysisResult;
      if (inputMode === "url") {
        if (!isTauriRuntime()) {
          throw new Error("URL analysis requires the desktop runtime so private-network DNS checks can run locally.");
        }
        const extracted = await extractUrlInDesktop(url.trim());
        nextResult = await analyzeTextAsync(
          {
            text: extracted.text,
            metadata,
            options: analysisOptions,
          },
          extracted.context,
        );
      } else {
        nextResult = await analyzeTextAsync({
          text,
          metadata,
          options: analysisOptions,
        });
      }
      setReports((current) =>
        current.map((report) =>
          report.id === nextReportId
            ? {
                ...report,
                status: "complete",
                completedAt: new Date().toISOString(),
                durationMs: Math.round(performance.now() - startedAt),
                result: nextResult,
                errorMessage: undefined,
              }
            : report,
        ),
      );
      return nextReportId;
    } catch (analysisError) {
      const message = analysisError instanceof Error ? analysisError.message : String(analysisError);
      setReports((current) =>
        current.map((report) =>
          report.id === nextReportId
            ? {
                ...report,
                status: "failed",
                completedAt: new Date().toISOString(),
                durationMs: Math.round(performance.now() - startedAt),
                errorMessage: message,
              }
            : report,
        ),
      );
      return nextReportId;
    } finally {
      setRunningCount((current) => Math.max(0, current - 1));
    }
  }

  function clearError() {
    setError(null);
  }

  function clearSelectedReport() {
    setSelectedReportId(null);
    setError(null);
  }

  return {
    inputMode,
    setInputMode,
    text,
    setText,
    url,
    setUrl,
    languageHint,
    setLanguageHint,
    genre,
    setGenre,
    goal,
    setGoal,
    sources,
    setSources,
    showRaw,
    setShowRaw,
    proofreadingEnabled,
    setProofreadingEnabled,
    languageToolUrl,
    setLanguageToolUrl,
    loading,
    error,
    reports,
    selectedReport,
    selectedReportId,
    setSelectedReportId,
    result,
    dimensionsWithFindings,
    runAnalysis,
    clearError,
    clearSelectedReport,
  };
}

export type ContentAnalysisController = ReturnType<typeof useContentAnalysis>;
