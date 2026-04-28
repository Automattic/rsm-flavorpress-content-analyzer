import {
  analyzeText,
  analysisGenres,
  analysisGoals,
  buildReportView,
  supportedLanguages,
  type AnalysisGenre,
  type AnalysisGoal,
  type AnalysisMode,
  type AnalysisResult,
  type SupportedLanguage,
} from "@flavorpress/analyzer-core/browser";

type FpcaSettings = {
  restUrl: string;
  nonce: string;
  adminUrl: string;
  frontendEnabled: boolean;
  storeRawText: boolean;
  maxInputLength: number;
  analyzerVersion: string;
};

type ReportResponse = {
  id?: number;
  adminUrl?: string;
};

type LanguageSelection = "auto" | SupportedLanguage;
type GenreSelection = "auto" | AnalysisGenre;
type GoalSelection = AnalysisGoal;

type AnalysisContext = {
  languageHint: LanguageSelection;
  genre: GenreSelection;
  goal: GoalSelection;
  sources: string[];
};

type WpSelect = (store: string) => {
  getEditedPostContent?: () => string;
  getCurrentPostId?: () => number;
  getCurrentPostType?: () => string;
} | undefined;

type WpApi = {
  blocks?: {
    registerBlockType: (name: string, settings: Record<string, unknown>) => void;
  };
  blockEditor?: {
    useBlockProps?: (props?: Record<string, unknown>) => Record<string, unknown>;
  };
  plugins?: {
    registerPlugin: (name: string, settings: { render: () => unknown; icon?: string }) => void;
  };
  editPost?: {
    PluginSidebar: unknown;
    PluginSidebarMoreMenuItem: unknown;
  };
  element?: {
    createElement: (...args: unknown[]) => unknown;
    Fragment: unknown;
    useState: <T>(initial: T) => [T, (value: T) => void];
    useRef: <T>(initial: T) => { current: T };
  };
  components?: {
    Button: unknown;
    Notice: unknown;
    PanelBody: unknown;
    SelectControl: unknown;
    TextareaControl: unknown;
    Spinner: unknown;
  };
  data?: {
    useSelect: <T>(callback: (select: WpSelect) => T, deps: unknown[]) => T;
  };
};

declare global {
  interface Window {
    fpcaSettings?: FpcaSettings;
    wp?: WpApi;
  }
}

const DEFAULT_MAX_INPUT_LENGTH = 20000;
const BLOCK_NAME = "flavorpress/content-analyzer";
const BLOCK_METADATA = {
  apiVersion: 3,
  title: "Content Analyzer",
  category: "widgets",
  icon: "analytics",
  description: "Render a public local content-analysis form.",
  supports: {
    html: false,
  },
};
const REPORT_DISCLAIMER = "Reports are directional review signals, not guarantees, certifications, or publishing approvals.";
const DEFAULT_CONTEXT: AnalysisContext = {
  languageHint: "auto",
  genre: "auto",
  goal: "editorial_triage",
  sources: [],
};

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function settings(): FpcaSettings {
  return {
    restUrl: window.fpcaSettings?.restUrl ?? "/wp-json/flavorpress/v1/",
    nonce: window.fpcaSettings?.nonce ?? "",
    adminUrl: window.fpcaSettings?.adminUrl ?? "",
    frontendEnabled: window.fpcaSettings?.frontendEnabled ?? true,
    storeRawText: window.fpcaSettings?.storeRawText ?? false,
    maxInputLength: window.fpcaSettings?.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH,
    analyzerVersion: window.fpcaSettings?.analyzerVersion ?? "0.1.0",
  };
}

function compactLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function readableLabel(value: string): string {
  return compactLabel(value)
    .split(" ")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

const languageOptions: Array<{ label: string; value: LanguageSelection }> = [
  { label: "Auto-detect", value: "auto" },
  ...supportedLanguages.map((language) => ({ label: language.toUpperCase(), value: language })),
];
const genreOptions: Array<{ label: string; value: GenreSelection }> = [
  { label: "Auto-detect", value: "auto" },
  ...analysisGenres.map((genre) => ({ label: readableLabel(genre), value: genre })),
];
const goalOptions: Array<{ label: string; value: GoalSelection }> = analysisGoals.map((goal) => ({
  label: readableLabel(goal),
  value: goal,
}));

function sourceLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function analysisContext(overrides: Partial<AnalysisContext>): AnalysisContext {
  return {
    ...DEFAULT_CONTEXT,
    ...overrides,
    sources: overrides.sources ?? DEFAULT_CONTEXT.sources,
  };
}

function stripEditorMarkup(value: string): string {
  const withStructure = value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script\s*>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/giu, " ")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<li[^>]*>/giu, "\n- ")
    .replace(/<h([1-6])[^>]*>/giu, (_match, level: string) => `\n${"#".repeat(Number(level))} `)
    .replace(/<\/(?:p|div|section|article|main|blockquote|li|ul|ol|h[1-6])>/giu, "\n");
  return withStructure
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

function analyzeLocalText(text: string, mode: AnalysisMode, context = DEFAULT_CONTEXT): AnalysisResult {
  return analyzeText({
    text,
    mode,
    metadata: {
      ...(context.languageHint !== "auto" ? { languageHint: context.languageHint } : {}),
      ...(context.genre !== "auto" ? { genre: context.genre } : {}),
      goal: context.goal,
      ...(context.sources.length > 0 ? { sources: context.sources } : {}),
    },
    options: {
      includeSpans: true,
      includeProofreading: true,
      reportProfile: "checklist",
    },
  });
}

async function storeReport(path: "frontend/reports" | "editor/reports", payload: Record<string, unknown>): Promise<ReportResponse> {
  const config = settings();
  const url = `${config.restUrl.replace(/\/$/, "")}/${path}`;
  const response = await window.fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-WP-Nonce": config.nonce,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message : "The report could not be stored.";
    throw new Error(message);
  }
  return body as ReportResponse;
}

function reportStats(result: AnalysisResult): string[] {
  return [
    `Quality: ${result.summary.qualityBand}`,
    `Risk: ${compactLabel(result.summary.provenanceBand)}`,
    `Sources: ${compactLabel(result.summary.sourceBand)}`,
    `${result.context.wordCount} words`,
  ];
}

function createNode(tagName: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function renderReportNode(result: AnalysisResult, saveError = ""): HTMLElement {
  const report = createNode("div", "fpca-report");
  report.append(createNode("p", "fpca-report__headline", result.summary.headline));
  report.append(createNode("p", "fpca-muted", REPORT_DISCLAIMER));

  const stats = createNode("div", "fpca-stats");
  for (const entry of reportStats(result)) {
    stats.append(createNode("span", "", entry));
  }
  report.append(stats);

  const view = buildReportView(result, "checklist");
  for (const section of view.sections.filter((entry) => entry.items.length > 0).slice(0, 4)) {
    const sectionNode = createNode("section", "fpca-section");
    sectionNode.append(createNode("h3", "", section.title));
    const list = createNode("ul");
    for (const item of section.items.slice(0, 5)) {
      const listItem = createNode("li");
      const title = createNode("strong", "", item.title);
      listItem.append(title, document.createTextNode(` ${item.body}`));
      list.append(listItem);
    }
    sectionNode.append(list);
    report.append(sectionNode);
  }

  if (saveError) {
    report.append(createNode("p", "fpca-error", saveError));
  }

  return report;
}

function renderFrontendReport(target: HTMLElement, result: AnalysisResult, saveError = ""): void {
  target.replaceChildren(renderReportNode(result, saveError));
}

function initFrontendBlocks(): void {
  for (const root of Array.from(document.querySelectorAll<HTMLElement>("[data-fpca-frontend]"))) {
    const config = settings();
    const form = root.querySelector<HTMLFormElement>("[data-fpca-form]");
    const text = root.querySelector<HTMLTextAreaElement>("[data-fpca-text]");
    const language = root.querySelector<HTMLSelectElement>("[data-fpca-language]");
    const genre = root.querySelector<HTMLSelectElement>("[data-fpca-genre]");
    const goal = root.querySelector<HTMLSelectElement>("[data-fpca-goal]");
    const sources = root.querySelector<HTMLTextAreaElement>("[data-fpca-sources]");
    const status = root.querySelector<HTMLElement>("[data-fpca-status]");
    const output = root.querySelector<HTMLElement>("[data-fpca-output]");
    const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

    if (!form || !text || !status || !output) {
      continue;
    }

    if (!config.frontendEnabled) {
      root.replaceChildren();
      continue;
    }

    let running = false;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (running) {
        return;
      }
      const submitConfig = settings();
      output.replaceChildren();
      if (!submitConfig.frontendEnabled) {
        status.textContent = "Frontend analysis is disabled.";
        return;
      }
      const input = text.value.trim();
      if (input.length < 20) {
        status.textContent = "Add more content before running analysis.";
        return;
      }
      if (input.length > submitConfig.maxInputLength) {
        status.textContent = `Keep submissions under ${submitConfig.maxInputLength} characters.`;
        return;
      }

      status.textContent = "Analyzing...";
      running = true;
      if (submit) {
        submit.disabled = true;
      }
      try {
        await nextFrame();
        const context = analysisContext({
          languageHint: (language?.value || DEFAULT_CONTEXT.languageHint) as LanguageSelection,
          genre: (genre?.value || DEFAULT_CONTEXT.genre) as GenreSelection,
          goal: (goal?.value || DEFAULT_CONTEXT.goal) as GoalSelection,
          sources: sourceLines(sources?.value ?? ""),
        });
        const result = await analyzeLocalText(input, "editorial", context);
        renderFrontendReport(output, result);
        status.textContent = "Analysis complete. Storing report...";

        await storeReport("frontend/reports", {
          inputText: input,
          mode: "editorial",
          languageHint: context.languageHint,
          genre: context.genre,
          goal: context.goal,
          analyzerVersion: submitConfig.analyzerVersion,
          result,
        }).then(() => {
          status.textContent = "Analysis complete.";
        }).catch((error) => {
          status.textContent = "Analysis complete; report was not stored.";
          renderFrontendReport(output, result, error instanceof Error ? error.message : "The report could not be stored.");
        });
      } catch (analysisError) {
        output.replaceChildren();
        status.textContent = analysisError instanceof Error ? analysisError.message : "Analysis failed.";
      } finally {
        running = false;
        if (submit) {
          submit.disabled = false;
        }
      }
    });
  }
}

function initBlockEditor(): void {
  const wp = window.wp;
  if (!wp?.blocks || !wp.element || !wp.components) {
    return;
  }

  const { createElement: h } = wp.element;
  const { PanelBody } = wp.components;

  wp.blocks.registerBlockType(BLOCK_NAME, {
    ...BLOCK_METADATA,
    edit() {
      const blockProps = wp.blockEditor?.useBlockProps?.({ className: "fpca-block fpca-block--placeholder" }) ?? {
        className: "fpca-block fpca-block--placeholder",
      };
      return h(
        "div",
        blockProps,
        h(
          PanelBody,
          { title: "Content Analyzer", initialOpen: true },
          h("p", null, "Displays a public local content-analysis form on the front end."),
          h("p", { className: "fpca-muted" }, "Reports are stored for site administrators. Visitors only see their latest result in this page session."),
        ),
      );
    },
    save() {
      return null;
    },
  });
}

function editorReportView(result: AnalysisResult, saveError: string, reportUrl: string, stale: boolean): unknown[] {
  const wp = window.wp;
  if (!wp?.element) {
    return [];
  }
  const { createElement: h } = wp.element;
  const view = buildReportView(result, "checklist");
  return [
    stale ? h("p", { className: "fpca-editor-stale", key: "stale" }, "Post content changed after this report was generated.") : null,
    h("p", { className: "fpca-report__headline", key: "headline" }, result.summary.headline),
    h("p", { className: "fpca-muted", key: "disclaimer" }, REPORT_DISCLAIMER),
    h(
      "div",
      { className: "fpca-stats", key: "stats" },
      reportStats(result).map((entry) => h("span", { key: entry }, entry)),
    ),
    ...view.sections
      .filter((section) => section.items.length > 0)
      .slice(0, 3)
      .map((section) =>
        h(
          "section",
          { className: "fpca-section", key: section.id },
          h("h3", null, section.title),
          h(
            "ul",
            null,
            section.items.slice(0, 4).map((item) =>
              h(
                "li",
                { key: item.id },
                h("strong", null, item.title),
                " ",
                item.body,
              ),
            ),
          ),
        ),
      ),
    saveError ? h("p", { className: "fpca-error", key: "save-error" }, saveError) : null,
    reportUrl ? h("p", { key: "admin-link" }, h("a", { href: reportUrl }, "View stored report")) : null,
  ].filter(Boolean);
}

function initEditorSidebar(): void {
  const wp = window.wp;
  if (!wp?.plugins || !wp.editPost || !wp.element || !wp.components || !wp.data) {
    return;
  }

  const { registerPlugin } = wp.plugins;
  const { PluginSidebar, PluginSidebarMoreMenuItem } = wp.editPost;
  const { createElement: h, Fragment, useRef, useState } = wp.element;
  const { Button, Notice, PanelBody, SelectControl, Spinner, TextareaControl } = wp.components;
  const { useSelect } = wp.data;

  function Sidebar() {
    const runningRef = useRef(false);
    const [mode, setMode] = useState<AnalysisMode>("editorial");
    const [languageHint, setLanguageHint] = useState<LanguageSelection>(DEFAULT_CONTEXT.languageHint);
    const [genre, setGenre] = useState<GenreSelection>(DEFAULT_CONTEXT.genre);
    const [goal, setGoal] = useState<GoalSelection>(DEFAULT_CONTEXT.goal);
    const [sources, setSources] = useState("");
    const [running, setRunning] = useState(false);
    const [report, setReport] = useState<AnalysisResult | null>(null);
    const [error, setError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [reportUrl, setReportUrl] = useState("");
    const [analyzedHash, setAnalyzedHash] = useState("");
    const postContent = useSelect((select) => select("core/editor")?.getEditedPostContent?.() || "", []);
    const postId = useSelect((select) => select("core/editor")?.getCurrentPostId?.() || 0, []);
    const sourceText = stripEditorMarkup(postContent);
    const currentHash = textHash(sourceText);
    const stale = Boolean(report && analyzedHash && analyzedHash !== currentHash);

    async function run() {
      if (runningRef.current) {
        return;
      }
      const config = settings();
      let generatedReport = false;
      setError("");
      setSaveError("");
      setReportUrl("");
      if (sourceText.length < 20) {
        setError("Add more post content before running analysis.");
        return;
      }
      if (sourceText.length > config.maxInputLength) {
        setError(`Keep draft analysis under ${config.maxInputLength} characters.`);
        return;
      }
      runningRef.current = true;
      setRunning(true);
      try {
        await nextFrame();
        const context = analysisContext({
          languageHint,
          genre,
          goal,
          sources: sourceLines(sources),
        });
        const nextReport = await analyzeLocalText(sourceText, mode, context);
        generatedReport = true;
        setReport(nextReport);
        setAnalyzedHash(currentHash);
        if (!postId) {
          setSaveError("Save the draft before storing this report.");
          return;
        }
        const response = await storeReport("editor/reports", {
          inputText: sourceText,
          mode,
          languageHint: context.languageHint,
          genre: context.genre,
          goal: context.goal,
          postId,
          analyzerVersion: config.analyzerVersion,
          result: nextReport,
        });
        if (response.adminUrl) {
          setReportUrl(response.adminUrl);
        }
      } catch (analysisError) {
        if (generatedReport) {
          setSaveError(analysisError instanceof Error ? analysisError.message : "The report could not be stored.");
        } else {
          setError(analysisError instanceof Error ? analysisError.message : "Analysis failed.");
        }
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    }

    return h(
      Fragment,
      null,
      h(PluginSidebarMoreMenuItem, { target: "fpca-content-analyzer" }, "Content Analyzer"),
      h(
        PluginSidebar,
        { name: "fpca-content-analyzer", title: "Content Analyzer" },
        h(
          "div",
          { className: "fpca-editor-sidebar" },
          h(
            PanelBody,
            { title: "Current draft", initialOpen: true },
            h(SelectControl, {
              label: "Mode",
              value: mode,
              options: [
                { label: "Editorial", value: "editorial" },
                { label: "Integrity", value: "integrity" },
                { label: "Research", value: "research" },
              ],
              onChange: setMode,
            }),
            h(SelectControl, {
              label: "Language",
              value: languageHint,
              options: languageOptions,
              onChange: setLanguageHint,
            }),
            h(SelectControl, {
              label: "Genre",
              value: genre,
              options: genreOptions,
              onChange: setGenre,
            }),
            h(SelectControl, {
              label: "Review focus",
              value: goal,
              options: goalOptions,
              onChange: setGoal,
            }),
            h(TextareaControl, {
              label: "Reference sources",
              value: sources,
              onChange: setSources,
              rows: 4,
              help: "One source URL, citation, or source excerpt per line. Only pasted source text is checked for claim support.",
            }),
            h(Button, { variant: "primary", onClick: run, disabled: running }, running ? "Analyzing..." : "Analyze current draft"),
            running ? h(Spinner, null) : null,
            error ? h(Notice, { status: "error", isDismissible: false }, error) : null,
          ),
          report ? h("div", { className: "fpca-report" }, ...editorReportView(report, saveError, reportUrl, stale)) : null,
        ),
      ),
    );
  }

  registerPlugin("fpca-content-analyzer", {
    icon: "analytics",
    render: Sidebar,
  });
}

initBlockEditor();
initEditorSidebar();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initFrontendBlocks, { once: true });
} else {
  initFrontendBlocks();
}
