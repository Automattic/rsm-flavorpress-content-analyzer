import test from "node:test";
import assert from "node:assert/strict";

const { analyzeText } = await import("../packages/analyzer-core/dist/index.js");

const fixtures = [
  {
    name: "short draft abstains instead of overclaiming",
    input: {
      text: "Launch update: the editor workflow is ready.",
      metadata: { languageHint: "en", goal: "editorial_triage" },
    },
    expect(result) {
      assert.equal(result.summary.provenanceBand, "insufficient_evidence");
      assert.ok(result.analysisSections.some((section) => section.kind === "caveats" && section.items.length > 0));
    },
  },
  {
    name: "unsupported market claim becomes source action",
    input: {
      text: "Acme Analytics launched in 2026 and has 75 percent market share in Switzerland. The draft also explains that editors can compare workflow notes before publishing.",
      metadata: {
        languageHint: "en",
        goal: "source_support",
        sources: ["Editors can compare workflow notes before publishing."],
      },
    },
    expect(result) {
      const top = result.analysisSections.find((section) => section.kind === "top_actions").items[0];
      assert.equal(top.metadata.kind, "claim");
      assert.equal(result.summary.sourceBand, "mixed");
      assert.ok(result.claims.some((claim) => claim.supportNeed === "essential"));
    },
  },
  {
    name: "inline citation remains citation presence only",
    input: {
      text: "Acme Analytics launched in 2026 and has 75 percent market share in Switzerland [1]. Editors should attach the actual source before publishing.",
      metadata: { languageHint: "en", goal: "source_support" },
    },
    expect(result) {
      assert.ok(result.claims.some((claim) => claim.status === "inline_citation_only"));
      assert.notEqual(result.summary.sourceBand, "supported");
    },
  },
  {
    name: "supported operational claim stays supported by provided material",
    input: {
      text: "The editorial checklist helps editors review content before publishing. The workflow comparison panel shows draft quality signals before final approval.",
      metadata: {
        languageHint: "en",
        goal: "publish_ready_review",
        sources: [
          "The editorial checklist helps editors review content before publishing.",
          "The workflow comparison panel shows draft quality signals before final approval.",
        ],
      },
    },
    expect(result) {
      assert.ok(result.claimReview.supportedByProvidedMaterial >= 1);
      assert.equal(result.claimReview.unsupportedClaims, 0);
    },
  },
  {
    name: "formal legal prose does not become high provenance risk from formality alone",
    input: {
      text: "This policy establishes retention responsibilities for account records. The administrator shall review access logs quarterly, document exceptions, and notify the owner when remediation is required. These controls apply to production systems, archived exports, and support records used for audit response.",
      metadata: { languageHint: "en", genre: "policy", goal: "risk_review" },
    },
    expect(result) {
      assert.notEqual(result.summary.provenanceBand, "high");
      assert.equal(result.context.detectedGenre, "policy");
    },
  },
  {
    name: "marketing copy without a next step receives actionability advice",
    input: {
      text: "Our platform brings teams together through a modern workspace for planning, reviewing, and publishing content. It centralizes feedback, simplifies coordination, and gives managers a clear view of progress across active campaigns and editorial workstreams.",
      metadata: { languageHint: "en", genre: "marketing", goal: "clarity_rewrite" },
    },
    expect(result) {
      assert.ok(result.analysisSections.find((section) => section.kind === "top_actions").items.some((item) => /next step|concrete|specific/i.test(item.body)));
    },
  },
  {
    name: "support documentation with steps is treated as structured content",
    input: {
      text: "Reset the content review queue\n\n1. Open the workspace settings.\n2. Select Review queues.\n3. Choose the queue that needs a reset.\n4. Save the updated reviewer assignment.\n\nThis procedure preserves existing comments and only changes future reviewer routing.",
      metadata: { languageHint: "en", genre: "support", goal: "publish_ready_review" },
    },
    expect(result) {
      assert.equal(result.context.detectedGenre, "support");
      assert.notEqual(result.summary.qualityBand, "poor");
      assert.equal(result.claimReview.unsupportedClaims, 0);
      assert.ok(result.claimReview.totalClaims <= 1);
    },
  },
  {
    name: "academic prose keeps source caveats separate from authorship risk",
    input: {
      text: "The study examines editorial queue latency across distributed teams. Methodology: reviewers recorded queue transitions for six weeks and compared time-to-decision across three workflow variants. Results suggest that smaller reviewer pools reduced handoff delay but increased escalation frequency.",
      metadata: { languageHint: "en", genre: "academic", goal: "risk_review" },
    },
    expect(result) {
      assert.notEqual(result.summary.provenanceBand, "high");
      assert.ok(result.claimReview.caveats.some((caveat) => /No source material/i.test(caveat)));
    },
  },
  {
    name: "non-native English receives useful quality advice without high risk",
    input: {
      text: "The team make a new process for review content before publish. It include three steps, because editors need check source, fix spelling, and decide final action. This document is for customer support writers who need clear instruction.",
      metadata: { languageHint: "en", goal: "clarity_rewrite", audience: "support writers" },
    },
    expect(result) {
      assert.notEqual(result.summary.provenanceBand, "high");
      assert.ok(result.analysisSections.find((section) => section.kind === "top_actions").items.length > 0);
    },
  },
  {
    name: "URL-like source material does not imply verified truth",
    input: {
      text: "The release reduced review time by 42 percent and is currently the fastest workflow available for enterprise publishers. See https://example.com/report for details.",
      metadata: { languageHint: "en", goal: "source_support" },
    },
    expect(result) {
      assert.ok(result.claims.some((claim) => claim.status === "inline_citation_only"));
      assert.notEqual(result.summary.sourceBand, "supported");
    },
  },
];

for (const fixture of fixtures) {
  test(`report quality fixture: ${fixture.name}`, () => {
    const result = analyzeText(fixture.input);
    fixture.expect(result);
  });
}
