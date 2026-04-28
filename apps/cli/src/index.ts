#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

import {
  analyze,
  analysisGoals,
  analysisModes,
  renderClaimsCsv,
  renderMarkdownReport,
  reportProfiles,
  type AnalysisRequest,
  type AnalysisMode,
  type AnalysisGoal,
  type ReportProfile,
} from "@flavorpress/analyzer-core";

type CliOptions = {
  command?: string;
  text?: string;
  url?: string;
  input?: string;
  mode?: AnalysisMode;
  goal?: AnalysisGoal;
  profile?: ReportProfile;
  languageToolUrl?: string;
  outputDir?: string;
  source: string[];
  json: boolean;
  help: boolean;
};

function validateEnum<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (allowed.includes(value as T)) {
    return value as T;
  }
  throw new Error(`Invalid ${label} '${value}'. Expected one of: ${allowed.join(", ")}.`);
}

function printHelp() {
  process.stdout.write(`FlavorPress Content Analyzer

Usage:
  flavorpress-content --help
  flavorpress-content analyze --text "Text to analyze"
  flavorpress-content analyze --url https://example.com/
  flavorpress-content analyze --input request.json --output-dir reports

Options:
  --text <text>          Text to analyze
  --url <url>            URL to fetch and analyze
  --input <path>         JSON request file
  --mode <mode>          editorial | integrity | research
  --goal <goal>          publish_ready_review | source_support | clarity_rewrite | risk_review | editorial_triage
  --profile <profile>    full | checklist | claims-csv | machine
  --languagetool-url <url>
                         Optional localhost LanguageTool server URL
  --source <value>       Reference URL/citation label or source text; repeatable
                         Only source text is checked for claim support
  --output-dir <path>    Directory for JSON and Markdown reports
  --json                 Emit NDJSON events
  --help                 Show help
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { source: [], json: false, help: false };
  const args = [...argv];
  if (args[0] === "--help" || args[0] === "-h") {
    options.help = true;
    return options;
  }
  options.command = args.shift();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value.`);
      }
      index += 1;
      return value;
    };
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--text") {
      options.text = next();
    } else if (arg === "--url") {
      options.url = next();
    } else if (arg === "--input") {
      options.input = next();
    } else if (arg === "--mode") {
      options.mode = validateEnum(next(), analysisModes, "--mode");
    } else if (arg === "--goal") {
      options.goal = validateEnum(next(), analysisGoals, "--goal");
    } else if (arg === "--profile") {
      options.profile = validateEnum(next(), reportProfiles, "--profile");
    } else if (arg === "--languagetool-url") {
      options.languageToolUrl = next();
    } else if (arg === "--source") {
      options.source.push(next());
    } else if (arg === "--output-dir") {
      options.outputDir = next();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function validateRequestEnums(request: AnalysisRequest): AnalysisRequest {
  if (request.mode) {
    validateEnum(request.mode, analysisModes, "request.mode");
  }
  if (request.metadata?.goal) {
    validateEnum(request.metadata.goal, analysisGoals, "request.metadata.goal");
  }
  if (request.options?.reportProfile) {
    validateEnum(request.options.reportProfile, reportProfiles, "request.options.reportProfile");
  }
  return request;
}

function forcePublicUrlFetching(request: AnalysisRequest): AnalysisRequest {
  if (!("url" in request)) {
    return request;
  }
  return {
    ...request,
    options: {
      ...request.options,
      allowPrivateNetwork: false,
    },
  };
}

function timestampForFileName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function resolveRequest(options: CliOptions): Promise<AnalysisRequest> {
  const inputSources = [options.input, options.text, options.url].filter(Boolean).length;
  if (inputSources !== 1) {
    throw new Error("Pass exactly one of --input, --text, or --url.");
  }

  if (options.input) {
    const request = JSON.parse(await readFile(resolve(options.input), "utf8")) as AnalysisRequest;
    return forcePublicUrlFetching(validateRequestEnums({
      ...request,
      ...(options.mode ? { mode: options.mode } : {}),
      metadata: {
        ...request.metadata,
        ...(options.goal ? { goal: options.goal } : {}),
        ...(options.source.length > 0 ? { sources: options.source } : {}),
      },
      options: {
        ...request.options,
        ...(options.profile ? { reportProfile: options.profile } : {}),
        ...(options.languageToolUrl ? { languageToolUrl: options.languageToolUrl } : {}),
      },
    }));
  }
  const mode = options.mode ?? "editorial";
  const metadata =
    options.source.length > 0 || options.goal
      ? { ...(options.goal ? { goal: options.goal } : {}), ...(options.source.length > 0 ? { sources: options.source } : {}) }
      : undefined;
  const requestOptions = {
    includeSpans: true,
    ...(options.profile ? { reportProfile: options.profile } : {}),
    ...(options.languageToolUrl ? { languageToolUrl: options.languageToolUrl } : {}),
  };
  if (options.url) {
    return { url: options.url, mode, metadata, options: { ...requestOptions, allowPrivateNetwork: false } };
  }
  if (options.text) {
    return { text: options.text, mode, metadata, options: requestOptions };
  }
  throw new Error("Pass --input, --text, or --url.");
}

function emitJson(type: string, message: string, data?: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify({ type, message, data: data ?? {}, timestamp: new Date().toISOString() })}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.command) {
    printHelp();
    return;
  }
  if (options.command !== "analyze") {
    throw new Error(`Unknown command: ${options.command}`);
  }

  const request = await resolveRequest(options);
  if (options.json) {
    emitJson("analysis.started", "Content analysis started.");
  }
  const result = await analyze(request);
  const profile = options.profile ?? result.reportProfile;
  const outputDir = resolve(options.outputDir ?? "content-analysis-output");
  await mkdir(outputDir, { recursive: true });
  const baseName = `content-analysis-${timestampForFileName()}`;
  const jsonPath = join(outputDir, `${baseName}.json`);
  const markdownPath = join(outputDir, `${baseName}.md`);
  const csvPath = profile === "claims-csv" ? join(outputDir, `${baseName}.claims.csv`) : undefined;
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdownReport(result, profile === "claims-csv" ? "checklist" : profile), "utf8");
  if (csvPath) {
    await writeFile(csvPath, renderClaimsCsv(result), "utf8");
  }

  if (options.json) {
    emitJson("analysis.completed", result.summary.headline, {
      jsonPath,
      markdownPath,
      ...(csvPath ? { csvPath } : {}),
      profile,
      result,
    });
  } else {
    process.stdout.write(profile === "claims-csv" ? renderClaimsCsv(result) : renderMarkdownReport(result, profile));
    process.stdout.write(`\nReports written to ${outputDir}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
