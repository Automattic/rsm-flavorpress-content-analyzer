import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { analyzeText, analyzeTextAsync } from "../packages/analyzer-core/dist/index.js";
import { __setHostnameResolverForTests, __setUrlFetcherForTests, extractTextFromUrl } from "../packages/analyzer-core/dist/extract.js";

const baseParagraph = [
  "The editorial workflow describes concrete source-review steps, measurable constraints, and a clear publishing action for the team.",
  "Editors compare evidence, resolve unsupported claims, and keep provenance-risk caveats separate from writing-quality findings.",
  "The report remains local, deterministic, and designed for human review rather than authorship certification.",
].join(" ");
const largeText = Array.from({ length: 260 }, () => baseParagraph).join("\n\n");

const claimParagraph = [
  "Acme Analytics launched in 2026 and has 75 percent market share in Switzerland.",
  "The editorial checklist helps editors review content before publishing.",
  "The workflow comparison panel shows draft quality signals before final approval.",
].join(" ");
const claimText = Array.from({ length: 80 }, (_, index) => `${claimParagraph} Claim batch ${index + 1} includes source review context.`).join("\n\n");
const claimSources = [
  "The editorial checklist helps editors review content before publishing.",
  "The workflow comparison panel shows draft quality signals before final approval.",
  "Acme Analytics has 12 percent market share in Switzerland in 2026.",
];

const proofreadingText = Array.from({ length: 40 }, () =>
  "This sentnce has an eror and the the repeated word for the editor to review before publishing.",
).join(" ");
const articleShellHtml = readFileSync(new URL("../tests/fixtures/article-shell.html", import.meta.url), "utf8");

function mockResponse(body, init, url) {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

async function extractFixtureUrl() {
  __setHostnameResolverForTests(async () => [{ address: "93.184.216.34" }]);
  __setUrlFetcherForTests(async (url) =>
    mockResponse(
      articleShellHtml,
      {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      },
      url,
    ),
  );
  try {
    return await extractTextFromUrl({ url: "https://example.com/article-shell" });
  } finally {
    __setUrlFetcherForTests();
    __setHostnameResolverForTests();
  }
}

async function measure(label, budgetMs, run, validate) {
  await run();
  const samples = [];
  let lastResult;
  for (let index = 0; index < 3; index += 1) {
    const started = performance.now();
    lastResult = await run();
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const medianMs = samples[1];
  validate(lastResult);
  if (medianMs > budgetMs) {
    throw new Error(`${label} benchmark exceeded ${budgetMs}ms median: ${Math.round(medianMs)}ms.`);
  }
  return { label, medianMs, result: lastResult };
}

const cases = [
  await measure(
    "deterministic large analysis",
    1_500,
    () =>
      analyzeText({
        mode: "research",
        text: largeText,
        metadata: {
          languageHint: "en",
          genre: "documentation",
          goal: "editorial_triage",
        },
        options: {
          includeRawMetrics: true,
          includeSpans: true,
        },
      }),
    (result) => {
      if (result.context.wordCount < 7_000) {
        throw new Error("Large benchmark fixture did not produce enough words.");
      }
    },
  ),
  await measure(
    "claim source matching",
    1_200,
    () =>
      analyzeText({
        mode: "research",
        text: claimText,
        metadata: {
          languageHint: "en",
          genre: "documentation",
          goal: "source_support",
          sources: claimSources,
        },
        options: {
          includeRawMetrics: true,
          includeSpans: true,
        },
      }),
    (result) => {
      if (result.claimReview.totalClaims < 20 || result.claimReview.partiallySupportedByProvidedMaterial === 0) {
        throw new Error("Claim benchmark fixture did not exercise source matching.");
      }
    },
  ),
  await measure(
    "url extraction",
    400,
    () => extractFixtureUrl(),
    (extracted) => {
      if (!extracted.text.includes("Creator workflow notes") || extracted.text.includes("Navigation item login")) {
        throw new Error("URL extraction benchmark fixture did not exercise readable article extraction.");
      }
    },
  ),
  await measure(
    "async local proofreading",
    4_000,
    () =>
      analyzeTextAsync({
        mode: "editorial",
        text: proofreadingText,
        metadata: {
          languageHint: "en",
          genre: "documentation",
          goal: "clarity_rewrite",
        },
        options: {
          includeSpans: true,
        },
      }),
    (result) => {
      if (!result.proofreading.issues.some((issue) => issue.source === "harper-js")) {
        throw new Error("Proofreading benchmark fixture did not exercise Harper.");
      }
    },
  ),
];

const summary = cases
  .map((entry) => `${entry.label}: ${Math.round(entry.medianMs)}ms`)
  .join("; ");
process.stdout.write(`Analyzer benchmarks passed (${summary}).\n`);
