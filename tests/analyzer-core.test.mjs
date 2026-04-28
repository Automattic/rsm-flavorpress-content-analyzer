import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { analyze, analyzeText, analyzeTextAsync, analyzeUrl, overallQualityScore, qualityDimensionIds, renderMarkdownReport } = await import("../packages/analyzer-core/dist/index.js");
const { extractTextFromUrl, __setHostnameResolverForTests, __setUrlFetcherForTests } = await import("../packages/analyzer-core/dist/extract.js");
const articleShellHtml = readFileSync(new URL("fixtures/article-shell.html", import.meta.url), "utf8");

function repeatedSentence(seed, count) {
  return Array.from({ length: count }, (_, index) =>
    `${seed} example ${index + 1} describes a concrete workflow with specific constraints, measured outcomes, and a practical next step.`,
  ).join(" ");
}

function mockResponse(body, init, url) {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

async function withMockFetch(fetchImplementation, callback, hostnameResolver = async () => [{ address: "93.184.216.34" }]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImplementation;
  __setHostnameResolverForTests(hostnameResolver);
  __setUrlFetcherForTests(fetchImplementation);
  try {
    return await callback();
  } finally {
    __setUrlFetcherForTests();
    __setHostnameResolverForTests();
    globalThis.fetch = originalFetch;
  }
}

test("short text abstains from provenance-risk scoring", () => {
  const result = analyzeText({
    mode: "integrity",
    text: "This is a short update.",
  });

  assert.equal(result.summary.provenanceBand, "insufficient_evidence");
  assert.match(result.summary.caveats.join("\n"), /too short/i);
});

test("phrase markers alone do not produce a high risk band", () => {
  const result = analyzeText({
    mode: "integrity",
    text: [
      "It is important to note that the rollout has three measurable constraints.",
      repeatedSentence("The team", 14),
      "In conclusion, the release should stay focused on the documented customer workflow.",
    ].join(" "),
    metadata: {
      languageHint: "en",
      genre: "article",
    },
  });

  assert.notEqual(result.summary.provenanceBand, "high");
});

test("quality and provenance bands remain independent", () => {
  const result = analyzeText({
    mode: "editorial",
    text: repeatedSentence("Customer onboarding", 18),
    metadata: {
      languageHint: "en",
      genre: "support",
      audience: "customer",
    },
  });

  assert.ok(["poor", "fair", "good", "strong"].includes(result.summary.qualityBand));
  assert.ok(["low", "elevated", "high", "insufficient_evidence"].includes(result.summary.provenanceBand));
});

test("unrecognized genre hints are ignored", () => {
  const result = analyzeText({
    text: repeatedSentence("Release note", 10),
    metadata: {
      languageHint: "en",
      genre: "briefing",
    },
  });

  assert.notEqual(result.context.detectedGenre, "briefing");
  assert.ok(result.context.assumptions.some((assumption) => /not recognized/i.test(assumption)));
});

test("provided sources mark unsupported factual claims separately", () => {
  const result = analyzeText({
    mode: "editorial",
    text: "Acme Analytics launched in 2024 and has 75 percent market share in Switzerland. The product contains workflow comparison features described in the source.",
    metadata: {
      languageHint: "en",
      sources: ["The product contains workflow comparison features for editorial teams."],
    },
  });

  assert.ok(result.claims.some((claim) => claim.status === "unsupported"));
  assert.equal(result.summary.sourceBand, "mixed");
});

test("analysis exposes report sections and score provenance", () => {
  const result = analyzeText({
    mode: "research",
    text: repeatedSentence("Documentation update", 12),
    metadata: {
      languageHint: "en",
      genre: "documentation",
    },
  });

  assert.ok(result.analysisSections.some((section) => section.kind === "score_overview"));
  assert.ok(result.scoreContributions.length > 0);
  assert.ok(result.dimensions.every((dimension) => Array.isArray(dimension.reasonCodes)));
  assert.ok(result.rawMetrics.ngramRepetition[2] >= 0);
  assert.ok(result.rawMetrics.repeatedOpeningCount >= 0);
});

test("machine report profile includes raw diagnostics without research mode", () => {
  const result = analyzeText({
    text: repeatedSentence("Machine profile", 10),
    metadata: {
      languageHint: "en",
    },
    options: {
      reportProfile: "machine",
    },
  });

  assert.ok(result.rawMetrics);
  assert.ok(result.analysisSections.find((section) => section.kind === "raw_diagnostics").items.length > 0);
});

test("machine raw diagnostics include every raw metric key", () => {
  const result = analyzeText({
    text: repeatedSentence("Raw diagnostics", 10),
    metadata: {
      languageHint: "en",
    },
    options: {
      reportProfile: "machine",
    },
  });
  const diagnostics = result.analysisSections.find((section) => section.kind === "raw_diagnostics");
  const diagnosticIds = new Set(diagnostics.items.map((item) => item.id));

  for (const key of Object.keys(result.rawMetrics)) {
    if (key === "ngramRepetition") {
      for (const length of Object.keys(result.rawMetrics.ngramRepetition)) {
        assert.ok(diagnosticIds.has(`metric-ngram-repetition-${length}`), `${key}.${length} should be included`);
      }
    } else {
      assert.ok(diagnosticIds.has(`metric-${key}`), `${key} should be included`);
    }
  }
});

test("async analysis uses bundled Harper proofreading", async () => {
  const result = await analyze({
    text: "This sentnce has an eror and the the repeated word for the editor to review.",
    metadata: {
      languageHint: "en",
    },
  });

  assert.equal(result.proofreading.status, "available");
  assert.ok(result.proofreading.providers.some((provider) => provider.id === "harper-js" && provider.enabledByDefault));
  assert.ok(result.proofreading.issues.some((issue) => issue.source === "harper-js"));
});

test("inline citations are not treated as provided-material support", () => {
  const result = analyzeText({
    text: "Acme Analytics launched in 2024 and has 75 percent market share in Switzerland [1]. Editors should check current source support before publishing.",
    metadata: {
      languageHint: "en",
    },
  });

  assert.ok(result.claims.some((claim) => claim.status === "inline_citation_only"));
  assert.notEqual(result.summary.sourceBand, "supported");
  assert.ok(result.claimReview.inlineCitationOnly > 0);
});

test("short factual claims with numbers or dates are reviewed", () => {
  const result = analyzeText({
    text: "Acme launched in 2026. Acme has 75% market share.",
    metadata: {
      languageHint: "en",
      goal: "source_support",
    },
  });

  assert.ok(result.claims.some((claim) => claim.claim.includes("2026")));
  assert.ok(result.claims.some((claim) => claim.claim.includes("75%")));
});

test("inline citation labels do not become required source numbers", () => {
  const result = analyzeText({
    text: "The editorial checklist helps editors review content before publishing [1].",
    metadata: {
      languageHint: "en",
      sources: ["The editorial checklist helps editors review content before publishing."],
    },
  });
  const claim = result.claims.find((entry) => entry.claim.includes("editorial checklist"));

  assert.ok(claim);
  assert.equal(claim.status, "supported");
  assert.equal(claim.numbers.includes("1"), false);
  assert.equal(claim.supportGaps.some((gap) => /1/.test(gap)), false);
  assert.equal(claim.supportGaps.some((gap) => /source material itself was not checked/i.test(gap)), false);
  assert.deepEqual(claim.evidence, ["source-1"]);
});

test("exact short source text can fully support a factual claim", () => {
  const result = analyzeText({
    text: "Acme launched Beta in 2026 after testing.",
    metadata: {
      languageHint: "en",
      goal: "source_support",
      sources: ["Acme launched Beta in 2026 after testing."],
    },
  });
  const claim = result.claims.find((entry) => entry.claim.includes("Beta"));

  assert.ok(claim);
  assert.equal(claim.status, "supported");
  assert.deepEqual(claim.evidence, ["source-1"]);
});

test("source keyword matching uses word boundaries", () => {
  const result = analyzeText({
    text: "Acme Analytics has 75 percent market share in Switzerland in 2026.",
    metadata: {
      languageHint: "en",
      goal: "source_support",
      sources: ["Acme Analytics published a supermarket shares report about Switzerland in 2026."],
    },
  });
  const claim = result.claims.find((entry) => entry.claim.includes("market share"));

  assert.ok(claim);
  assert.notEqual(claim.status, "supported");
});

test("citation-only claims stay not checked when no source text is available", () => {
  const result = analyzeText({
    text: "Acme Analytics has 75 percent market share in Switzerland [1].",
    metadata: {
      languageHint: "en",
      goal: "source_support",
      sources: ["https://example.com/acme-analytics-market-share"],
    },
  });

  assert.ok(result.claims.some((claim) => claim.status === "inline_citation_only"));
  assert.equal(result.summary.sourceBand, "not_checked");
});

test("inline-cited claims are unsupported when provided source text does not match", () => {
  const result = analyzeText({
    text: "Acme Analytics has 75 percent market share in Switzerland [1].",
    metadata: {
      languageHint: "en",
      goal: "source_support",
      sources: ["Acme Analytics supports workflow review for editors."],
    },
  });
  const claim = result.claims.find((entry) => entry.claim.includes("market share"));

  assert.ok(claim);
  assert.equal(claim.status, "unsupported");
  assert.ok(claim.supportGaps.some((gap) => /provided material did not fully support/i.test(gap)));
  assert.equal(result.summary.sourceBand, "weakly_supported");
});

test("local proofreading issues are reported with spans", () => {
  const result = analyzeText({
    text: "This artical has a repeated repeated word and uses  two spaces in order to test the local checker.",
    metadata: {
      languageHint: "en",
      genre: "article",
    },
  });

  assert.equal(result.proofreading.status, "available");
  assert.ok(result.proofreading.issues.some((issue) => issue.kind === "spelling"));
  assert.ok(result.spans.some((span) => span.label.startsWith("proofreading_")));
});

test("disabled proofreading does not emit proofreading spans", () => {
  const result = analyzeText({
    text: "This artical has a repeated repeated word and uses  two spaces in order to test the local checker.",
    metadata: {
      languageHint: "en",
      genre: "article",
    },
    options: {
      includeSpans: true,
      includeProofreading: false,
    },
  });

  assert.equal(result.proofreading.status, "disabled");
  assert.equal(result.proofreading.issues.length, 0);
  assert.equal(result.spans.some((span) => span.label.startsWith("proofreading_")), false);
});

test("browser entry avoids URL extraction and bundled grammar engine", async () => {
  const browserCore = await import("../packages/analyzer-core/dist/browser.js");
  const browserEntry = readFileSync(new URL("../packages/analyzer-core/dist/browser.js", import.meta.url), "utf8");

  assert.equal("analyzeUrl" in browserCore, false);
  assert.equal("analyze" in browserCore, false);
  assert.equal(typeof browserCore.analyzeTextAsync, "function");
  assert.doesNotMatch(browserEntry, /text-async|proofreading-harper|harper/i);
});

test("LanguageTool proofreading rejects remote endpoints before fetch", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.doesNotMatch(String(url), /api\.languagetool\.org/);
    return await originalFetch(url, init);
  };

  try {
    const result = await analyzeTextAsync({
      text: "This sentence should not call a remote grammar service.",
      metadata: {
        languageHint: "en",
      },
      options: {
        languageToolUrl: "https://api.languagetool.org/v2/check",
      },
    });

    assert.equal(result.proofreading.status, "error");
    assert.ok(result.proofreading.providers.some((provider) => provider.id === "languagetool-local" && provider.egress === "localhost_only"));
    assert.ok(result.proofreading.caveats.some((caveat) => /localhost/i.test(caveat)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LanguageTool proofreading merges localhost issues when configured", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "http://localhost:8010/v2/check");
    assert.equal(init.method, "POST");
    return mockResponse(
      JSON.stringify({
        matches: [
          {
            message: "Possible agreement issue.",
            offset: 5,
            length: 8,
            replacements: [{ value: "sentence" }],
            rule: {
              issueType: "grammar",
              category: { id: "GRAMMAR", name: "Grammar" },
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
      "http://localhost:8010/v2/check",
    );
  };

  try {
    const result = await analyzeTextAsync({
      text: "This sentence has a configurable local grammar check.",
      metadata: {
        languageHint: "en",
      },
      options: {
        includeSpans: true,
        languageToolUrl: "http://localhost:8010",
      },
    });

    assert.equal(result.proofreading.status, "available");
    assert.ok(result.proofreading.providers.some((provider) => provider.id === "languagetool-local"));
    assert.ok(result.proofreading.issues.some((issue) => issue.source === "languagetool-local" && issue.kind === "grammar"));
    assert.ok(result.spans.some((span) => span.id?.startsWith("languagetool-")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("URL extraction blocks IPv6 private network hosts before fetch", async () => {
  await withMockFetch(async () => {
    assert.fail("private-network URL should be rejected before fetch");
  }, async () => {
    await assert.rejects(() => analyzeUrl({ url: "http://[::1]/" }), /Private-network URLs are disabled/);
    await assert.rejects(() => analyzeUrl({ url: "http://[100::1]/" }), /Private-network URLs are disabled/);
    await assert.rejects(() => analyzeUrl({ url: "http://[2001:2::1]/" }), /Private-network URLs are disabled/);
    await assert.rejects(() => analyzeUrl({ url: "http://[2001:10::1]/" }), /Private-network URLs are disabled/);
    await assert.rejects(() => analyzeUrl({ url: "http://[2002::1]/" }), /Private-network URLs are disabled/);
  });
});

test("URL extraction blocks hostnames resolving to private network addresses before fetch", async () => {
  await withMockFetch(async () => {
    assert.fail("private-network DNS result should be rejected before fetch");
  }, async () => {
    await assert.rejects(() => analyzeUrl({ url: "https://public-name.example/article" }), /Private-network URLs are disabled/);
  }, async () => [{ address: "127.0.0.1" }]);
});

test("URL extraction blocks redirects to private network hosts", async () => {
  let calls = 0;
  await withMockFetch(async (_url, init) => {
    calls += 1;
    assert.equal(init.redirect, "manual");
    return new Response(null, {
      status: 302,
      headers: {
        location: "http://[::1]/",
      },
    });
  }, async () => {
    await assert.rejects(() => analyzeUrl({ url: "https://example.com/redirect" }), /Private-network URLs are disabled/);
    assert.equal(calls, 1);
  });
});

test("URL extraction rejects unreadable content types before analysis", async () => {
  await withMockFetch(async () =>
    mockResponse("not image data", {
      status: 200,
      headers: {
        "content-type": "image/png",
      },
    }, "https://example.com/image.png"), async () => {
    await assert.rejects(() => analyzeUrl({ url: "https://example.com/image.png" }), /not readable text or HTML/);
  });
});

test("URL extraction rejects oversized content-length headers", async () => {
  await withMockFetch(async () =>
    mockResponse("", {
      status: 200,
      headers: {
        "content-type": "text/plain",
        "content-length": "2000001",
      },
    }, "https://example.com/large.txt"), async () => {
    await assert.rejects(() => analyzeUrl({ url: "https://example.com/large.txt" }), /too large/);
  });
});

test("URL extraction rejects oversized response bodies", async () => {
  await withMockFetch(async () =>
    mockResponse("x".repeat(2_000_001), {
      status: 200,
      headers: {
        "content-type": "text/plain",
      },
    }, "https://example.com/large-body.txt"), async () => {
    await assert.rejects(() => analyzeUrl({ url: "https://example.com/large-body.txt" }), /too large/);
  });
});

test("URL extraction resolves relative redirects and decodes readable HTML entities", async () => {
  const seenUrls = [];
  await withMockFetch(async (url) => {
    seenUrls.push(String(url));
    if (seenUrls.length === 1) {
      return new Response(null, {
        status: 302,
        headers: {
          location: "../article",
        },
      });
    }

    return mockResponse(
      "<html><head><title>Editorial &amp; Source Notes</title></head><body><article><h1>Heading</h1><p>Alpha &amp; beta &lt; gamma &quot;quoted&quot; &#39;text&#39; describes the release notes.</p></article></body></html>",
      {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      },
      "https://example.com/article",
    );
  }, async () => {
    const extracted = await extractTextFromUrl({ url: "https://example.com/path/start" });

    assert.deepEqual(seenUrls, ["https://example.com/path/start", "https://example.com/article"]);
    assert.equal(extracted.context.finalUrl, "https://example.com/article");
    assert.match(extracted.text, /Alpha & beta < gamma "quoted" 'text'/);
  });
});

test("URL extraction removes non-content tags with spaced end tags", async () => {
  await withMockFetch(async () =>
    mockResponse(
      "<html><body><article><h1>Useful article</h1><script>hidden launch token</script ><style>.secret{display:block}</style ><p>Visible editorial guidance for reviewers.</p></article></body></html>",
      {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      },
      "https://example.com/spaced-tags",
    ), async () => {
    const extracted = await extractTextFromUrl({ url: "https://example.com/spaced-tags" });

    assert.match(extracted.text, /Useful article/);
    assert.match(extracted.text, /Visible editorial guidance/);
    assert.doesNotMatch(extracted.text, /hidden launch token|secret/);
  });
});

test("URL extraction prefers readable article body over page chrome", async () => {
  await withMockFetch(async () =>
    mockResponse(
      articleShellHtml,
      {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      },
      "https://example.com/article-shell",
    ), async () => {
    const extracted = await extractTextFromUrl({ url: "https://example.com/article-shell" });

    assert.match(extracted.text, /Creator workflow notes/);
    assert.match(extracted.text, /source-checking guidance/);
    assert.match(extracted.text, /Alice's editor note uses numeric ’ and hex ’ apostrophes/);
    assert.doesNotMatch(extracted.text, /Navigation item login/);
    assert.doesNotMatch(extracted.text, /Newsletter signup/);
    assert.ok(extracted.context.notes.some((note) => /article body/i.test(note)));
  });
});

test("URL extraction rejects excessive redirect chains", async () => {
  let calls = 0;
  await withMockFetch(async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: {
        location: `/next-${calls}`,
      },
    });
  }, async () => {
    await assert.rejects(() => analyzeUrl({ url: "https://example.com/start" }), /redirected too many times/);
    assert.equal(calls, 6);
  });
});

test("URL extraction records low-confidence extraction notes", async () => {
  await withMockFetch(async () =>
    mockResponse("<html><body><p>Tiny article body.</p></body></html>", {
      status: 200,
      headers: {
        "content-type": "text/html",
      },
    }, "https://example.com/tiny"), async () => {
    const result = await analyzeUrl({ url: "https://example.com/tiny" });

    assert.ok(result.context.extraction.confidence < 0.5);
    assert.ok(result.context.extraction.notes.some((note) => /limited text/i.test(note)));
    assert.ok(result.context.assumptions.some((assumption) => /extraction confidence is low/i.test(assumption)));
  });
});

test("claims-csv markdown rendering still returns Markdown", () => {
  const result = analyzeText({
    text: "Acme Analytics launched in 2024 and supports editorial workflows for review teams.",
    metadata: {
      languageHint: "en",
    },
  });
  const markdown = renderMarkdownReport(result, "claims-csv");

  assert.match(markdown, /^# Content Analysis Report/m);
  assert.doesNotMatch(markdown.split("\n")[0], /"id","status"/);
});

test("source support concern is reflected in headline before provenance abstention", () => {
  const result = analyzeText({
    text: "Acme Analytics has 75 percent market share.",
    metadata: {
      languageHint: "en",
      goal: "source_support",
      sources: ["Acme Analytics supports editorial workflows."],
    },
  });

  assert.match(result.summary.headline, /source review/i);
});

test("review focus changes top action ranking", () => {
  const text = [
    "Nova Billing launched in 2026 and has 81 percent market share in Europe.",
    "This artical is designed to facilitate operational alignment for teams.",
    "Editors should review the rollout, update examples, and choose one next step.",
  ].join(" ");
  const sourceFocused = analyzeText({
    text,
    metadata: {
      languageHint: "en",
      goal: "source_support",
      sources: ["Nova Billing offers payment workflow templates for small teams."],
    },
  });
  const clarityFocused = analyzeText({
    text,
    metadata: {
      languageHint: "en",
      goal: "clarity_rewrite",
      sources: ["Nova Billing offers payment workflow templates for small teams."],
    },
  });
  const sourceTop = sourceFocused.analysisSections.find((section) => section.kind === "top_actions").items[0];
  const clarityTop = clarityFocused.analysisSections.find((section) => section.kind === "top_actions").items[0];

  assert.equal(sourceTop.metadata.kind, "claim");
  assert.equal(clarityTop.metadata.kind, "proofreading");
  assert.match(sourceTop.body, /Add source evidence|Claim:/);
});

test("claim review exposes support need, gaps, and recommended action", () => {
  const result = analyzeText({
    text: "Acme Analytics launched in 2026 and has 75 percent market share in Switzerland. Editors can use the checklist before publishing.",
    metadata: {
      languageHint: "en",
      goal: "source_support",
      sources: ["The checklist helps editors prepare content before publishing."],
    },
  });
  const marketShareClaim = result.claims.find((claim) => claim.claim.includes("market share"));

  assert.equal(marketShareClaim.status, "unsupported");
  assert.equal(marketShareClaim.supportNeed, "essential");
  assert.ok(marketShareClaim.supportGaps.some((gap) => /number|current|source/i.test(gap)));
  assert.match(marketShareClaim.recommendedAction, /source evidence|qualify/i);
  assert.ok(result.analysisSections.find((section) => section.kind === "claim_review").items.some((item) => item.metadata.supportNeed === "essential"));
});

test("report sections classify quality and provenance dimensions by analyzer origin", () => {
  const result = analyzeText({
    text: [
      "Acme Analytics launched a review workflow for enterprise publishers and describes measurable coordination outcomes for managers across regional editorial teams.",
      "The product explains calendar planning, assignment review, approval tracking, campaign governance, escalation handling, and reporting in one continuous overview for the same reader.",
      "Editors receive general information about speed, collaboration, quality, reliability, publishing alignment, and workflow visibility across several operational situations.",
      "The draft repeats many broad benefits without a heading, a source citation, a concrete example, or a clearly separated next step for the author.",
      "Marketing managers can understand the promise, but the document does not explain why the results happen, what constraints apply, or what proof supports the numbers.",
      "This final sentence adds more institutional description so the paragraph stays dense enough to exercise structure and evidence review behavior.",
      "The same overview also mentions customer readiness, campaign quality, publishing confidence, operational resilience, analytics visibility, decision speed, and team alignment without attaching a reference.",
      "Another broad sentence adds implementation, governance, collaboration, and scale claims so the evidence-density dimension has enough factual material to inspect.",
      "A final broad claim says the workflow improves stakeholder confidence, editorial throughput, regional consistency, and measurable readiness while still omitting the evidence an editor would need.",
    ].join(" "),
    metadata: {
      languageHint: "en",
      genre: "marketing",
      goal: "clarity_rewrite",
    },
  });

  const writing = result.analysisSections.find((section) => section.kind === "writing_quality");
  const provenance = result.analysisSections.find((section) => section.kind === "provenance_risk");
  const writingIds = writing.items.map((item) => item.id);
  const provenanceIds = provenance.items.map((item) => item.id);

  assert.ok(writingIds.includes("structure"));
  assert.ok(writingIds.includes("depth"));
  assert.ok(writingIds.includes("evidence_density"));
  assert.equal(provenanceIds.includes("structure"), false);
  assert.equal(provenanceIds.includes("depth"), false);
  assert.equal(provenanceIds.includes("tone_fit"), false);
  assert.ok(qualityDimensionIds.includes("evidence_density"));
  assert.equal(overallQualityScore(result.dimensions), Math.round(result.dimensions.filter((dimension) => qualityDimensionIds.includes(dimension.id)).reduce((sum, dimension) => sum + dimension.score, 0) / qualityDimensionIds.length));
});

test("content audit section surfaces author-facing audit scorecards", () => {
  const result = analyzeText({
    text: "This artical explains a product update with one broad claim about faster review. Editors should check the source, fix spelling, and publish the clearer version after approval.",
    metadata: {
      languageHint: "en",
      goal: "publish_ready_review",
    },
  });
  const audit = result.analysisSections.find((section) => section.kind === "content_audit");

  assert.ok(audit);
  assert.ok(audit.items.some((item) => item.id === "audit-plain-language"));
  assert.ok(audit.items.some((item) => item.id === "audit-scannability"));
  assert.ok(audit.items.some((item) => item.id === "audit-evidence-readiness"));
  assert.ok(audit.items.every((item) => item.metadata?.kind));
  assert.equal(audit.items.find((item) => item.id === "audit-provenance-risk").score, undefined);
});

test("content audit scannability separates dense and structured drafts", () => {
  const dense = analyzeText({
    text: [
      "This dense paragraph deliberately contains a long sentence about planning, evidence review, publishing approval, workflow ownership, customer examples, source validation, legal caveats, stakeholder signoff, launch timing, campaign governance, escalation handling, analytics visibility, and operational readiness without giving the reader any visual break or list.",
      "Another dense sentence keeps adding related details about managers, editors, administrators, customers, reviewers, documentation, support workflows, and final publishing confidence while still avoiding headings or task-oriented structure.",
    ].join(" "),
    metadata: {
      languageHint: "en",
      genre: "article",
    },
  });
  const structured = analyzeText({
    text: [
      "Review the release note",
      "",
      "1. Check the source excerpt.",
      "2. Confirm the launch date.",
      "3. Add the final publishing decision.",
      "",
      "This short procedure gives editors a clear sequence and keeps each step easy to scan before approval.",
    ].join("\n"),
    metadata: {
      languageHint: "en",
      genre: "support",
    },
  });
  const denseScan = dense.analysisSections
    .find((section) => section.kind === "content_audit")
    .items.find((item) => item.id === "audit-scannability");
  const structuredScan = structured.analysisSections
    .find((section) => section.kind === "content_audit")
    .items.find((item) => item.id === "audit-scannability");

  assert.ok(denseScan.score < structuredScan.score);
  assert.match(denseScan.body, /clearer sectioning|shorter blocks|task-oriented lists/);
  assert.notEqual(denseScan.status, "good");
});

test("URL-only reference sources are not treated as checked source evidence", () => {
  const result = analyzeText({
    text: "Acme Analytics has 75 percent market share in Switzerland.",
    metadata: {
      languageHint: "en",
      goal: "source_support",
      sources: ["https://example.com/acme-analytics-market-share-switzerland-75-percent"],
    },
  });
  const claim = result.claims.find((entry) => entry.claim.includes("market share"));

  assert.ok(claim);
  assert.notEqual(claim.status, "supported");
  assert.equal(claim.status, "not_checked");
  assert.equal(claim.supportNeed, "essential");
  assert.ok(result.claimReview.caveats.some((caveat) => /did not include source text/i.test(caveat)));
  const evidenceAudit = result.analysisSections
    .find((section) => section.kind === "content_audit")
    .items.find((item) => item.id === "audit-evidence-readiness");
  assert.equal(evidenceAudit.metadata.unresolvedClaims, 1);
  assert.equal(evidenceAudit.status, "review");
  assert.equal(evidenceAudit.severity, "medium");
  assert.match(evidenceAudit.body, /1 need source support/);
});

test("conflicting source numbers become partial support instead of supported", () => {
  const result = analyzeText({
    text: "Acme Analytics has 75 percent market share in Switzerland in 2026.",
    metadata: {
      languageHint: "en",
      goal: "source_support",
      sources: ["Acme Analytics has 12 percent market share in Switzerland in 2026."],
    },
  });
  const claim = result.claims.find((entry) => entry.claim.includes("market share"));

  assert.ok(claim);
  assert.equal(claim.status, "partially_supported");
  assert.ok(claim.supportGaps.some((gap) => /75/.test(gap)));
  assert.equal(result.claimReview.supportedByProvidedMaterial, 0);
});

test("negated source material does not support the opposite claim", () => {
  const result = analyzeText({
    text: "Acme Analytics has 75 percent market share in Switzerland in 2026.",
    metadata: {
      languageHint: "en",
      goal: "source_support",
      sources: ["Acme Analytics does not have 75 percent market share in Switzerland in 2026."],
    },
  });
  const claim = result.claims.find((entry) => entry.claim.includes("market share"));

  assert.ok(claim);
  assert.notEqual(claim.status, "supported");
  assert.ok(claim.supportGaps.some((gap) => /negate/i.test(gap)));
  assert.equal(result.claimReview.supportedByProvidedMaterial, 0);
});

test("reverse negation in claim does not match affirmative source material", () => {
  const result = analyzeText({
    text: "Acme Analytics does not have 75 percent market share in Switzerland in 2026.",
    metadata: {
      languageHint: "en",
      goal: "source_support",
      sources: ["Acme Analytics has 75 percent market share in Switzerland in 2026."],
    },
  });
  const claim = result.claims.find((entry) => entry.claim.includes("market share"));

  assert.ok(claim);
  assert.notEqual(claim.status, "supported");
  assert.ok(claim.supportGaps.some((gap) => /negate/i.test(gap)));
  assert.equal(result.claimReview.supportedByProvidedMaterial, 0);
});

test("named-entity mismatches block full source support", () => {
  const result = analyzeText({
    text: "Acme Analytics has 75 percent market share in Switzerland in 2026.",
    metadata: {
      languageHint: "en",
      goal: "source_support",
      sources: ["Acme Analytics has 75 percent market share in Austria in 2026."],
    },
  });
  const claim = result.claims.find((entry) => entry.claim.includes("market share"));

  assert.ok(claim);
  assert.notEqual(claim.status, "supported");
  assert.ok(claim.supportGaps.some((gap) => /Switzerland/.test(gap)));
  assert.equal(result.claimReview.supportedByProvidedMaterial, 0);
});

test("unrelated source negation does not block a supported claim", () => {
  const result = analyzeText({
    text: "Acme Analytics has 75 percent market share in Switzerland in 2026.",
    metadata: {
      languageHint: "en",
      goal: "source_support",
      sources: ["Acme Analytics does not support PDF exports. Acme Analytics has 75 percent market share in Switzerland in 2026."],
    },
  });
  const claim = result.claims.find((entry) => entry.claim.includes("market share"));

  assert.ok(claim);
  assert.equal(claim.status, "supported");
  assert.equal(claim.supportGaps.some((gap) => /negate/i.test(gap)), false);
});

test("provenance top actions use high-risk severity direction", () => {
  const text = Array.from({ length: 16 }, () =>
    "It is important to note that the workflow provides standardized benefits, structured guidance, repeated conclusions, and consistent operational alignment for every team.",
  ).join(" ");
  const result = analyzeText({
    mode: "integrity",
    text,
    metadata: {
      languageHint: "en",
      goal: "risk_review",
    },
  });
  const provenanceAction = result.analysisSections
    .find((section) => section.kind === "top_actions")
    .items.find((item) => item.metadata?.kind === "provenance" && item.score >= 60);

  assert.ok(provenanceAction);
  assert.notEqual(provenanceAction.severity, "low");
});

test("research diagnostics include actionable scannability and n-gram metrics", () => {
  const result = analyzeText({
    mode: "research",
    text: [
      "This sentence deliberately contains many connected clauses about editorial planning, source review, publishing approval, workflow ownership, quality gates, stakeholder coordination, final accountability, regional handoffs, stakeholder signoffs, customer examples, legal caveats, launch timing, and publishing governance so the analyzer can flag a very long sentence.",
      repeatedSentence("Review workflow", 8),
    ].join(" "),
    metadata: {
      languageHint: "en",
      genre: "documentation",
    },
  });
  const raw = result.analysisSections.find((section) => section.kind === "raw_diagnostics");
  const scannability = result.dimensions.find((dimension) => dimension.id === "scannability");

  assert.ok(result.rawMetrics.maxSentenceWords > 35);
  assert.ok(result.rawMetrics.veryLongSentenceCount > 0);
  assert.ok(scannability.score < 90);
  assert.ok(raw.items.some((item) => item.id === "metric-ngram-repetition-2"));
});
