import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  Clipboard,
  ClipboardCheck,
  FileJson,
  FileSpreadsheet,
  FileText,
  Gauge,
  ListFilter,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  buildReportView,
  qualityBands,
  signalBands,
  sourceBands,
  type AnalysisResult,
  type AnalysisSection,
} from "@flavorpress/analyzer-core";
import { AnalysisActivity } from "./analysis-activity";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Cluster,
  EmptyState,
  Input,
  Select,
  Stack,
  StatCard,
} from "./ui";
import {
  compactLabel,
  downloadReport,
  genreOptions,
  goalOptions,
  overallScore,
  percent,
  type ContentAnalysisController,
  type StoredReport,
} from "./use-content-analysis";
import { buildSystemStatusReport, copyTextToClipboard } from "./diagnostics";

type ReportFilters = {
  status: "all" | StoredReport["status"];
  quality: "all" | AnalysisResult["summary"]["qualityBand"];
  provenance: "all" | AnalysisResult["summary"]["provenanceBand"];
  source: "all" | AnalysisResult["summary"]["sourceBand"];
  date: string;
};

const defaultFilters: ReportFilters = {
  status: "all",
  quality: "all",
  provenance: "all",
  source: "all",
  date: "",
};

function bandLabel(value: string): string {
  return compactLabel(value)
    .split(" ")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export function ReportsPage({ controller }: { controller: ContentAnalysisController }) {
  const selectedReport = controller.selectedReport;
  const clearSelectedReport = controller.clearSelectedReport;
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const filteredReports = useMemo(
    () => controller.reports.filter((report) => reportMatchesFilters(report, filters)),
    [controller.reports, filters],
  );

  useEffect(() => {
    if (!selectedReport) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!isBackShortcut(event) || isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      clearSelectedReport();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearSelectedReport, selectedReport]);

  return (
    <div className="page page--admin page--reports">
      <div className="admin-header">
        <div>
          <h2>Reports</h2>
          <p>Session-only analysis history.</p>
        </div>
        <Badge variant="outline">
          {controller.reports.length} {controller.reports.length === 1 ? "report" : "reports"}
        </Badge>
      </div>

      {selectedReport ? (
        <ReportDetail report={selectedReport} showRaw={controller.showRaw} onBack={clearSelectedReport} />
      ) : controller.reports.length === 0 ? (
        <Card>
          <CardContent className="card__content--padded">
            <EmptyState>No reports in this session.</EmptyState>
          </CardContent>
        </Card>
      ) : (
        <div className="report-list-surface">
          <ReportFilters filters={filters} onChange={setFilters} />
          {filteredReports.length === 0 ? (
            <EmptyState>No reports match the selected filters.</EmptyState>
          ) : (
            <ReportTable reports={filteredReports} onSelect={controller.setSelectedReportId} />
          )}
        </div>
      )}
    </div>
  );
}

function reportMatchesFilters(report: StoredReport, filters: ReportFilters): boolean {
  if (filters.status !== "all" && report.status !== filters.status) {
    return false;
  }
  if (filters.date && !report.createdAt.startsWith(filters.date)) {
    return false;
  }
  if (!report.result) {
    return filters.quality === "all" && filters.provenance === "all" && filters.source === "all";
  }
  return (
    (filters.quality === "all" || report.result.summary.qualityBand === filters.quality) &&
    (filters.provenance === "all" || report.result.summary.provenanceBand === filters.provenance) &&
    (filters.source === "all" || report.result.summary.sourceBand === filters.source)
  );
}

function ReportFilters({
  filters,
  onChange,
}: {
  filters: ReportFilters;
  onChange: (filters: ReportFilters) => void;
}) {
  return (
    <div className="report-filter-row" aria-label="Report filters">
      <div className="report-filter-row__label">
        <ListFilter aria-hidden="true" />
        <span>Filters</span>
      </div>
      <Select
        value={filters.status}
        onChange={(event) => onChange({ ...filters, status: event.target.value as ReportFilters["status"] })}
        aria-label="Filter by status"
      >
        <option value="all">All status</option>
        <option value="in_progress">In progress</option>
        <option value="complete">Complete</option>
        <option value="failed">Failed</option>
      </Select>
      <Select
        value={filters.quality}
        onChange={(event) => onChange({ ...filters, quality: event.target.value as ReportFilters["quality"] })}
        aria-label="Filter by quality"
      >
        <option value="all">All quality</option>
        {qualityBands.map((band) => (
          <option value={band} key={band}>
            {bandLabel(band)}
          </option>
        ))}
      </Select>
      <Select
        value={filters.provenance}
        onChange={(event) => onChange({ ...filters, provenance: event.target.value as ReportFilters["provenance"] })}
        aria-label="Filter by provenance-risk band"
      >
        <option value="all">All provenance</option>
        {signalBands.map((band) => (
          <option value={band} key={band}>
            {bandLabel(band)}
          </option>
        ))}
      </Select>
      <Select
        value={filters.source}
        onChange={(event) => onChange({ ...filters, source: event.target.value as ReportFilters["source"] })}
        aria-label="Filter by source-support band"
      >
        <option value="all">All source support</option>
        {sourceBands.map((band) => (
          <option value={band} key={band}>
            {bandLabel(band)}
          </option>
        ))}
      </Select>
      <input
        className="control"
        type="date"
        value={filters.date}
        onChange={(event) => onChange({ ...filters, date: event.target.value })}
        aria-label="Filter by date"
      />
      <Button variant="ghost" size="sm" type="button" onClick={() => onChange(defaultFilters)}>
        Reset
      </Button>
    </div>
  );
}

function ReportTable({
  reports,
  onSelect,
}: {
  reports: StoredReport[];
  onSelect: (reportId: string) => void;
}) {
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Source</th>
            <th>Status</th>
            <th>Quality score</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
            <tr
              key={report.id}
              tabIndex={0}
              onClick={() => onSelect(report.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(report.id);
                }
              }}
            >
              <td>{formatReportDate(report.createdAt)}</td>
              <td>
                <span className="report-source">{report.sourceLabel}</span>
                <small>{report.inputMode === "url" ? "URL" : "Text"}</small>
              </td>
              <td>
                <ReportStatusBadge status={report.status} />
              </td>
              <td>{report.result ? overallScore(report.result) : report.status === "failed" ? "Failed" : "Pending"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportDetail({
  report,
  showRaw,
  onBack,
}: {
  report: StoredReport;
  showRaw: boolean;
  onBack: () => void;
}) {
  if (report.status === "in_progress") {
    return (
      <ReportDetailShell onBack={onBack}>
        <Card>
          <CardHeader>
            <CardTitle>Analysis in progress</CardTitle>
            <CardDescription>{report.sourceLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            <AnalysisActivity />
          </CardContent>
        </Card>
      </ReportDetailShell>
    );
  }

  if (report.status === "failed" || !report.result) {
    return (
      <ReportDetailShell onBack={onBack}>
        <Card>
          <CardHeader>
            <Cluster>
              <Badge variant="danger">Failed</Badge>
            </Cluster>
            <CardTitle>Analysis failed</CardTitle>
            <CardDescription>{report.sourceLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="error">
              <AlertTriangle aria-hidden="true" />
              {report.errorMessage ?? "The analysis did not complete."}
            </Alert>
          </CardContent>
        </Card>
      </ReportDetailShell>
    );
  }

  const result = report.result;
  const reportView = buildReportView(result, "full");

  return (
    <ReportDetailShell onBack={onBack}>
      <div className="results-stack">
        <Card>
          <CardHeader className="split-header">
            <div>
              <CardTitle>Selected report</CardTitle>
              <CardDescription>{result.summary.headline}</CardDescription>
            </div>
            <Cluster>
              <Button variant="outline" size="sm" type="button" onClick={() => downloadReport(result, "markdown")}>
                <FileText aria-hidden="true" />
                Markdown
              </Button>
              <Button variant="outline" size="sm" type="button" onClick={() => downloadReport(result, "claims-csv")}>
                <FileSpreadsheet aria-hidden="true" />
                Claims CSV
              </Button>
              <Button variant="outline" size="sm" type="button" onClick={() => downloadReport(result, "json")}>
                <FileJson aria-hidden="true" />
                JSON
              </Button>
            </Cluster>
          </CardHeader>
          <CardContent>
            <Stack>
              <div className="stat-grid">
                <StatCard
                  title="Quality score"
                  value={String(overallScore(result))}
                  description="Average quality dimension score"
                  icon={<BarChart3 aria-hidden="true" />}
                />
                <StatCard
                  title="Provenance-risk"
                  value={compactLabel(result.summary.provenanceBand)}
                  description={percent(result.summary.provenanceConfidence)}
                  icon={<Gauge aria-hidden="true" />}
                />
                <StatCard
                  title="Quality"
                  value={result.summary.qualityBand}
                  description={`${result.context.wordCount} words`}
                  icon={<BarChart3 aria-hidden="true" />}
                />
                <StatCard
                  title="Sources"
                  value={compactLabel(result.summary.sourceBand)}
                  description={`${result.claimReview.factualClaims} factual claims`}
                  icon={<ShieldCheck aria-hidden="true" />}
                />
                <StatCard
                  title="Proofreading"
                  value={String(result.proofreading.issues.length)}
                  description={compactLabel(result.proofreading.status)}
                  icon={<Sparkles aria-hidden="true" />}
                />
              </div>
              {result.summary.caveats.length > 0 ? (
                <Alert>
                  {result.summary.caveats.slice(0, 3).map((entry) => (
                    <div key={entry}>{entry}</div>
                  ))}
                </Alert>
              ) : null}
            </Stack>
          </CardContent>
        </Card>

        <ReportSections sections={reportView.sections} />
        {showRaw ? <RawJsonCard result={result} /> : null}
      </div>
    </ReportDetailShell>
  );
}

function ReportDetailShell({ children, onBack }: { children: ReactNode; onBack: () => void }) {
  return (
    <div className="report-detail-page">
      <div className="report-detail-toolbar">
        <Button variant="outline" size="sm" type="button" onClick={onBack}>
          <ChevronLeft aria-hidden="true" />
          Back to reports
        </Button>
      </div>
      {children}
    </div>
  );
}

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatReportDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  const hours = date.getHours();
  const displayHour = String(hours % 12 || 12).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = hours >= 12 ? "PM" : "AM";

  return `${month} ${day}, ${year}, ${displayHour}:${minutes} ${period}`;
}

function isBackShortcut(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  const hasBackModifier = event.ctrlKey || event.metaKey;
  return key === "z" && hasBackModifier && !event.altKey && !event.shiftKey;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function ReportStatusBadge({ status }: { status: StoredReport["status"] }) {
  if (status === "complete") {
    return <Badge variant="secondary">Complete</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="danger">Failed</Badge>;
  }
  return <Badge variant="outline">In progress</Badge>;
}

function ReportSections({ sections }: { sections: AnalysisSection[] }) {
  return (
    <>
      {sections
        .filter((section) => section.kind !== "raw_diagnostics")
        .map((section) => (
          <ReportSectionCard key={section.id} section={section} />
        ))}
    </>
  );
}

function ReportSectionCard({ section }: { section: AnalysisSection }) {
  const visibleItems = section.items.slice(0, section.kind === "claim_review" ? 12 : 8);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{section.title}</CardTitle>
        {section.summary ? <CardDescription>{section.summary}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <Stack>
          {visibleItems.length === 0 ? (
            <p className="muted">No major items.</p>
          ) : (
            visibleItems.map((item) => (
              <article className="list-item" key={item.id}>
                <Cluster>
                  {item.status ? <Badge variant="outline">{compactLabel(item.status)}</Badge> : null}
                  {item.severity ? <Badge variant={item.severity === "high" ? "danger" : item.severity === "medium" ? "warning" : "outline"}>{item.severity}</Badge> : null}
                  {item.score !== undefined ? <Badge variant="secondary">{item.score}</Badge> : null}
                </Cluster>
                <div className="list-item__header">
                  <strong>{item.title}</strong>
                </div>
                <p>{item.body}</p>
                {item.metadata ? <small>{metadataLine(item.metadata)}</small> : null}
              </article>
            ))
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function metadataLine(metadata: NonNullable<AnalysisSection["items"][number]["metadata"]>): string {
  return Object.entries(metadata)
    .filter(([, value]) => value !== "" && value !== false && value !== undefined)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}

function RawJsonCard({ result }: { result: AnalysisResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Raw JSON</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="raw-json">{JSON.stringify(result, null, 2)}</pre>
      </CardContent>
    </Card>
  );
}

export function SettingsPage({ controller }: { controller: ContentAnalysisController }) {
  const [diagnosticsState, setDiagnosticsState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [diagnosticsMessage, setDiagnosticsMessage] = useState("");

  async function handleCopyDiagnostics() {
    setDiagnosticsState("copying");
    setDiagnosticsMessage("");

    try {
      await copyTextToClipboard(buildSystemStatusReport(controller));
      setDiagnosticsState("copied");
      setDiagnosticsMessage("System status report copied.");
    } catch (error) {
      setDiagnosticsState("failed");
      setDiagnosticsMessage(error instanceof Error ? error.message : "The system status report could not be copied.");
    }
  }

  return (
    <div className="page page--admin page--settings">
      <div className="admin-header">
        <div>
          <h2>Settings</h2>
          <p>Local analysis defaults and diagnostics.</p>
        </div>
      </div>

      <div className="settings-list">
        <section className="settings-section">
          <h3>Analysis</h3>

          <div className="settings-row">
            <div className="settings-row__copy">
              <strong>Language hint</strong>
              <span>Use this only when auto-detection is weak or the content is short.</span>
            </div>
            <Select
              className="settings-control"
              aria-label="Language hint"
              value={controller.languageHint}
              onChange={(event) => controller.setLanguageHint(event.target.value)}
            >
              <option value="auto">Auto</option>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="pt">Portuguese</option>
              <option value="fr">French</option>
              <option value="de">German</option>
            </Select>
          </div>

          <div className="settings-row">
            <div className="settings-row__copy">
              <strong>Default genre</strong>
              <span>Apply a known context when every analysis belongs to the same content type.</span>
            </div>
            <Select
              className="settings-control"
              aria-label="Default genre"
              value={controller.genre}
              onChange={(event) => controller.setGenre(event.target.value as typeof controller.genre)}
            >
              {genreOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="settings-row">
            <div className="settings-row__copy">
              <strong>Default review focus</strong>
              <span>Prioritize actions for source support, clarity, risk review, publishing readiness, or triage.</span>
            </div>
            <Select
              className="settings-control"
              aria-label="Default review focus"
              value={controller.goal}
              onChange={(event) => controller.setGoal(event.target.value as typeof controller.goal)}
            >
              {goalOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </section>

        <section className="settings-section">
          <h3>Diagnostics</h3>

          <div className="settings-row">
            <div className="settings-row__copy">
              <strong>Raw JSON and metrics</strong>
              <span>Show the raw analyzer payload in reports and include raw metrics.</span>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                aria-label="Show raw JSON and metrics"
                checked={controller.showRaw}
                onChange={(event) => controller.setShowRaw(event.target.checked)}
              />
            </label>
          </div>

          <div className="settings-row">
            <div className="settings-row__copy">
              <strong>Local proofreading</strong>
              <span>Run bundled local English grammar and spelling checks as part of each analysis.</span>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                aria-label="Enable local proofreading"
                checked={controller.proofreadingEnabled}
                onChange={(event) => controller.setProofreadingEnabled(event.target.checked)}
              />
            </label>
          </div>

          <div className="settings-row">
            <div className="settings-row__copy">
              <strong>LanguageTool localhost URL</strong>
              <span>Optional local server for extra grammar and style checks. Remote endpoints are rejected.</span>
            </div>
            <Input
              className="settings-control"
              aria-label="LanguageTool localhost URL"
              value={controller.languageToolUrl}
              onChange={(event) => controller.setLanguageToolUrl(event.target.value)}
              placeholder="http://localhost:8010"
            />
          </div>

          <div className="settings-row">
            <div className="settings-row__copy">
              <strong>System status report</strong>
              <span>Copy local runtime health, analyzer settings, session counts, and the latest run summary. Analyzed text and URL query details are omitted.</span>
            </div>
            <div className="settings-action-stack">
              <Button
                className="settings-control"
                variant="outline"
                type="button"
                data-testid="copy-diagnostics-report"
                disabled={diagnosticsState === "copying"}
                onClick={handleCopyDiagnostics}
              >
                {diagnosticsState === "copied" ? <ClipboardCheck aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
                {diagnosticsState === "copying" ? "Copying..." : "Copy status report"}
              </Button>
              {diagnosticsMessage ? (
                <span className={diagnosticsState === "failed" ? "settings-action-stack__message settings-action-stack__message--error" : "settings-action-stack__message"} aria-live="polite">
                  {diagnosticsMessage}
                </span>
              ) : null}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h3>Network</h3>

          <div className="settings-row">
            <div className="settings-row__copy">
              <strong>Block private network URL requests</strong>
              <span>Desktop URL analysis cannot fetch local or private network hosts.</span>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                aria-label="Block private network URL requests"
                checked
                disabled
                readOnly
              />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
