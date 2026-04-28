(function() {
  "use strict";
  const analysisModes = ["editorial", "integrity", "research"];
  const analysisGoals = [
    "publish_ready_review",
    "source_support",
    "clarity_rewrite",
    "risk_review",
    "editorial_triage"
  ];
  const analysisGenres = [
    "general",
    "article",
    "marketing",
    "support",
    "documentation",
    "policy",
    "legal",
    "academic",
    "corporate"
  ];
  const supportedLanguages = ["en", "es", "pt", "fr", "de"];
  const qualityDimensionIds = [
    "readability",
    "scannability",
    "bloat",
    "specificity",
    "depth",
    "structure",
    "tone_fit",
    "actionability",
    "evidence_density",
    "mechanics",
    "readability_formula"
  ];
  const provenanceDimensionIds = [
    "lexical_repetition",
    "discourse_regularity",
    "connector_density",
    "formatting_density",
    "sentence_rhythm",
    "register_mismatch",
    "specific_texture"
  ];
  const qualityDimensionIdSet = new Set(qualityDimensionIds);
  const provenanceDimensionIdSet = new Set(provenanceDimensionIds);
  function isQualityDimension(dimension) {
    return qualityDimensionIdSet.has(dimension.id);
  }
  function isProvenanceDimension(dimension) {
    return provenanceDimensionIdSet.has(dimension.id);
  }
  function dimensionKind(dimension) {
    return isProvenanceDimension(dimension) ? "provenance" : "quality";
  }
  function percent(value) {
    return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  }
  function compactLabel$1(value) {
    return value.replace(/_/g, " ");
  }
  function readableGoal(goal) {
    return goal ? compactLabel$1(goal) : "balanced review";
  }
  function severityForScore(score, inverted = false) {
    const value = inverted ? 100 - score : score;
    if (value >= 72) {
      return "high";
    }
    if (value >= 45) {
      return "medium";
    }
    return "low";
  }
  function topDimensionItems(dimensions, inverted = false, limit = 8) {
    return dimensions.filter((dimension) => dimension.findings.length > 0).sort((left, right) => inverted ? left.score - right.score : right.score - left.score).slice(0, limit).map((dimension) => ({
      id: dimension.id,
      title: dimension.label,
      body: dimension.findings[0],
      severity: severityForScore(dimension.score, inverted),
      score: dimension.score,
      metadata: {
        confidence: percent(dimension.confidence),
        metrics: dimension.metricIds.slice(0, 4).join(", ")
      }
    }));
  }
  function claimActionTitle(result) {
    const goal = result.inputSummary.goal;
    if (goal === "source_support") {
      return "Add source support";
    }
    if (goal === "risk_review") {
      return "Review high-risk claim";
    }
    return "Resolve claim support";
  }
  function dimensionActionTitle(dimension) {
    if (dimension.id === "specificity") {
      return "Make this more concrete";
    }
    if (dimension.id === "depth") {
      return "Add reasoning depth";
    }
    if (dimension.id === "structure") {
      return "Improve scan structure";
    }
    if (dimension.id === "actionability") {
      return "Clarify the next step";
    }
    if (dimension.id === "readability" || dimension.id === "readability_formula") {
      return "Improve readability";
    }
    return `Improve ${dimension.label.toLowerCase()}`;
  }
  function supportNeedRank(value) {
    if (value === "essential") {
      return 4;
    }
    if (value === "important") {
      return 3;
    }
    if (value === "recommended") {
      return 2;
    }
    return 0;
  }
  function severityRank(value) {
    if (value === "high") {
      return 3;
    }
    if (value === "medium") {
      return 2;
    }
    if (value === "low") {
      return 1;
    }
    return 0;
  }
  function actionWeight(item, goal) {
    var _a, _b;
    const kind = String(((_a = item.metadata) == null ? void 0 : _a.kind) ?? "");
    const severity = severityRank(item.severity);
    const supportNeed = supportNeedRank(typeof ((_b = item.metadata) == null ? void 0 : _b.supportNeed) === "string" ? item.metadata.supportNeed : void 0);
    const score = typeof item.score === "number" ? kind === "provenance" ? Math.max(0, item.score) / 10 : Math.max(0, 100 - item.score) / 10 : 0;
    const base = severity * 10 + supportNeed * 14 + score;
    if (goal === "source_support") {
      return base + (kind === "claim" ? 90 : kind === "proofreading" ? 8 : 15);
    }
    if (goal === "clarity_rewrite") {
      return base + (kind === "proofreading" ? 120 : kind === "quality" ? 90 : kind === "claim" ? 0 : 10);
    }
    if (goal === "risk_review") {
      return base + (kind === "claim" ? 75 : kind === "provenance" ? 72 : kind === "quality" ? 20 : 10);
    }
    if (goal === "publish_ready_review") {
      return base + (kind === "claim" ? 70 : kind === "proofreading" ? 55 : kind === "quality" ? 45 : 25);
    }
    return base + (kind === "claim" ? 55 : kind === "quality" ? 45 : kind === "proofreading" ? 35 : 30);
  }
  function topActions(result) {
    const claimActions = result.claims.filter((claim) => claim.supportNeed !== "none" || claim.status === "unsupported" || claim.status === "inline_citation_only" || claim.freshnessRisk).map((claim) => ({
      id: `claim-action-${claim.id}`,
      title: claimActionTitle(result),
      body: `${claim.recommendedAction} Claim: ${claim.claim}`,
      severity: claim.importance,
      status: compactLabel$1(claim.status),
      metadata: {
        kind: "claim",
        supportNeed: claim.supportNeed,
        gaps: claim.supportGaps.slice(0, 2).join(" | ")
      }
    }));
    const proofreadActions = result.proofreading.issues.filter((issue2) => issue2.severity !== "low").slice(0, 4).map((issue2) => ({
      id: `proofreading-action-${issue2.id}`,
      title: `Fix ${issue2.kind}`,
      body: issue2.suggestions[0] ? `${issue2.message} Suggested replacement: ${issue2.suggestions[0]}.` : issue2.message,
      severity: issue2.severity,
      status: issue2.source,
      metadata: {
        kind: "proofreading",
        confidence: percent(issue2.confidence)
      }
    }));
    const dimensionActions = result.dimensions.filter((dimension) => dimension.findings.length > 0 && dimension.recommendations.length > 0).map((dimension) => {
      const kind = dimensionKind(dimension);
      return {
        id: `dimension-action-${dimension.id}`,
        title: dimensionActionTitle(dimension),
        body: `${dimension.recommendations[0]} Signal: ${dimension.findings[0]}`,
        severity: severityForScore(dimension.score, kind === "quality"),
        score: dimension.score,
        metadata: {
          kind,
          confidence: percent(dimension.confidence),
          metrics: dimension.metricIds.slice(0, 3).join(", ")
        }
      };
    });
    return [...claimActions, ...proofreadActions, ...dimensionActions].sort((left, right) => actionWeight(right, result.inputSummary.goal) - actionWeight(left, result.inputSummary.goal)).slice(0, 8);
  }
  function dimensionScore(result, ids) {
    const matches = result.dimensions.filter((dimension) => ids.includes(dimension.id));
    if (matches.length === 0) {
      return void 0;
    }
    return Math.round(matches.reduce((total, dimension) => total + dimension.score, 0) / matches.length);
  }
  function statusForAuditScore(score, inverted = false) {
    if (score === void 0) {
      return "not checked";
    }
    const value = inverted ? 100 - score : score;
    if (value >= 78) {
      return "strong";
    }
    if (value >= 62) {
      return "good";
    }
    if (value >= 42) {
      return "review";
    }
    return "needs work";
  }
  function severityForAuditScore(score, inverted = false) {
    if (score === void 0) {
      return "low";
    }
    const value = inverted ? 100 - score : score;
    if (value < 45) {
      return "high";
    }
    if (value < 65) {
      return "medium";
    }
    return "low";
  }
  function contentAuditItems(result) {
    const readabilityScore = dimensionScore(result, ["readability", "scannability", "mechanics", "readability_formula"]);
    const readerValueScore = dimensionScore(result, ["specificity", "depth", "actionability"]);
    const structureScore = dimensionScore(result, ["structure", "scannability"]);
    const evidenceScore = dimensionScore(result, ["evidence_density"]);
    const unresolvedClaims = result.claimReview.unsupportedClaims + result.claimReview.inlineCitationOnly + result.claimReview.partiallySupportedByProvidedMaterial + result.claimReview.notCheckedClaims;
    const proofreadingIssues = result.proofreading.issues.filter((issue2) => issue2.severity !== "low").length;
    return [
      {
        id: "audit-plain-language",
        title: "Plain-language load",
        body: readabilityScore !== void 0 && readabilityScore < 65 ? "Long or heavy constructions may slow comprehension; start with sentence and paragraph breaks." : "Sentence length, mechanics, and formula checks look reviewable for a first pass.",
        severity: severityForAuditScore(readabilityScore),
        score: readabilityScore,
        status: statusForAuditScore(readabilityScore),
        metadata: { kind: "quality", metrics: "readability, scannability, mechanics" }
      },
      {
        id: "audit-scannability",
        title: "Scannability",
        body: structureScore !== void 0 && structureScore < 62 ? "The draft may need clearer sectioning, shorter blocks, or task-oriented lists." : "Structure and scan cues look usable for quick editorial review.",
        severity: severityForAuditScore(structureScore),
        score: structureScore,
        status: statusForAuditScore(structureScore),
        metadata: { kind: "quality", metrics: "structure, scannability" }
      },
      {
        id: "audit-reader-value",
        title: "Reader value",
        body: readerValueScore !== void 0 && readerValueScore < 62 ? "Add concrete examples, reasoning, constraints, or a clearer next step." : "Specificity, reasoning depth, and next-step signals are present.",
        severity: severityForAuditScore(readerValueScore),
        score: readerValueScore,
        status: statusForAuditScore(readerValueScore),
        metadata: { kind: "quality", metrics: "specificity, depth, actionability" }
      },
      {
        id: "audit-evidence-readiness",
        title: "Evidence readiness",
        body: result.claimReview.factualClaims === 0 ? "No factual claims were found that need source-support review." : `${result.claimReview.factualClaims} factual claim(s); ${unresolvedClaims} need source support, cited material, or tighter wording.`,
        severity: unresolvedClaims > 0 || result.claimReview.freshnessRiskClaims > 0 ? "medium" : "low",
        score: evidenceScore,
        status: unresolvedClaims > 0 ? "review" : result.summary.sourceBand,
        metadata: {
          kind: "claim",
          factualClaims: result.claimReview.factualClaims,
          unresolvedClaims,
          freshnessRiskClaims: result.claimReview.freshnessRiskClaims
        }
      },
      {
        id: "audit-provenance-risk",
        title: "Provenance review",
        body: `Review clustered provenance-risk markers as context signals only; they are not authorship determinations. Confidence: ${percent(result.summary.provenanceConfidence)}.`,
        severity: result.summary.provenanceBand === "high" ? "high" : result.summary.provenanceBand === "elevated" ? "medium" : "low",
        status: compactLabel$1(result.summary.provenanceBand),
        metadata: { kind: "provenance", confidence: percent(result.summary.provenanceConfidence) }
      },
      {
        id: "audit-proofreading",
        title: "Proofreading readiness",
        body: result.proofreading.status === "available" ? `${result.proofreading.issues.length} local issue(s), including ${proofreadingIssues} medium/high issue(s).` : result.proofreading.caveats[0] ?? "Proofreading did not run for this analysis.",
        severity: proofreadingIssues > 0 ? "medium" : "low",
        status: result.proofreading.status,
        metadata: { kind: "proofreading", issueCount: result.proofreading.issues.length }
      }
    ];
  }
  function rawDiagnosticItems(rawMetrics) {
    if (!rawMetrics) {
      return [];
    }
    const items = [];
    for (const [key, value] of Object.entries(rawMetrics)) {
      if (typeof value === "number") {
        items.push({
          id: `metric-${key}`,
          title: key,
          body: String(value),
          score: Number(value.toFixed(3))
        });
      } else if (key === "ngramRepetition" && value && typeof value === "object") {
        for (const [length, count] of Object.entries(value)) {
          const numeric = typeof count === "number" ? count : Number(count);
          items.push({
            id: `metric-ngram-repetition-${length}`,
            title: `ngramRepetition.${length}`,
            body: String(numeric),
            score: Number(numeric.toFixed(3))
          });
        }
      }
    }
    return items;
  }
  function buildAnalysisSections(result) {
    var _a;
    const qualityDimensions = result.dimensions.filter(isQualityDimension);
    const provenanceDimensions = result.dimensions.filter(isProvenanceDimension);
    const claimItems = result.claims.slice(0, 16).map((claim) => ({
      id: claim.id,
      title: compactLabel$1(claim.status),
      body: [
        claim.claim,
        claim.recommendedAction ? `Action: ${claim.recommendedAction}` : "",
        claim.supportGaps.length > 0 ? `Gaps: ${claim.supportGaps.slice(0, 2).join(" | ")}` : ""
      ].filter(Boolean).join(" "),
      severity: claim.importance,
      status: compactLabel$1(claim.status),
      metadata: {
        type: claim.type,
        coverage: claim.supportCoverage,
        freshnessRisk: claim.freshnessRisk,
        supportNeed: claim.supportNeed,
        action: claim.recommendedAction,
        gaps: claim.supportGaps.slice(0, 2).join(" | ")
      }
    }));
    const proofreadItems = result.proofreading.issues.slice(0, 16).map((issue2) => ({
      id: issue2.id,
      title: issue2.kind,
      body: issue2.message,
      severity: issue2.severity,
      status: issue2.source,
      metadata: {
        suggestions: issue2.suggestions.join(", "),
        confidence: percent(issue2.confidence)
      }
    }));
    const passageItems = result.spans.slice(0, 14).map((span, index) => ({
      id: span.id ?? `span-${index + 1}`,
      title: compactLabel$1(span.label),
      body: span.explanation,
      severity: span.severity,
      metadata: {
        start: span.start,
        end: span.end,
        suggestion: span.suggestion
      }
    }));
    return [
      {
        id: "top-actions",
        title: "Top Actions",
        kind: "top_actions",
        summary: "Highest-value edits and review steps.",
        items: topActions(result)
      },
      {
        id: "score-overview",
        title: "Score Overview",
        kind: "score_overview",
        summary: result.summary.headline,
        items: [
          {
            id: "provenance-band",
            title: "Provenance-risk",
            body: compactLabel$1(result.summary.provenanceBand),
            score: Math.round(result.summary.provenanceConfidence * 100),
            status: result.summary.provenanceBand
          },
          {
            id: "quality-band",
            title: "Writing quality",
            body: result.summary.qualityBand,
            status: result.summary.qualityBand
          },
          {
            id: "source-band",
            title: "Source support",
            body: compactLabel$1(result.summary.sourceBand),
            status: result.summary.sourceBand
          }
        ]
      },
      {
        id: "content-audit",
        title: "Content Audit",
        kind: "content_audit",
        summary: "Author-facing audit signals grouped by the edit they support.",
        items: contentAuditItems(result)
      },
      {
        id: "context-confidence",
        title: "Context And Confidence",
        kind: "context_confidence",
        summary: `${result.context.wordCount} words, ${result.context.sentenceCount} sentences, ${result.context.paragraphCount} paragraphs.`,
        items: [
          {
            id: "language",
            title: "Language",
            body: result.context.detectedLanguage,
            score: Math.round(result.context.languageConfidence * 100)
          },
          {
            id: "genre",
            title: "Genre",
            body: result.context.detectedGenre,
            score: Math.round(result.context.genreConfidence * 100)
          },
          {
            id: "goal",
            title: "Review focus",
            body: readableGoal(result.inputSummary.goal),
            severity: "low"
          },
          {
            id: "sources",
            title: "Provided sources",
            body: `${result.inputSummary.sourceCount} source${result.inputSummary.sourceCount === 1 ? "" : "s"}`,
            severity: result.inputSummary.sourceCount > 0 ? "low" : "medium"
          },
          ...((_a = result.context.extraction) == null ? void 0 : _a.confidence) !== void 0 ? [
            {
              id: "extraction-confidence",
              title: "Extraction confidence",
              body: percent(result.context.extraction.confidence),
              severity: result.context.extraction.confidence < 0.5 ? "medium" : "low"
            }
          ] : [],
          ...result.context.assumptions.slice(0, 6).map((assumption, index) => ({
            id: `assumption-${index + 1}`,
            title: "Assumption",
            body: assumption,
            severity: "low"
          }))
        ]
      },
      {
        id: "writing-quality",
        title: "Writing Quality",
        kind: "writing_quality",
        items: topDimensionItems(qualityDimensions, true, 10)
      },
      {
        id: "provenance-risk",
        title: "Provenance-Risk Signals",
        kind: "provenance_risk",
        summary: "Signals that deserve editorial review; these are not authorship determinations.",
        items: topDimensionItems(provenanceDimensions)
      },
      {
        id: "proofreading",
        title: "Proofreading",
        kind: "proofreading",
        summary: result.proofreading.status === "available" ? `${result.proofreading.issues.length} local proofreading issue(s).` : result.proofreading.caveats[0],
        items: proofreadItems
      },
      {
        id: "claim-review",
        title: "Claim And Source Review",
        kind: "claim_review",
        summary: `${result.claimReview.supportedByProvidedMaterial} supported, ${result.claimReview.partiallySupportedByProvidedMaterial} partially supported, ${result.claimReview.inlineCitationOnly} inline-citation only, ${result.claimReview.unsupportedClaims} unsupported, ${result.claimReview.notCheckedClaims} not checked.`,
        items: claimItems
      },
      {
        id: "highlighted-passages",
        title: "Highlighted Passages",
        kind: "highlighted_passages",
        items: passageItems
      },
      {
        id: "caveats",
        title: "Caveats",
        kind: "caveats",
        items: [...result.summary.caveats, ...result.claimReview.caveats, ...result.proofreading.caveats].filter((entry, index, entries) => entries.indexOf(entry) === index).map((caveat, index) => ({
          id: `caveat-${index + 1}`,
          title: "Caveat",
          body: caveat,
          severity: "low"
        }))
      },
      {
        id: "raw-diagnostics",
        title: "Raw Diagnostics",
        kind: "raw_diagnostics",
        summary: result.rawMetrics ? "Raw metrics were included for research or diagnostics." : "Raw metrics were not requested.",
        items: rawDiagnosticItems(result.rawMetrics)
      }
    ];
  }
  function buildReportView(result, profile = result.reportProfile) {
    const sections = result.analysisSections.length > 0 ? result.analysisSections : buildAnalysisSections(result);
    const filtered = profile === "checklist" ? sections.filter((section) => ["top_actions", "content_audit", "claim_review", "proofreading", "caveats"].includes(section.kind)) : profile === "machine" ? sections.filter((section) => section.kind === "raw_diagnostics") : sections;
    return {
      profile,
      title: "Content Analysis Report",
      generatedAt: result.generatedAt,
      headline: result.summary.headline,
      sections: filtered
    };
  }
  const claimStopwords = /* @__PURE__ */ new Set([
    "about",
    "across",
    "after",
    "against",
    "being",
    "between",
    "could",
    "every",
    "helps",
    "including",
    "product",
    "should",
    "source",
    "their",
    "there",
    "these",
    "those",
    "through",
    "using",
    "would"
  ]);
  const sentenceStartNonEntities = /* @__PURE__ */ new Set([
    "A",
    "An",
    "And",
    "As",
    "But",
    "For",
    "If",
    "In",
    "It",
    "Its",
    "On",
    "Or",
    "So",
    "That",
    "The",
    "These",
    "This",
    "Those",
    "To",
    "When",
    "Where",
    "While"
  ]);
  function sourceLabel(source, index) {
    if (typeof source === "string") {
      return looksLikeReferenceLocator(source) ? source : `source-${index + 1}`;
    }
    return source.title ?? source.url ?? source.citation ?? source.id ?? `source-${index + 1}`;
  }
  function looksLikeReferenceLocator(value) {
    const trimmed = value.trim();
    if (!trimmed) {
      return true;
    }
    if (/^https?:\/\/\S+$/iu.test(trimmed)) {
      return true;
    }
    if (/^(?:doi:\s*)?10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/iu.test(trimmed)) {
      return true;
    }
    if (/^\[(?:\d+|[A-Z][A-Za-z0-9_-]{1,20})\]$/u.test(trimmed)) {
      return true;
    }
    return false;
  }
  function sourceText(source) {
    if (typeof source === "string") {
      return looksLikeReferenceLocator(source) ? "" : source;
    }
    return source.text ?? "";
  }
  function normalizeSources(metadata) {
    return ((metadata == null ? void 0 : metadata.sources) ?? []).map((source, index) => {
      const text = sourceText(source).trim();
      return {
        label: sourceLabel(source, index),
        text: text.toLowerCase()
      };
    }).filter((source) => source.text.length > 0);
  }
  function classifyClaim(sentence) {
    const lower = sentence.toLowerCase();
    if (/\b(i think|i believe|in my view|opinion|arguably|perhaps)\b/u.test(lower)) {
      return "opinion";
    }
    if (/\b(will|going to|expected to|forecast|predict|likely to)\b/u.test(lower)) {
      return "prediction";
    }
    if (/\b(should|must|need to|recommend|consider|ought to)\b/u.test(lower)) {
      return "recommendation";
    }
    if (/\b(always|never|everyone|no one|best|worst)\b/u.test(lower) && !/\d/u.test(lower)) {
      return "unverifiable";
    }
    return "factual";
  }
  function isClaimCandidate(sentence) {
    const lower = sentence.toLowerCase();
    if (sentence.endsWith("?")) {
      return false;
    }
    const hasFactVerb = /\b(is|are|was|were|has|have|had|contains|describes|explains|helps|includes|preserves|provides|requires|costs|increased|decreased|launched|published|shows|supports|means)\b/u.test(lower);
    const hasNumber = /\b\d+(?:[.,]\d+)?%?\b/u.test(sentence);
    const hasDate = absoluteDates(sentence).length > 0;
    const hasRealEntity = entities(sentence).length > 0;
    if (hasNumber || hasDate) {
      return true;
    }
    if (hasFactVerb && (sentence.length >= 22 || hasRealEntity)) {
      return true;
    }
    return sentence.length >= 35 && hasRealEntity;
  }
  function keywords(value) {
    return new Set([...value.toLowerCase().matchAll(/[\p{L}\p{M}][\p{L}\p{M}'-]*/gu)].map((match) => match[0]).filter((word) => word.length >= 5 && !claimStopwords.has(word)));
  }
  function stripInlineEvidence(value) {
    return value.replace(/\bhttps?:\/\/[^\s<>)\]]+|\[(?:\d+|[A-Z][A-Za-z0-9_-]{1,20})\]|\bdoi:\s*10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/giu, " ").replace(/\s+/gu, " ").trim();
  }
  function escapeRegExp$3(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function absoluteDates(sentence) {
    return dates(sentence).filter((value) => /\b(?:19|20)\d{2}\b/u.test(value));
  }
  function sourceIncludesValue(sourceTextValue, value) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{M}\\d])${escapeRegExp$3(value.toLowerCase())}(?=$|[^\\p{L}\\p{M}\\d])`, "u");
    return pattern.test(sourceTextValue);
  }
  function commonEntity(value) {
    return /^(?:The|This|That|These|Those|A|An|It|Its|Editors?|Customers?|Users?|Teams?|Managers?|Administrators?)$/u.test(value);
  }
  function strongSourceMatch(match) {
    const completeSmallClaim = match.coverage >= 0.92 && match.overlap >= Math.min(match.neededOverlap, 2);
    return match.hasRequiredAgreement && (completeSmallClaim || match.overlap >= match.neededOverlap && match.coverage >= 0.38);
  }
  function hasNegation(value) {
    return /\b(?:does not|do not|did not|is not|are not|was not|were not|has no|have no|no longer|never|without|lacks?|cannot|can't|doesn't|don't|isn't|aren't)\b/iu.test(value);
  }
  function sourceSegments(value) {
    return value.split(new RegExp("(?<=[.!?])\\s+|\\n+", "u")).map((segment) => segment.trim()).filter(Boolean);
  }
  function hasNegationNearAnchor(sourceTextValue, anchors) {
    const normalizedAnchors = anchors.map((anchor) => anchor.toLowerCase()).filter(Boolean);
    if (normalizedAnchors.length === 0) {
      return false;
    }
    return sourceSegments(sourceTextValue).some((segment) => {
      const lowerSegment = segment.toLowerCase();
      return hasNegation(lowerSegment) && normalizedAnchors.some((anchor) => sourceIncludesValue(lowerSegment, anchor));
    });
  }
  function contradictionGapsFor(claim, sourceTextValue, anchors) {
    const claimNegated = hasNegation(claim);
    const sourceNegated = hasNegationNearAnchor(sourceTextValue, anchors);
    if (claimNegated !== sourceNegated) {
      return ["Provided material appears to negate this claim."];
    }
    return [];
  }
  function findSupportingSources(matches) {
    return matches.filter(strongSourceMatch).map((match) => match.label);
  }
  function findSourceMatches(claim, sources) {
    const comparableClaim = stripInlineEvidence(claim);
    const claimKeywords = keywords(comparableClaim);
    if (claimKeywords.size === 0) {
      return [];
    }
    const claimNumbers = numbers(comparableClaim);
    const claimDates = absoluteDates(comparableClaim);
    const requiredEntities = entities(comparableClaim).filter((entity) => !commonEntity(entity));
    const neededOverlap = Math.min(5, Math.max(Math.min(3, claimKeywords.size), Math.ceil(claimKeywords.size * 0.45)));
    const contradictionAnchors = claimNumbers.length > 0 ? claimNumbers : claimDates.length > 0 ? claimDates : [...claimKeywords].slice(0, 6);
    return sources.map((source) => {
      const overlap = [...claimKeywords].filter((word) => sourceIncludesValue(source.text, word)).length;
      const missingNumbers = claimNumbers.filter((value) => !sourceIncludesValue(source.text, value));
      const missingDates = claimDates.filter((value) => !sourceIncludesValue(source.text, value));
      const missingEntities = requiredEntities.filter((value) => !sourceIncludesValue(source.text, value));
      const contradictionGaps = contradictionGapsFor(comparableClaim, source.text, contradictionAnchors);
      return {
        label: source.label,
        coverage: overlap / claimKeywords.size,
        overlap,
        neededOverlap,
        missingNumbers,
        missingDates,
        missingEntities,
        contradictionGaps,
        hasRequiredAgreement: missingNumbers.length === 0 && missingDates.length === 0 && missingEntities.length === 0 && contradictionGaps.length === 0
      };
    }).filter((match) => match.overlap > 0).sort((left, right) => right.coverage - left.coverage || Number(right.hasRequiredAgreement) - Number(left.hasRequiredAgreement));
  }
  function inlineEvidence(sentence) {
    return [
      ...sentence.matchAll(/\bhttps?:\/\/[^\s<>)\]]+|\[(?:\d+|[A-Z][A-Za-z0-9_-]{1,20})\]|\bdoi:\s*10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/giu)
    ].map((match) => match[0]);
  }
  function inlineEvidenceNear(input, sentence) {
    const paragraph = input.paragraphs.find((entry) => sentence.end >= entry.start && sentence.end <= entry.end);
    const tailEnd = paragraph ? Math.min(paragraph.end, sentence.end + 180) : Math.min(input.normalized.length, sentence.end + 180);
    return [.../* @__PURE__ */ new Set([...inlineEvidence(sentence.text), ...inlineEvidence(input.normalized.slice(sentence.end, tailEnd))])];
  }
  function freshnessRisk(sentence) {
    return /\b(today|currently|latest|newest|now|as of|price|cost|ranking|ranked|law|regulation|model|version|CEO|president|market share|inflation|interest rate)\b|\b20\d{2}\b/iu.test(sentence);
  }
  function entities(sentence) {
    const matches = [...sentence.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/gu)].map((match) => ({
      value: match[0],
      index: match.index ?? 0
    }));
    return [
      ...new Set(matches.filter((match) => !(match.index === 0 && sentenceStartNonEntities.has(match.value)) && !commonEntity(match.value)).map((match) => match.value))
    ].slice(0, 8);
  }
  function numbers(sentence) {
    return [...new Set([...sentence.matchAll(/\b\d+(?:[.,]\d+)?%?\b/gu)].map((match) => match[0]))].slice(0, 8);
  }
  function dates(sentence) {
    return [
      ...new Set([...sentence.matchAll(/\b(?:20\d{2}|19\d{2}|today|currently|as of|latest|newest|now)\b/giu)].map((match) => match[0]))
    ].slice(0, 8);
  }
  function importanceFor(sentence, type, stale) {
    if (stale || /\b(price|cost|law|regulation|medical|financial|security|ranking|market share)\b/iu.test(sentence)) {
      return "high";
    }
    if (type === "factual" && (numbers(sentence).length > 0 || entities(sentence).length > 1)) {
      return "medium";
    }
    return "low";
  }
  function supportNeedFor(type, status, importance, stale, sourceCount2) {
    if (type !== "factual" || status === "supported") {
      return "none";
    }
    if (stale || importance === "high") {
      return "essential";
    }
    if (status === "unsupported") {
      return sourceCount2 > 0 ? "essential" : "important";
    }
    if (status === "inline_citation_only") {
      return "important";
    }
    if (status === "partially_supported") {
      return "recommended";
    }
    return importance === "medium" ? "recommended" : "none";
  }
  function supportGapsFor(sentence, status, stale, evidenceSourceCount, providedSourceCount, matches, inline) {
    const gaps = [];
    const comparableSentence = stripInlineEvidence(sentence);
    const claimNumbers = numbers(comparableSentence);
    const claimDates = dates(comparableSentence);
    const claimEntities = entities(comparableSentence);
    const bestMatch = matches[0];
    if (evidenceSourceCount === 0 && status === "not_checked") {
      gaps.push(providedSourceCount > 0 ? "Provided references did not include source text to check." : "No source material was provided.");
    }
    if (status === "unsupported") {
      gaps.push("No provided material matched the claim strongly enough.");
    }
    if (status === "partially_supported") {
      gaps.push("Provided material overlaps with the claim but does not support the full wording.");
    }
    if (bestMatch == null ? void 0 : bestMatch.missingNumbers.length) {
      gaps.push(`Provided material does not match this number: ${bestMatch.missingNumbers.slice(0, 3).join(", ")}.`);
    }
    if (bestMatch == null ? void 0 : bestMatch.missingDates.length) {
      gaps.push(`Provided material does not match this date: ${bestMatch.missingDates.slice(0, 3).join(", ")}.`);
    }
    if (bestMatch == null ? void 0 : bestMatch.missingEntities.length) {
      gaps.push(`Provided material does not mention this named entity: ${bestMatch.missingEntities.slice(0, 3).join(", ")}.`);
    }
    if (bestMatch == null ? void 0 : bestMatch.contradictionGaps.length) {
      gaps.push(...bestMatch.contradictionGaps);
    }
    if (status === "inline_citation_only") {
      gaps.push("Inline citation presence was detected, but the source material itself was not checked.");
    }
    if (inline.length > 0 && status !== "supported" && status !== "inline_citation_only") {
      gaps.push("Inline citation presence was detected, but provided material did not fully support the claim.");
    }
    if (claimNumbers.length > 0 && status !== "supported") {
      gaps.push(`Specific number needs nearby support: ${claimNumbers.slice(0, 3).join(", ")}.`);
    }
    if ((stale || claimDates.length > 0) && status !== "supported") {
      gaps.push("Time-sensitive wording needs current source support.");
    }
    if (claimEntities.length > 1 && status !== "supported") {
      gaps.push(`Named-entity relationship needs support: ${claimEntities.slice(0, 3).join(", ")}.`);
    }
    if (matches[0] && status === "partially_supported") {
      gaps.push(`Closest provided material only covers ${Math.round(matches[0].coverage * 100)}% of claim keywords.`);
    }
    return [...new Set(gaps)].slice(0, 5);
  }
  function recommendedActionFor(status, stale, supportNeed, gaps) {
    if (status === "supported" && stale) {
      return "Keep the provided support visible and recheck the claim against current material before publishing.";
    }
    if (status === "supported") {
      return "Keep the provided support visible near the claim.";
    }
    if (status === "partially_supported") {
      return "Tighten the wording to match the provided material or add the missing source detail.";
    }
    if (status === "inline_citation_only") {
      return "Provide the cited material or paste the relevant source excerpt so support can be assessed.";
    }
    if (status === "unsupported") {
      return supportNeed === "essential" ? "Add source evidence or qualify the claim before publishing." : "Add source evidence, qualify the claim, or remove it.";
    }
    if (stale || gaps.length > 0) {
      return "Check this claim against current source material before relying on it.";
    }
    return "Review whether this claim needs source material for the intended publishing context.";
  }
  function paragraphIndexFor(input, start) {
    const index = input.paragraphs.findIndex((paragraph) => start >= paragraph.start && start <= paragraph.end);
    return index >= 0 ? index : void 0;
  }
  function sectionIdFor(input, start) {
    var _a;
    return (_a = input.blocks.find((block) => start >= block.start && start <= block.end)) == null ? void 0 : _a.parentSectionId;
  }
  function paragraphFor(input, start) {
    return input.paragraphs.find((paragraph) => start >= paragraph.start && start <= paragraph.end);
  }
  function isProceduralStructuredStep(input, sentence) {
    const paragraph = paragraphFor(input, sentence.start);
    if ((paragraph == null ? void 0 : paragraph.role) !== "structured_item") {
      return false;
    }
    const plain = sentence.text.replace(/^\s*(?:[-*]|\d+[.)])\s+/u, "").trim();
    if (numbers(plain).length > 0 || absoluteDates(plain).length > 0) {
      return false;
    }
    const hasActionStart = /^(?:add|choose|click|confirm|copy|create|delete|download|edit|enter|go|open|paste|press|review|save|select|set|tap|update|upload|verify)\b/iu.test(plain);
    return hasActionStart && entities(plain).length <= 1;
  }
  function statusFor(type, matches, inline, sourceCount2) {
    if (type !== "factual") {
      return "not_checked";
    }
    const best = matches[0];
    const bestCoverage = (best == null ? void 0 : best.coverage) ?? 0;
    const bestOverlap = (best == null ? void 0 : best.overlap) ?? 0;
    if (best && bestCoverage >= 0.48 && strongSourceMatch(best)) {
      return "supported";
    }
    if (bestOverlap >= 2 && bestCoverage >= 0.25) {
      return "partially_supported";
    }
    if (inline.length > 0 && sourceCount2 === 0) {
      return "inline_citation_only";
    }
    return sourceCount2 > 0 ? "unsupported" : "not_checked";
  }
  function notesFor(status, stale) {
    if (status === "supported") {
      return "Supported by provided material. This is source support, not a factual truth verdict.";
    }
    if (status === "partially_supported") {
      return "Partially supported by provided material; review the exact wording and missing details.";
    }
    if (status === "inline_citation_only") {
      return "The sentence contains an inline citation or URL, but that citation was not checked against provided material.";
    }
    if (status === "unsupported") {
      return "No provided material appeared to support this factual claim.";
    }
    if (stale) {
      return "Claim may depend on current facts and should be checked against fresh evidence.";
    }
    return "Claim was identified but not checked against provided material.";
  }
  function buildReview(claims, evidenceSourceCount, providedSourceCount) {
    const factual = claims.filter((claim) => claim.type === "factual");
    const caveats = [];
    if (evidenceSourceCount === 0 && factual.length > 0) {
      caveats.push(providedSourceCount > 0 ? "Provided references did not include source text, so factual claims were not checked for support." : "No source material was provided, so factual claims were not checked for support.");
    }
    if (claims.some((claim) => claim.status === "inline_citation_only")) {
      caveats.push("Inline citations and URLs are citation presence signals, not proof of support.");
    }
    if (claims.some((claim) => claim.supportGaps.some((gap) => /does not match|negate/i.test(gap)))) {
      caveats.push("Provided material with conflicting numbers, dates, or negation is treated as partial support, not full support.");
    }
    return {
      totalClaims: claims.length,
      factualClaims: factual.length,
      supportedByProvidedMaterial: factual.filter((claim) => claim.status === "supported").length,
      partiallySupportedByProvidedMaterial: factual.filter((claim) => claim.status === "partially_supported").length,
      inlineCitationOnly: factual.filter((claim) => claim.status === "inline_citation_only").length,
      unsupportedClaims: factual.filter((claim) => claim.status === "unsupported").length,
      notCheckedClaims: factual.filter((claim) => claim.status === "not_checked").length,
      freshnessRiskClaims: claims.filter((claim) => claim.freshnessRisk).length,
      sourceCount: providedSourceCount,
      caveats
    };
  }
  function analyzeClaims(input, metadata) {
    var _a, _b;
    const sources = normalizeSources(metadata);
    const providedSourceCount = ((_a = metadata == null ? void 0 : metadata.sources) == null ? void 0 : _a.length) ?? 0;
    const claims = [];
    const spans = [];
    for (const [sentenceIndex, sentence] of input.sentences.entries()) {
      if (!isClaimCandidate(sentence.text)) {
        continue;
      }
      if (isProceduralStructuredStep(input, sentence)) {
        continue;
      }
      const comparableSentence = stripInlineEvidence(sentence.text);
      const type = classifyClaim(sentence.text);
      const matches = findSourceMatches(sentence.text, sources);
      const sourceSupport = findSupportingSources(matches);
      const inline = inlineEvidenceNear(input, sentence);
      const status = statusFor(type, matches, inline, sources.length);
      const stale = freshnessRisk(comparableSentence);
      const paragraphIndex = paragraphIndexFor(input, sentence.start);
      const importance = importanceFor(comparableSentence, type, stale);
      const supportNeed = supportNeedFor(type, status, importance, stale, sources.length);
      const supportGaps = supportGapsFor(sentence.text, status, stale, sources.length, providedSourceCount, matches, inline);
      claims.push({
        id: `claim-${claims.length + 1}`,
        claim: sentence.text,
        type,
        status,
        start: sentence.start,
        end: sentence.end,
        sentenceIndex,
        paragraphIndex,
        sectionId: sectionIdFor(input, sentence.start),
        entities: entities(comparableSentence),
        numbers: numbers(comparableSentence),
        dates: dates(comparableSentence),
        importance,
        supportCoverage: Number((((_b = matches[0]) == null ? void 0 : _b.coverage) ?? 0).toFixed(2)),
        evidence: sourceSupport.length > 0 ? sourceSupport : status === "partially_supported" ? matches.slice(0, 2).map((match) => match.label) : [],
        notes: notesFor(status, stale),
        freshnessRisk: stale,
        inlineCitations: inline,
        supportNeed,
        supportGaps,
        recommendedAction: recommendedActionFor(status, stale, supportNeed, supportGaps)
      });
      if (status === "unsupported" || status === "inline_citation_only" || stale) {
        spans.push({
          id: `claim-span-${claims.length}`,
          start: sentence.start,
          end: sentence.end,
          label: status === "unsupported" ? "unsupported_claim" : status === "inline_citation_only" ? "inline_citation_only" : "freshness_risk",
          severity: status === "unsupported" ? "medium" : "low",
          explanation: status === "unsupported" ? notesFor(status, stale) : status === "inline_citation_only" ? notesFor(status, stale) : "This claim may be time-sensitive.",
          suggestion: status === "unsupported" ? "Add source support or qualify the claim." : status === "inline_citation_only" ? "Provide the source material if you want the analyzer to assess support." : "Check this against current evidence before publishing."
        });
      }
      if (claims.length >= 24) {
        break;
      }
    }
    return { claims, review: buildReview(claims, sources.length, providedSourceCount), spans };
  }
  const falsePositiveContexts = {
    lexical: ["non-native writing", "corporate prose", "support templates"],
    syntax: ["school essays", "translated copy", "policy writing"],
    discourse: ["academic writing", "legal writing", "structured explainers"],
    register: ["public-sector writing", "support scripts", "brand style guides"],
    specificity: ["early drafts", "privacy-preserving summaries", "generic policy pages"],
    formatting: ["CMS templates", "documentation pages", "checklists"],
    source: ["opinion pieces", "internal knowledge", "draft notes"],
    pragmatic: ["awareness content", "reference material", "legal notices"]
  };
  const phraseMarkers = [
    { id: "en-connector-1", language: "en", phrase: "it is important to note", family: "discourse", confidence: 0.42, severity: "low" },
    { id: "en-connector-2", language: "en", phrase: "in conclusion", family: "discourse", confidence: 0.36, severity: "low" },
    { id: "en-register-1", language: "en", phrase: "plays a crucial role", family: "register", confidence: 0.38, severity: "low" },
    { id: "es-connector-1", language: "es", phrase: "es importante senalar", family: "discourse", confidence: 0.36, severity: "low" },
    { id: "es-connector-2", language: "es", phrase: "cabe destacar", family: "discourse", confidence: 0.38, severity: "low" },
    { id: "pt-connector-1", language: "pt", phrase: "e importante destacar", family: "discourse", confidence: 0.36, severity: "low" },
    { id: "fr-connector-1", language: "fr", phrase: "il est important de noter", family: "discourse", confidence: 0.36, severity: "low" },
    { id: "de-connector-1", language: "de", phrase: "es ist wichtig zu betonen", family: "discourse", confidence: 0.36, severity: "low" }
  ];
  const bloatPhrases = [
    "it is important to note",
    "in today's fast-paced world",
    "at the end of the day",
    "a wide range of",
    "plays a crucial role",
    "it goes without saying",
    "cabe destacar",
    "es importante senalar",
    "vale ressaltar",
    "il convient de souligner",
    "es ist wichtig zu betonen"
  ];
  const localTextureHints = {
    en: ["specific examples", "concrete constraints", "reader context"],
    es: ["regional examples", "country-specific vocabulary", "reader context"],
    pt: ["regional examples", "platform-native phrasing", "reader context"],
    fr: ["locale-specific conventions", "reader context", "genre-appropriate register"],
    de: ["regional examples", "reader context", "genre-appropriate formality"]
  };
  function mean(values) {
    return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
  }
  function standardDeviation(values) {
    if (values.length < 2) {
      return 0;
    }
    const average = mean(values);
    return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
  }
  function countRepeatedWords(words) {
    const counts = /* @__PURE__ */ new Map();
    for (const word of words) {
      if (word.length >= 4) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    }
    return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
  }
  function countRepeatedPhrases(words, phraseLength = 3) {
    const counts = /* @__PURE__ */ new Map();
    for (let index = 0; index <= words.length - phraseLength; index += 1) {
      const phrase = words.slice(index, index + phraseLength).join(" ");
      if (phrase.length >= 12) {
        counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
      }
    }
    return [...counts.values()].filter((count) => count > 1).length;
  }
  function countRepeatedNgrams(words, phraseLength) {
    const counts = /* @__PURE__ */ new Map();
    for (let index = 0; index <= words.length - phraseLength; index += 1) {
      const phrase = words.slice(index, index + phraseLength).join(" ");
      if (phrase.length >= phraseLength * 4) {
        counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
      }
    }
    return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
  }
  function countRepeatedOpenings(input) {
    const openings = /* @__PURE__ */ new Map();
    for (const sentence of input.sentences) {
      const opening = sentence.words.slice(0, 3).join(" ");
      if (opening.length >= 6) {
        openings.set(opening, (openings.get(opening) ?? 0) + 1);
      }
    }
    return [...openings.values()].filter((count) => count > 1).length;
  }
  function countMatches(text, pattern) {
    return [...text.matchAll(pattern)].length;
  }
  function ratio(count, denominator) {
    return denominator > 0 ? count / denominator : 0;
  }
  function countClaimLikeSentences(input) {
    return input.sentences.filter((sentence) => /\b(is|are|was|were|has|have|had|contains|requires|costs|increased|decreased|launched|published|supports|means)\b|\b\d+(?:[.,]\d+)?%?\b|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/u.test(sentence.text)).length;
  }
  function citationProximity(input) {
    if (input.citations.length + input.urls.length === 0 || input.sentences.length === 0) {
      return 0;
    }
    const evidence = [...input.citations, ...input.urls];
    const claimLike = input.sentences.filter((sentence) => /\b(is|are|was|were|has|have|had|contains|requires|costs|increased|decreased|launched|published|supports|means)\b|\b\d+(?:[.,]\d+)?%?\b/u.test(sentence.text));
    if (claimLike.length === 0) {
      return 0;
    }
    const nearEvidence = claimLike.filter((sentence) => evidence.some((entry) => Math.abs(entry.start - sentence.end) <= 180 || entry.start >= sentence.start && entry.end <= sentence.end)).length;
    return nearEvidence / claimLike.length;
  }
  function normalizedLexicalDiversity(uniqueWords, wordCount) {
    if (wordCount === 0) {
      return 0;
    }
    return uniqueWords / Math.sqrt(wordCount * 2);
  }
  function escapeRegExp$2(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function countConnectorMatches(input) {
    if (input.detectedLanguage === "unknown" || input.detectedLanguage === "unsupported") {
      return 0;
    }
    return phraseMarkers.filter((marker) => marker.language === input.detectedLanguage).reduce((total, marker) => {
      const pattern = new RegExp(escapeRegExp$2(marker.phrase), "giu");
      return total + [...input.lower.matchAll(pattern)].length;
    }, 0);
  }
  function clampScore(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
  function clampConfidence(value) {
    return Math.max(0, Math.min(1, Number(value.toFixed(2))));
  }
  function computeMetrics(input) {
    const uniqueWords = new Set(input.words);
    const sentenceLengths = input.sentences.map((sentence) => sentence.words.length);
    const paragraphLengths = input.paragraphs.map((paragraph) => paragraph.text.split(/\s+/u).filter(Boolean).length);
    const repeatedWordCount = countRepeatedWords(input.words);
    const connectorCount = countConnectorMatches(input);
    const structuralLineCount = input.headingCount + input.listItemCount + input.tableLineCount + input.quoteLineCount;
    const lineCount = Math.max(1, input.normalized.split("\n").filter((line) => line.trim()).length);
    const meanSentenceWords = mean(sentenceLengths);
    const sentenceLengthStddev = standardDeviation(sentenceLengths);
    const meanParagraphWords = mean(paragraphLengths);
    const paragraphLengthStddev = standardDeviation(paragraphLengths);
    const longSentenceCount = sentenceLengths.filter((length) => length > 25).length;
    const veryLongSentenceCount = sentenceLengths.filter((length) => length > 35).length;
    const longParagraphCount = paragraphLengths.filter((length) => length > 120).length;
    const wordCount = Math.max(1, input.words.length);
    const sentenceCount = Math.max(1, input.sentences.length);
    const lower = input.lower;
    const hedgeCount = countMatches(lower, /\b(may|might|could|likely|possibly|perhaps|generally|typically|often|sometimes|appears|seems)\b/giu);
    const weaselCount = countMatches(lower, /\b(many|some|various|numerous|clearly|obviously|significant|robust|seamless)\b/giu);
    const passiveCount = countMatches(lower, /\b(is|are|was|were|be|been|being)\s+[a-z]+(?:ed|en)\b|\b(is|are|was|were)\s+being\s+[a-z]+(?:ed|en)\b/giu);
    const nominalizationCount = countMatches(lower, /\b[\p{L}\p{M}]+(?:tion|sion|ment|ness|ity|ance|ence|ship|ism)\b/giu);
    const entityCount = countMatches(input.normalized, /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/gu);
    const dateCount = countMatches(input.normalized, /\b(?:20\d{2}|19\d{2}|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/gu);
    const numberCount = countMatches(input.normalized, /\b\d+(?:[.,]\d+)?%?\b/gu);
    const evidenceCount = input.citations.length + input.urls.length + input.quoteLineCount;
    const actionabilityCount = countMatches(lower, /\b(start|choose|review|compare|contact|download|schedule|apply|use|open|check|fix|update|replace|decide|publish|approve)\b/giu);
    return {
      lexicalDiversity: input.words.length > 0 ? uniqueWords.size / input.words.length : 0,
      normalizedLexicalDiversity: normalizedLexicalDiversity(uniqueWords.size, input.words.length),
      repeatedWordRate: input.words.length > 0 ? repeatedWordCount / input.words.length : 0,
      repeatedPhraseCount: countRepeatedPhrases(input.words),
      ngramRepetition: {
        2: countRepeatedNgrams(input.words, 2),
        3: countRepeatedNgrams(input.words, 3),
        4: countRepeatedNgrams(input.words, 4),
        5: countRepeatedNgrams(input.words, 5)
      },
      meanSentenceWords,
      maxSentenceWords: sentenceLengths.length > 0 ? Math.max(...sentenceLengths) : 0,
      longSentenceRate: ratio(longSentenceCount, sentenceCount),
      veryLongSentenceCount,
      sentenceLengthVariation: meanSentenceWords > 0 ? sentenceLengthStddev / meanSentenceWords : 0,
      maxParagraphWords: paragraphLengths.length > 0 ? Math.max(...paragraphLengths) : 0,
      longParagraphRate: ratio(longParagraphCount, Math.max(1, input.paragraphs.length)),
      paragraphLengthVariation: meanParagraphWords > 0 ? paragraphLengthStddev / meanParagraphWords : 0,
      sentenceBurstiness: sentenceLengthStddev,
      paragraphBurstiness: paragraphLengthStddev,
      repeatedOpeningCount: countRepeatedOpenings(input),
      connectorCount,
      connectorDensity: connectorCount / Math.max(1, input.sentences.length),
      hedgeDensity: ratio(hedgeCount, sentenceCount),
      weaselDensity: ratio(weaselCount, sentenceCount),
      passiveVoiceRate: ratio(passiveCount, sentenceCount),
      nominalizationDensity: ratio(nominalizationCount, wordCount / 100),
      entityDensity: ratio(entityCount, wordCount / 100),
      dateDensity: ratio(dateCount, wordCount / 100),
      numberDensity: ratio(numberCount, wordCount / 100),
      citationProximity: citationProximity(input),
      evidenceDensity: ratio(evidenceCount, Math.max(1, countClaimLikeSentences(input))),
      actionabilityDensity: ratio(actionabilityCount, sentenceCount),
      quoteDensity: ratio(input.quoteLineCount, Math.max(1, input.paragraphs.length)),
      headingCoverage: ratio(input.headingCount, Math.max(1, input.paragraphs.length / 4)),
      claimLikeSentenceCount: countClaimLikeSentences(input),
      formattingDensity: structuralLineCount / lineCount,
      citationCount: input.citations.length,
      urlCount: input.urls.length
    };
  }
  const languageStopwords = {
    en: ["the", "and", "that", "with", "for", "this", "from", "are", "not", "have", "will", "can"],
    es: ["el", "la", "los", "las", "que", "con", "para", "una", "por", "como", "este", "esta"],
    pt: ["de", "que", "para", "com", "uma", "por", "como", "este", "esta", "sao", "mais", "nao"],
    fr: ["le", "la", "les", "des", "que", "pour", "avec", "une", "dans", "est", "sont", "pas"],
    de: ["der", "die", "das", "und", "mit", "fur", "nicht", "eine", "ist", "sind", "auf", "dass"]
  };
  const wordPattern = /[\p{L}\p{M}][\p{L}\p{M}'-]*/gu;
  const urlPattern = /\bhttps?:\/\/[^\s<>)\]]+/giu;
  const citationPattern = /\[(?:\d+|[A-Z][A-Za-z0-9_-]{1,20})\]|\bdoi:\s*10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b|\([A-Z][A-Za-z-]+(?:\s+et\s+al\.)?,\s*\d{4}\)/giu;
  function stripAccents(value) {
    return value.normalize("NFD").replace(new RegExp("\\p{M}", "gu"), "");
  }
  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }
  function normalizeText(text) {
    return text.replace(/\r\n?/g, "\n").normalize("NFC");
  }
  function collectMatches(pattern, text) {
    const matches = [];
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      const start = match.index ?? 0;
      matches.push({ value, start, end: start + value.length });
    }
    return matches;
  }
  function collectWords(text) {
    return [...stripAccents(text).matchAll(wordPattern)].map((match) => match[0].toLowerCase());
  }
  function classifyParagraphRole(index, total, value) {
    if (/^(#{1,6}\s+|[-*+]|\d+\.|>|\|)/u.test(value.trim())) {
      return "structured_item";
    }
    if (value.split(/\s+/u).filter(Boolean).length < 12) {
      return "short_note";
    }
    if (index === 0) {
      return "opening";
    }
    if (index === total - 1) {
      return "closing";
    }
    return "body";
  }
  function collectParagraphs(text) {
    const base = [];
    const pattern = /\S[\s\S]*?(?=\n{2,}|$)/g;
    for (const match of text.matchAll(pattern)) {
      const value = match[0].trim();
      if (!value) {
        continue;
      }
      const rawStart = match.index ?? 0;
      const leadingWhitespace = match[0].search(/\S/);
      const start = rawStart + Math.max(0, leadingWhitespace);
      base.push({ text: value, start, end: start + value.length });
    }
    return base.map((paragraph, index) => ({
      ...paragraph,
      id: `p-${index + 1}`,
      role: classifyParagraphRole(index, base.length, paragraph.text)
    }));
  }
  function collectSentences(text) {
    const sentences = [];
    const pattern = /[^.!?\n]+(?:[.!?]+|$)/gu;
    for (const match of text.matchAll(pattern)) {
      const raw = match[0];
      const sentence = raw.trim();
      if (!sentence) {
        continue;
      }
      const rawStart = match.index ?? 0;
      const leadingWhitespace = raw.search(/\S/);
      const start = rawStart + Math.max(0, leadingWhitespace);
      const words = collectWords(sentence);
      if (words.length > 0) {
        sentences.push({ text: sentence, start, end: start + sentence.length, words });
      }
    }
    return sentences;
  }
  function countLineMatches(text, predicate) {
    return text.split("\n").filter((line) => predicate(line.trim())).length;
  }
  function blockTypeForLine(line) {
    const trimmed = line.trim();
    if (/^#{1,6}\s+\S/u.test(trimmed)) {
      return "heading";
    }
    if (/^([-*+]|\d+\.)\s+\S/u.test(trimmed)) {
      return "list";
    }
    if (trimmed.startsWith(">")) {
      return "quote";
    }
    if (trimmed.includes("|")) {
      return "table";
    }
    if (/^```/u.test(trimmed)) {
      return "code";
    }
    return "paragraph";
  }
  function countInRange(matches, start, end) {
    return matches.filter((match) => match.start >= start && match.end <= end).length;
  }
  function collectBlocks(text, citations, urls) {
    var _a, _b;
    const blocks = [];
    const sections = [];
    const headingStack = [];
    const paragraphLike = collectParagraphs(text);
    for (const paragraph of paragraphLike) {
      const lines = paragraph.text.split("\n").map((line) => line.trim()).filter(Boolean);
      const firstLine = lines[0] ?? paragraph.text;
      const type = blockTypeForLine(firstLine);
      const headingMatch = firstLine.match(/^(#{1,6})\s+(.+)$/u);
      const headingLevel = headingMatch ? headingMatch[1].length : void 0;
      const activeSection = headingStack.at(-1);
      const blockId = `b-${blocks.length + 1}`;
      let parentSectionId = activeSection == null ? void 0 : activeSection.id;
      if (headingMatch && headingLevel) {
        while (headingStack.length > 0 && headingStack.at(-1).headingLevel >= headingLevel) {
          const completed = headingStack.pop();
          completed.end = Math.max(completed.end, paragraph.start - 1);
        }
        const parentId = (_a = headingStack.at(-1)) == null ? void 0 : _a.id;
        const section = {
          id: `s-${sections.length + 1}`,
          title: headingMatch[2].trim(),
          headingLevel,
          start: paragraph.start,
          end: paragraph.end,
          parentId,
          blockIds: [blockId]
        };
        sections.push(section);
        headingStack.push(section);
        parentSectionId = section.id;
      } else if (activeSection) {
        activeSection.blockIds.push(blockId);
        activeSection.end = paragraph.end;
      }
      blocks.push({
        id: blockId,
        type,
        text: paragraph.text,
        start: paragraph.start,
        end: paragraph.end,
        headingLevel,
        parentSectionId,
        paragraphRole: paragraph.role,
        metrics: {
          wordCount: collectWords(paragraph.text).length,
          sentenceCount: collectSentences(paragraph.text).length,
          citationCount: countInRange(citations, paragraph.start, paragraph.end),
          urlCount: countInRange(urls, paragraph.start, paragraph.end)
        }
      });
    }
    if (sections.length === 0 && blocks.length > 0) {
      sections.push({
        id: "s-1",
        title: "Body",
        headingLevel: 1,
        start: blocks[0].start,
        end: blocks.at(-1).end,
        blockIds: blocks.map((block) => block.id)
      });
      for (const block of blocks) {
        block.parentSectionId = "s-1";
      }
    }
    for (const section of sections) {
      if (section.end < section.start) {
        section.end = ((_b = blocks.find((block) => block.id === section.blockIds.at(-1))) == null ? void 0 : _b.end) ?? section.start;
      }
    }
    return { blocks, sections };
  }
  function assignParagraphSections(paragraphs, blocks) {
    return paragraphs.map((paragraph) => {
      var _a;
      return {
        ...paragraph,
        parentSectionId: (_a = blocks.find((block) => block.start === paragraph.start && block.end === paragraph.end)) == null ? void 0 : _a.parentSectionId
      };
    });
  }
  function detectScript(text) {
    const checks = [
      ["latin", new RegExp("\\p{Script=Latin}", "u")],
      ["cyrillic", new RegExp("\\p{Script=Cyrillic}", "u")],
      ["arabic", new RegExp("\\p{Script=Arabic}", "u")],
      ["han", new RegExp("\\p{Script=Han}", "u")],
      ["devanagari", new RegExp("\\p{Script=Devanagari}", "u")]
    ];
    for (const [label, pattern] of checks) {
      if (pattern.test(text)) {
        return label;
      }
    }
    return "unknown";
  }
  function normalizeLanguageHint(value) {
    if (!value) {
      return null;
    }
    const normalized = value.trim().toLowerCase().slice(0, 2);
    return supportedLanguages.includes(normalized) ? normalized : null;
  }
  function normalizeGenre(value) {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim().toLowerCase();
    return analysisGenres.includes(normalized) ? normalized : null;
  }
  function detectLanguage(words, metadata) {
    const assumptions = [];
    const hint = normalizeLanguageHint(metadata == null ? void 0 : metadata.languageHint);
    if (words.length === 0) {
      return { language: hint ?? "unknown", confidence: hint ? 0.5 : 0, mixed: false, assumptions };
    }
    const scores = supportedLanguages.map((language) => {
      const stopwords = new Set(languageStopwords[language]);
      const score = words.filter((word) => stopwords.has(word)).length;
      return { language, score };
    }).sort((left, right) => right.score - left.score);
    const top = scores[0];
    const second = scores[1];
    if (!top || top.score === 0) {
      if (hint) {
        assumptions.push("Language came from the user hint because deterministic detection was weak.");
        return { language: hint, confidence: 0.45, mixed: false, assumptions };
      }
      return { language: "unknown", confidence: 0.1, mixed: false, assumptions };
    }
    const confidence = clamp(top.score / Math.max(8, Math.min(words.length, 80)));
    const mixed = Boolean(second && second.score >= Math.max(3, top.score * 0.55));
    if (hint && hint !== top.language) {
      assumptions.push("Language hint differed from detected language, so confidence was reduced.");
      return { language: top.language, confidence: Math.min(confidence, 0.55), mixed, assumptions };
    }
    return { language: top.language, confidence: Math.max(0.25, confidence), mixed, assumptions };
  }
  function detectGenre(text, metadata) {
    const assumptions = [];
    const explicit = normalizeGenre(metadata == null ? void 0 : metadata.genre);
    if (explicit) {
      return { genre: explicit, confidence: 0.75, assumptions: [] };
    }
    if (metadata == null ? void 0 : metadata.genre) {
      assumptions.push("Genre hint was not recognized, so genre was inferred from the text.");
    }
    const lower = text.toLowerCase();
    if (/abstract|methodology|references|doi:|et al\./i.test(text)) {
      return { genre: "academic", confidence: 0.55, assumptions: [...assumptions, "Genre was inferred from citation and section markers."] };
    }
    if (/terms of service|privacy policy|hereby|pursuant|shall\b/i.test(text)) {
      return { genre: "legal", confidence: 0.55, assumptions: [...assumptions, "Genre was inferred from legal-register markers."] };
    }
    if (lower.includes("buy now") || lower.includes("learn more") || lower.includes("contact us")) {
      return { genre: "marketing", confidence: 0.45, assumptions: [...assumptions, "Genre was inferred from call-to-action language."] };
    }
    return { genre: "general", confidence: 0.25, assumptions: [...assumptions, "Genre was not provided and only weakly inferred."] };
  }
  function classifyLength(wordCount) {
    if (wordCount < 60) {
      return "too_short";
    }
    if (wordCount < 140) {
      return "short";
    }
    return "sufficient";
  }
  function prepareText(text, metadata) {
    const normalized = normalizeText(text);
    const searchable = stripAccents(normalized);
    const words = collectWords(searchable);
    const sentences = collectSentences(normalized);
    const baseCitations = collectMatches(citationPattern, normalized);
    const baseUrls = collectMatches(urlPattern, normalized);
    const blocksAndSections = collectBlocks(normalized, baseCitations, baseUrls);
    const paragraphs = assignParagraphSections(collectParagraphs(normalized), blocksAndSections.blocks);
    const language = detectLanguage(words, metadata);
    const genre = detectGenre(normalized, metadata);
    return {
      original: text,
      normalized,
      lower: searchable.toLowerCase(),
      words,
      sentences,
      paragraphs,
      blocks: blocksAndSections.blocks,
      sections: blocksAndSections.sections,
      urls: baseUrls,
      citations: baseCitations,
      headingCount: countLineMatches(normalized, (line) => /^#{1,6}\s+\S/.test(line)),
      listItemCount: countLineMatches(normalized, (line) => /^([-*+]|\d+\.)\s+\S/.test(line)),
      tableLineCount: countLineMatches(normalized, (line) => line.includes("|")),
      quoteLineCount: countLineMatches(normalized, (line) => line.startsWith(">")),
      script: detectScript(normalized),
      detectedLanguage: language.language,
      languageConfidence: language.confidence,
      detectedGenre: genre.genre,
      genreConfidence: genre.confidence,
      mixedLanguage: language.mixed,
      textLengthStatus: classifyLength(words.length),
      assumptions: [...language.assumptions, ...genre.assumptions]
    };
  }
  const basicEnglishManifest = {
    id: "local-english-basic",
    label: "Local English Proofreading",
    capabilities: ["spelling", "typography", "style"],
    supportedLanguages: ["en"],
    license: "GPL-3.0-or-later",
    egress: "none",
    spanSupport: true,
    confidenceSemantics: "Deterministic local heuristics. Confidence reflects pattern precision, not grammatical certainty.",
    enabledByDefault: true,
    notes: ["Runs locally and does not call external services.", "Designed as a conservative first-pass issue detector."]
  };
  const commonMisspellings = /* @__PURE__ */ new Map([
    ["accomodate", ["accommodate"]],
    ["adress", ["address"]],
    ["analysys", ["analysis"]],
    ["artical", ["article"]],
    ["begining", ["beginning"]],
    ["definately", ["definitely"]],
    ["enviroment", ["environment"]],
    ["goverment", ["government"]],
    ["occured", ["occurred"]],
    ["recieve", ["receive"]],
    ["seperate", ["separate"]],
    ["succesful", ["successful"]],
    ["untill", ["until"]],
    ["wich", ["which"]]
  ]);
  function issue(input, index, source = basicEnglishManifest.id) {
    return {
      ...input,
      id: `proofread-${index + 1}`,
      source
    };
  }
  function selectedLanguage(input, metadata) {
    var _a;
    const hint = (_a = metadata == null ? void 0 : metadata.languageHint) == null ? void 0 : _a.trim().toLowerCase().slice(0, 2);
    if (hint === "en") {
      return "en";
    }
    return input.detectedLanguage === "en" ? "en" : null;
  }
  function proofreadText(input, metadata) {
    const providers = [basicEnglishManifest];
    const language = selectedLanguage(input, metadata);
    if (!language) {
      return {
        status: "abstained",
        language: input.detectedLanguage,
        providers,
        issues: [],
        caveats: ["Proofreading currently runs only for English content."]
      };
    }
    const issues = [];
    const lower = input.normalized.toLowerCase();
    for (const [word, suggestions] of commonMisspellings.entries()) {
      const pattern = new RegExp(`\\b${word}\\b`, "giu");
      for (const match of input.normalized.matchAll(pattern)) {
        const start = match.index ?? 0;
        issues.push(issue({
          start,
          end: start + match[0].length,
          kind: "spelling",
          severity: "medium",
          message: `Possible misspelling: "${match[0]}".`,
          suggestions,
          confidence: 0.82
        }, issues.length));
      }
    }
    for (const match of input.normalized.matchAll(/\b([\p{L}\p{M}]{3,})\s+\1\b/giu)) {
      const start = match.index ?? 0;
      issues.push(issue({
        start,
        end: start + match[0].length,
        kind: "typography",
        severity: "low",
        message: "Repeated adjacent word.",
        suggestions: [match[1]],
        confidence: 0.9
      }, issues.length));
    }
    for (const match of input.normalized.matchAll(/[ \t]{2,}/gu)) {
      const start = match.index ?? 0;
      issues.push(issue({
        start,
        end: start + match[0].length,
        kind: "typography",
        severity: "low",
        message: "Multiple consecutive spaces.",
        suggestions: ["Use a single space."],
        confidence: 0.92
      }, issues.length));
    }
    for (const phrase of ["in order to", "due to the fact that", "at this point in time"]) {
      const pattern = new RegExp(`\\b${phrase}\\b`, "giu");
      for (const match of lower.matchAll(pattern)) {
        const start = match.index ?? 0;
        issues.push(issue({
          start,
          end: start + match[0].length,
          kind: "style",
          severity: "low",
          message: "This phrase can usually be shorter.",
          suggestions: phrase === "in order to" ? ["to"] : phrase === "due to the fact that" ? ["because"] : ["now"],
          confidence: 0.66
        }, issues.length));
      }
    }
    return {
      status: "available",
      language,
      providers,
      issues: issues.slice(0, 40),
      caveats: ["Full grammar checks run in the async analyzer path used by app surfaces."]
    };
  }
  const formalGenres = /* @__PURE__ */ new Set(["academic", "corporate", "documentation", "legal", "policy", "support"]);
  function makeDimension$1(input) {
    return {
      id: input.id,
      label: input.label,
      family: input.family,
      score: clampScore(input.score),
      confidence: clampConfidence(input.confidence),
      findings: input.findings,
      recommendations: input.recommendations ?? [],
      falsePositiveContexts: falsePositiveContexts[input.family],
      reasonCodes: input.reasonCodes ?? input.contributions.map((entry) => entry.reasonCode),
      metricIds: [...new Set(input.contributions.map((entry) => entry.metricId))],
      scoreContributions: input.contributions,
      abstentionReason: input.abstentionReason
    };
  }
  function contribution$1(input) {
    return {
      metricId: input.metricId,
      label: input.label,
      value: Number(input.value.toFixed(4)),
      weight: input.weight,
      impact: Number((input.value * input.weight).toFixed(2)),
      direction: input.direction ?? "positive",
      reasonCode: input.reasonCode
    };
  }
  function profileFor(mode, genre) {
    const profile = {
      riskMultiplier: mode === "integrity" ? 1.12 : mode === "research" ? 1.05 : 1,
      structuralTolerance: 1,
      specificityTolerance: 1
    };
    if (formalGenres.has(genre)) {
      profile.structuralTolerance = 0.78;
      profile.specificityTolerance = genre === "legal" || genre === "policy" ? 0.72 : 0.86;
    }
    if (genre === "marketing") {
      profile.specificityTolerance = 1.12;
    }
    return profile;
  }
  function escapeRegExp$1(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function hasAny(text, patterns) {
    return patterns.some((pattern) => pattern.test(text));
  }
  function findPhraseSpans(input) {
    if (input.detectedLanguage === "unknown" || input.detectedLanguage === "unsupported") {
      return [];
    }
    const spans = [];
    for (const marker of phraseMarkers.filter((entry) => entry.language === input.detectedLanguage)) {
      const pattern = new RegExp(escapeRegExp$1(marker.phrase), "giu");
      for (const match of input.lower.matchAll(pattern)) {
        const start = match.index ?? 0;
        spans.push({
          start,
          end: start + match[0].length,
          label: "formulaic_phrase",
          severity: marker.severity,
          explanation: "Formulaic phrasing can contribute to an over-standardized explanatory register.",
          suggestion: "Keep it when the genre requires formal structure; otherwise replace it with a more direct transition."
        });
      }
    }
    return spans;
  }
  function inferFormalContext(input, metadata) {
    const genre = ((metadata == null ? void 0 : metadata.genre) ?? input.detectedGenre).toLowerCase();
    const channel = ((metadata == null ? void 0 : metadata.channel) ?? "").toLowerCase();
    return formalGenres.has(genre) || formalGenres.has(channel);
  }
  function determineBand(input, dimensions, formalContext) {
    const caveats = [];
    if (input.textLengthStatus === "too_short") {
      return {
        band: "insufficient_evidence",
        confidence: 0.15,
        caveats: ["Provenance-risk scoring abstained because the text is too short."]
      };
    }
    if (input.textLengthStatus === "short") {
      caveats.push("Provenance-risk confidence is limited because the text is short.");
    }
    if (input.detectedLanguage === "unknown") {
      caveats.push("Language could not be detected with enough confidence.");
    }
    if (input.detectedLanguage === "unsupported") {
      caveats.push("Language is outside the first supported scoring set.");
    }
    const scored = dimensions.filter((entry) => entry.score >= 45);
    const strong = dimensions.filter((entry) => entry.score >= 60);
    const strongFamilies = new Set(strong.map((entry) => entry.family));
    const evidenceAverage = scored.length > 0 ? scored.reduce((total, entry) => total + entry.score, 0) / scored.length : 0;
    let band = "low";
    if (strongFamilies.size >= 4 && evidenceAverage >= 58) {
      band = "high";
    } else if (strongFamilies.size >= 2 || evidenceAverage >= 42) {
      band = "elevated";
    }
    if (formalContext && band === "high") {
      band = "elevated";
      caveats.push("High-confidence escalation was downgraded because the context is naturally formal.");
    }
    if (input.textLengthStatus === "short" && band === "high") {
      band = "elevated";
    }
    if ((input.detectedLanguage === "unknown" || input.detectedLanguage === "unsupported") && band === "high") {
      band = "elevated";
    }
    const confidence = clampConfidence(0.2 + Math.min(0.55, strongFamilies.size * 0.14) + (input.textLengthStatus === "sufficient" ? 0.15 : 0) - (formalContext ? 0.12 : 0));
    return { band, confidence, caveats };
  }
  function analyzeProvenanceSignals(input, metrics, metadata, mode = "editorial") {
    const formalContext = inferFormalContext(input, metadata);
    const selectedGenre = ((metadata == null ? void 0 : metadata.genre) ?? input.detectedGenre).toLowerCase();
    const profile = profileFor(mode, selectedGenre);
    const lower = input.lower;
    const dimensions = [];
    const lexicalContributions = [
      contribution$1({
        metricId: "repeated_word_rate",
        label: "Repeated word rate",
        value: metrics.repeatedWordRate,
        weight: 420 * profile.riskMultiplier,
        reasonCode: "lexical_repetition"
      }),
      contribution$1({
        metricId: "repeated_phrase_count",
        label: "Repeated 3-word phrases",
        value: metrics.repeatedPhraseCount,
        weight: 8 * profile.riskMultiplier,
        reasonCode: "phrase_repetition"
      }),
      contribution$1({
        metricId: "normalized_lexical_diversity",
        label: "Low length-normalized lexical diversity",
        value: metrics.normalizedLexicalDiversity < 3.2 && input.words.length > 120 ? 1 : 0,
        weight: 18 * profile.riskMultiplier,
        reasonCode: "low_lexical_variety"
      }),
      contribution$1({
        metricId: "repeated_opening_count",
        label: "Repeated sentence openings",
        value: metrics.repeatedOpeningCount,
        weight: 10 * profile.riskMultiplier,
        reasonCode: "repeated_sentence_openings"
      })
    ];
    dimensions.push(makeDimension$1({
      id: "lexical_repetition",
      label: "Lexical Repetition",
      family: "lexical",
      score: lexicalContributions.reduce((total, entry) => total + entry.impact, 0),
      confidence: 0.62,
      findings: metrics.repeatedWordRate > 0.08 || metrics.repeatedPhraseCount > 1 || metrics.repeatedOpeningCount > 1 ? ["Repeated words, phrases, or sentence openings create a standardized texture."] : [],
      recommendations: ["Replace repeated abstract wording with concrete, audience-specific details."],
      contributions: lexicalContributions
    }));
    const hasTemplateStructure = input.paragraphs.length >= 4 && (hasAny(lower, [/in conclusion|en conclusion|abschliessend/u]) || input.listItemCount >= 3);
    const discourseContributions = [
      contribution$1({
        metricId: "connector_density",
        label: "Connector density",
        value: metrics.connectorDensity,
        weight: 55 * profile.riskMultiplier * profile.structuralTolerance,
        reasonCode: "connector_density"
      }),
      contribution$1({
        metricId: "template_structure",
        label: "Template-like structure",
        value: hasTemplateStructure ? 1 : 0,
        weight: 35 * profile.riskMultiplier * profile.structuralTolerance,
        reasonCode: "template_structure"
      }),
      contribution$1({
        metricId: "sentence_length_variation",
        label: "Uniform sentence length",
        value: input.paragraphs.length >= 4 && metrics.sentenceLengthVariation < 0.35 ? 1 : 0,
        weight: 25 * profile.riskMultiplier * profile.structuralTolerance,
        reasonCode: "uniform_sentence_rhythm"
      })
    ];
    dimensions.push(makeDimension$1({
      id: "discourse_regularity",
      label: "Discourse Regularity",
      family: "discourse",
      score: discourseContributions.reduce((total, entry) => total + entry.impact, 0),
      confidence: 0.58,
      findings: hasTemplateStructure ? ["The text follows a highly regular explanatory structure with connectors, lists, or a closing summary."] : [],
      recommendations: ["Vary structure where the channel expects a more direct voice."],
      contributions: discourseContributions
    }));
    const connectorContributions = [
      contribution$1({
        metricId: "connector_density",
        label: "Formal connector markers",
        value: metrics.connectorDensity,
        weight: 90 * profile.riskMultiplier * profile.structuralTolerance,
        reasonCode: "formal_connectors"
      })
    ];
    dimensions.push(makeDimension$1({
      id: "connector_density",
      label: "Connector Density",
      family: "discourse",
      score: connectorContributions.reduce((total, entry) => total + entry.impact, 0),
      confidence: 0.45,
      findings: metrics.connectorCount > 0 ? [`Detected ${metrics.connectorCount} formal connector marker(s). Phrase markers are weak evidence by themselves.`] : [],
      recommendations: ["Keep formal connectors only where they clarify the argument."],
      contributions: connectorContributions
    }));
    const formattingContributions = [
      contribution$1({
        metricId: "formatting_density",
        label: "Structural formatting density",
        value: metrics.formattingDensity,
        weight: 120 * profile.riskMultiplier * profile.structuralTolerance,
        reasonCode: "formatting_density"
      }),
      contribution$1({
        metricId: "heading_count",
        label: "Dense heading pattern",
        value: input.headingCount >= 3 ? 1 : 0,
        weight: 20 * profile.riskMultiplier * profile.structuralTolerance,
        reasonCode: "heading_density"
      }),
      contribution$1({
        metricId: "table_line_count",
        label: "Dense table pattern",
        value: input.tableLineCount >= 2 ? 1 : 0,
        weight: 20 * profile.riskMultiplier * profile.structuralTolerance,
        reasonCode: "table_density"
      })
    ];
    dimensions.push(makeDimension$1({
      id: "formatting_density",
      label: "Formatting Density",
      family: "formatting",
      score: formattingContributions.reduce((total, entry) => total + entry.impact, 0),
      confidence: 0.48,
      findings: metrics.formattingDensity > 0.28 ? ["Headings, bullets, tables, or quotes are dense enough to resemble templated formatting in some genres."] : [],
      recommendations: ["Use structured formatting when it helps scanning; remove it where the channel expects prose."],
      contributions: formattingContributions
    }));
    const rhythmValue = input.sentences.length >= 6 && metrics.sentenceLengthVariation < 0.32 ? 62 : input.sentences.length >= 6 && metrics.sentenceLengthVariation < 0.42 ? 42 : 12;
    const rhythmContributions = [
      contribution$1({
        metricId: "sentence_length_variation",
        label: "Sentence rhythm uniformity",
        value: rhythmValue,
        weight: profile.riskMultiplier * profile.structuralTolerance,
        reasonCode: "uniform_sentence_rhythm"
      })
    ];
    dimensions.push(makeDimension$1({
      id: "sentence_rhythm",
      label: "Sentence Rhythm",
      family: "syntax",
      score: rhythmContributions.reduce((total, entry) => total + entry.impact, 0),
      confidence: 0.52,
      findings: input.sentences.length >= 6 && metrics.sentenceLengthVariation < 0.42 ? ["Sentence lengths are unusually uniform for the amount of text."] : [],
      recommendations: ["Mix concise and developed sentences where that improves flow."],
      contributions: rhythmContributions
    }));
    const hasInstitutionalRegister = hasAny(lower, [
      /it is important to note/u,
      /plays a crucial role/u,
      /es importante senalar/u,
      /il convient de souligner/u,
      /es ist wichtig zu betonen/u
    ]);
    const registerContributions = [
      contribution$1({
        metricId: "institutional_register",
        label: "Institutional register marker",
        value: formalContext ? 18 : hasInstitutionalRegister ? 58 : 20,
        weight: profile.riskMultiplier,
        reasonCode: formalContext ? "formal_context_expected" : "register_mismatch"
      })
    ];
    dimensions.push(makeDimension$1({
      id: "register_mismatch",
      label: "Register Mismatch",
      family: "register",
      score: registerContributions.reduce((total, entry) => total + entry.impact, 0),
      confidence: (metadata == null ? void 0 : metadata.genre) || (metadata == null ? void 0 : metadata.channel) ? 0.58 : 0.35,
      findings: !formalContext && hasInstitutionalRegister ? ["The register reads more institutional or explanatory than the stated context appears to require."] : [],
      recommendations: ["Tune formality to the actual reader, channel, and purpose."],
      contributions: registerContributions
    }));
    const hasConcreteTexture = /\b\d+(?:[.,]\d+)?%?\b|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/u.test(input.normalized);
    const specificityContributions = [
      contribution$1({
        metricId: "specific_texture",
        label: "Limited concrete details",
        value: input.words.length >= 180 && !hasConcreteTexture ? 58 : input.words.length >= 120 && !hasConcreteTexture ? 40 : 12,
        weight: profile.riskMultiplier * profile.specificityTolerance,
        reasonCode: "limited_concrete_texture"
      })
    ];
    dimensions.push(makeDimension$1({
      id: "specific_texture",
      label: "Specific Texture",
      family: "specificity",
      score: specificityContributions.reduce((total, entry) => total + entry.impact, 0),
      confidence: (metadata == null ? void 0 : metadata.locale) || (metadata == null ? void 0 : metadata.audience) ? 0.5 : 0.28,
      findings: input.words.length >= 120 && !hasConcreteTexture ? [
        `The text has limited concrete texture; useful human markers could include ${input.detectedLanguage !== "unknown" && input.detectedLanguage !== "unsupported" ? localTextureHints[input.detectedLanguage].join(", ") : "local examples and audience-specific details"}.`
      ] : [],
      recommendations: ["Add specific examples, constraints, places, numbers, or audience details when appropriate."],
      contributions: specificityContributions
    }));
    const band = determineBand(input, dimensions, formalContext);
    return {
      dimensions,
      spans: findPhraseSpans(input),
      band: band.band,
      confidence: band.confidence,
      caveats: band.caveats
    };
  }
  function makeDimension(input) {
    return {
      id: input.id,
      label: input.label,
      family: input.family,
      score: clampScore(input.score),
      confidence: clampConfidence(input.confidence ?? 0.7),
      findings: input.findings,
      recommendations: input.recommendations,
      falsePositiveContexts: [],
      reasonCodes: input.reasonCodes ?? input.contributions.map((entry) => entry.reasonCode),
      metricIds: [...new Set(input.contributions.map((entry) => entry.metricId))],
      scoreContributions: input.contributions
    };
  }
  function contribution(input) {
    return {
      metricId: input.metricId,
      label: input.label,
      value: Number(input.value.toFixed(4)),
      weight: input.weight,
      impact: Number((input.impact ?? input.value * input.weight).toFixed(2)),
      direction: input.direction ?? "positive",
      reasonCode: input.reasonCode
    };
  }
  function bandFromScore(score) {
    if (score >= 78) {
      return "strong";
    }
    if (score >= 62) {
      return "good";
    }
    if (score >= 42) {
      return "fair";
    }
    return "poor";
  }
  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function countPattern(text, pattern) {
    return [...text.matchAll(pattern)].length;
  }
  function hasActionLanguage(text) {
    return /\b(start|choose|review|compare|contact|download|sign up|schedule|apply|use|open|check|fix|update|replace)\b/iu.test(text);
  }
  function findBloatSpans(input) {
    const spans = [];
    for (const phrase of bloatPhrases) {
      const pattern = new RegExp(escapeRegExp(phrase), "giu");
      for (const match of input.lower.matchAll(pattern)) {
        const start = match.index ?? 0;
        spans.push({
          start,
          end: start + match[0].length,
          label: "bloated_phrase",
          severity: "low",
          explanation: "This phrase often adds formality without adding much information.",
          suggestion: "Replace it with a direct claim, specific evidence, or remove it."
        });
      }
    }
    return spans;
  }
  function analyzeQuality(input, metrics, metadata) {
    const lower = input.lower;
    const dimensions = [];
    const recommendations = [];
    const bloatCount = bloatPhrases.reduce((total, phrase) => total + countPattern(lower, new RegExp(escapeRegExp(phrase), "giu")), 0);
    const numberCount = countPattern(input.normalized, /\b\d+(?:[.,]\d+)?%?\b/gu);
    const properNameCount = countPattern(input.normalized, /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/gu);
    const causalCount = countPattern(lower, /\b(because|therefore|so that|as a result|tradeoff|however|although|since|debido a|por lo tanto|porque|portanto|car|donc|weil|deshalb)\b/giu);
    const paragraphAverage = input.words.length / Math.max(1, input.paragraphs.length);
    const profileContext = `${(metadata == null ? void 0 : metadata.genre) ?? input.detectedGenre} ${(metadata == null ? void 0 : metadata.channel) ?? ""}`.toLowerCase();
    const genreIsDense = /legal|academic|policy|documentation|support/u.test(profileContext);
    const readabilityScore = 100 - Math.max(0, metrics.meanSentenceWords - (genreIsDense ? 24 : 20)) * 2.2 - Math.max(0, paragraphAverage - (genreIsDense ? 145 : 120)) * 0.35 - Math.min(18, metrics.longSentenceRate * 36) - Math.min(16, metrics.longParagraphRate * 32) - (metrics.meanSentenceWords < 6 && input.sentences.length > 4 ? 12 : 0);
    const readabilityContributions = [
      contribution({
        metricId: "mean_sentence_words",
        label: "Sentence length fit",
        value: metrics.meanSentenceWords,
        weight: -2.2,
        impact: -Math.max(0, metrics.meanSentenceWords - (genreIsDense ? 24 : 20)) * 2.2,
        direction: "negative",
        reasonCode: "sentence_length_drag"
      }),
      contribution({
        metricId: "paragraph_average_words",
        label: "Paragraph length fit",
        value: paragraphAverage,
        weight: -0.35,
        impact: -Math.max(0, paragraphAverage - (genreIsDense ? 145 : 120)) * 0.35,
        direction: "negative",
        reasonCode: "paragraph_length_drag"
      }),
      contribution({
        metricId: "long_sentence_rate",
        label: "Long sentence rate",
        value: metrics.longSentenceRate,
        weight: -36,
        impact: -Math.min(18, metrics.longSentenceRate * 36),
        direction: "negative",
        reasonCode: "long_sentence_drag"
      }),
      contribution({
        metricId: "long_paragraph_rate",
        label: "Long paragraph rate",
        value: metrics.longParagraphRate,
        weight: -32,
        impact: -Math.min(16, metrics.longParagraphRate * 32),
        direction: "negative",
        reasonCode: "long_paragraph_drag"
      })
    ];
    dimensions.push(makeDimension({
      id: "readability",
      label: "Readability",
      family: "style",
      score: readabilityScore,
      findings: readabilityScore < 62 ? ["Sentence or paragraph length may slow scanning for the intended reader."] : [],
      recommendations: ["Shorten dense sentences and split long paragraphs where comprehension matters."],
      contributions: readabilityContributions
    }));
    const scanStructureBonus = Math.min(12, input.headingCount * 3 + (input.listItemCount > 0 && input.words.length > 120 ? 5 : 0));
    const scannabilityScore = 78 + scanStructureBonus - Math.min(34, metrics.longSentenceRate * 68) - Math.min(28, metrics.longParagraphRate * 56) - Math.min(18, Math.max(0, metrics.maxSentenceWords - (genreIsDense ? 44 : 36)) * 1.2);
    dimensions.push(makeDimension({
      id: "scannability",
      label: "Scannability",
      family: "style",
      score: scannabilityScore,
      findings: scannabilityScore < 66 ? ["Long sentences, dense paragraphs, or weak section breaks may make the draft harder to scan."] : [],
      recommendations: ["Break the longest sentences, split dense paragraphs, and use headings or lists for reader tasks."],
      contributions: [
        contribution({
          metricId: "long_sentence_rate",
          label: "Long sentence rate",
          value: metrics.longSentenceRate,
          weight: -68,
          impact: -Math.min(34, metrics.longSentenceRate * 68),
          direction: "negative",
          reasonCode: "scan_long_sentences"
        }),
        contribution({
          metricId: "long_paragraph_rate",
          label: "Long paragraph rate",
          value: metrics.longParagraphRate,
          weight: -56,
          impact: -Math.min(28, metrics.longParagraphRate * 56),
          direction: "negative",
          reasonCode: "scan_long_paragraphs"
        }),
        contribution({
          metricId: "heading_coverage",
          label: "Scan structure support",
          value: metrics.headingCoverage,
          weight: 3,
          impact: scanStructureBonus,
          direction: "positive",
          reasonCode: "scan_structure_support"
        })
      ]
    }));
    const bloatScore = 100 - bloatCount * 12 - metrics.repeatedWordRate * 160;
    const bloatContributions = [
      contribution({
        metricId: "bloat_phrase_count",
        label: "Bloated phrase count",
        value: bloatCount,
        weight: -12,
        direction: "negative",
        reasonCode: "bloated_phrasing"
      }),
      contribution({
        metricId: "repeated_word_rate",
        label: "Repeated word rate",
        value: metrics.repeatedWordRate,
        weight: -160,
        direction: "negative",
        reasonCode: "repetition_drag"
      })
    ];
    dimensions.push(makeDimension({
      id: "bloat",
      label: "Bloat",
      family: "lexical",
      score: bloatScore,
      findings: bloatScore < 72 ? ["The text contains redundant, filler, or overly generic phrasing."] : [],
      recommendations: ["Cut generic openings, repeated caveats, and phrases that do not add evidence."],
      contributions: bloatContributions
    }));
    const specificityScore = Math.min(100, 30 + numberCount * 8 + properNameCount * 4 + Math.min(18, metrics.entityDensity * 1.4));
    const specificityContributions = [
      contribution({
        metricId: "number_density",
        label: "Numbers and measurements",
        value: numberCount,
        weight: 8,
        reasonCode: "specific_numbers"
      }),
      contribution({
        metricId: "entity_density",
        label: "Named entities",
        value: properNameCount,
        weight: 4,
        reasonCode: "named_entities"
      })
    ];
    dimensions.push(makeDimension({
      id: "specificity",
      label: "Specificity",
      family: "specificity",
      score: specificityScore,
      confidence: (metadata == null ? void 0 : metadata.audience) || (metadata == null ? void 0 : metadata.locale) ? 0.65 : 0.45,
      findings: specificityScore < 55 ? ["The text has limited concrete examples, names, numbers, places, or constraints."] : [],
      recommendations: ["Add specific examples, mechanisms, numbers, or audience-relevant constraints."],
      contributions: specificityContributions
    }));
    const depthScore = Math.min(100, 35 + causalCount * 8 + Math.min(25, input.paragraphs.length * 4) + Math.min(14, metrics.evidenceDensity * 6));
    const depthContributions = [
      contribution({
        metricId: "causal_connector_count",
        label: "Causal and contrast markers",
        value: causalCount,
        weight: 8,
        reasonCode: "causal_depth"
      }),
      contribution({
        metricId: "evidence_density",
        label: "Evidence density",
        value: metrics.evidenceDensity,
        weight: 6,
        reasonCode: "evidence_depth"
      })
    ];
    dimensions.push(makeDimension({
      id: "depth",
      label: "Depth",
      family: "discourse",
      score: depthScore,
      findings: depthScore < 60 ? ["Claims are not consistently explained with causes, mechanisms, tradeoffs, or counterpoints."] : [],
      recommendations: ["For important claims, add the why, mechanism, constraint, or tradeoff."],
      contributions: depthContributions
    }));
    const structureScore = 55 + Math.min(20, input.headingCount * 4) + (input.paragraphs.length >= 3 ? 12 : -10) + (input.listItemCount > 0 && input.words.length > 120 ? 8 : 0);
    dimensions.push(makeDimension({
      id: "structure",
      label: "Structure",
      family: "discourse",
      score: structureScore,
      findings: structureScore < 60 ? ["The opening, flow, or sectioning could be easier to scan."] : [],
      recommendations: ["Make the main point early, then group supporting details by reader task."],
      contributions: [
        contribution({
          metricId: "heading_coverage",
          label: "Heading coverage",
          value: metrics.headingCoverage,
          weight: 10,
          reasonCode: "heading_coverage"
        }),
        contribution({
          metricId: "paragraph_count",
          label: "Paragraph grouping",
          value: input.paragraphs.length,
          weight: 4,
          reasonCode: "paragraph_grouping"
        })
      ]
    }));
    const formalContext = /legal|academic|policy|government|support|corporate/i.test(profileContext);
    const toneScore = formalContext || !/\b(therefore|moreover|furthermore|pursuant|hereby|crucial role)\b/iu.test(lower) ? 76 - Math.min(12, metrics.weaselDensity * 4) : 52;
    dimensions.push(makeDimension({
      id: "tone_fit",
      label: "Tone / Register Fit",
      family: "register",
      score: toneScore,
      confidence: (metadata == null ? void 0 : metadata.genre) || (metadata == null ? void 0 : metadata.channel) || (metadata == null ? void 0 : metadata.audience) ? 0.7 : 0.38,
      findings: toneScore < 65 ? ["The tone may be more formal or institutional than the current context needs."] : [],
      recommendations: ["Adjust formality to the genre, reader, channel, and desired action."],
      contributions: [
        contribution({
          metricId: "weasel_density",
          label: "Vague qualifier density",
          value: metrics.weaselDensity,
          weight: -4,
          direction: "negative",
          reasonCode: "vague_qualifiers"
        })
      ]
    }));
    const actionabilityScore = hasActionLanguage(lower) ? 78 + Math.min(16, metrics.actionabilityDensity * 5) : input.words.length > 160 ? 48 : 62;
    dimensions.push(makeDimension({
      id: "actionability",
      label: "Actionability",
      family: "pragmatic",
      score: actionabilityScore,
      findings: actionabilityScore < 62 ? ["The reader may not know what to do next after reading."] : [],
      recommendations: ["Add a clear next step, decision, or practical takeaway where appropriate."],
      contributions: [
        contribution({
          metricId: "actionability_density",
          label: "Action-oriented language",
          value: metrics.actionabilityDensity,
          weight: 5,
          reasonCode: "action_language"
        })
      ]
    }));
    const needsVisibleEvidence = metrics.claimLikeSentenceCount > 0 && (input.words.length > 120 || (metadata == null ? void 0 : metadata.genre) === "marketing" || (metadata == null ? void 0 : metadata.goal) === "source_support");
    const citationScore = metrics.citationCount + metrics.urlCount > 0 ? 68 + Math.min(24, metrics.citationProximity * 24) : needsVisibleEvidence || input.words.length > 180 ? 45 : 62;
    dimensions.push(makeDimension({
      id: "evidence_density",
      label: "Evidence Density",
      family: "source",
      score: citationScore,
      findings: citationScore < 60 ? ["Important factual claims may need visible source support."] : [],
      recommendations: ["Add citations or source links for high-impact, current, legal, price, ranking, or technical claims."],
      contributions: [
        contribution({
          metricId: "citation_proximity",
          label: "Citation proximity to claims",
          value: metrics.citationProximity,
          weight: 24,
          reasonCode: "citation_near_claims"
        }),
        contribution({
          metricId: "evidence_density",
          label: "Evidence density",
          value: metrics.evidenceDensity,
          weight: 8,
          reasonCode: "provided_evidence_density"
        })
      ]
    }));
    const mechanicsScore = 100 - Math.min(38, metrics.passiveVoiceRate * 5) - Math.min(24, metrics.nominalizationDensity * 0.6);
    dimensions.push(makeDimension({
      id: "mechanics",
      label: "Mechanics",
      family: "style",
      score: mechanicsScore,
      confidence: input.detectedLanguage === "en" ? 0.62 : 0.35,
      findings: mechanicsScore < 72 ? ["Passive constructions or nominalizations may make the text heavier than necessary."] : [],
      recommendations: ["Where clarity matters, prefer active verbs and concrete actions."],
      contributions: [
        contribution({
          metricId: "passive_voice_rate",
          label: "Passive-voice heuristic",
          value: metrics.passiveVoiceRate,
          weight: -5,
          direction: "negative",
          reasonCode: "passive_voice"
        }),
        contribution({
          metricId: "nominalization_density",
          label: "Nominalization density",
          value: metrics.nominalizationDensity,
          weight: -0.6,
          direction: "negative",
          reasonCode: "nominalized_language"
        })
      ]
    }));
    const formulaScore = Math.max(0, Math.min(100, 100 - Math.abs(metrics.meanSentenceWords - 18) * 2 - Math.max(0, paragraphAverage - 110) * 0.25));
    dimensions.push(makeDimension({
      id: "readability_formula",
      label: "Readability Formula",
      family: "style",
      score: formulaScore,
      confidence: 0.42,
      findings: formulaScore < 64 ? ["Formula-based readability checks suggest this may be slower to scan."] : [],
      recommendations: ["Use formula scores as a prompt to inspect long sentences, not as a strict grade target."],
      contributions: [
        contribution({
          metricId: "mean_sentence_words",
          label: "Mean sentence words",
          value: metrics.meanSentenceWords,
          weight: -2,
          direction: "negative",
          reasonCode: "formula_sentence_length"
        })
      ]
    }));
    for (const entry of dimensions) {
      if (entry.findings.length > 0 && entry.recommendations[0]) {
        recommendations.push(entry.recommendations[0]);
      }
    }
    const average = dimensions.reduce((total, entry) => total + entry.score, 0) / Math.max(1, dimensions.length);
    return {
      dimensions,
      spans: findBloatSpans(input),
      band: bandFromScore(average),
      recommendations: [...new Set(recommendations)].slice(0, 8)
    };
  }
  function normalizeMode(mode) {
    const selected = mode ?? "editorial";
    if (!analysisModes.includes(selected)) {
      throw new Error(`Invalid analysis mode '${selected}'. Expected one of: ${analysisModes.join(", ")}.`);
    }
    return selected;
  }
  function sourceBand(claims, sourceCount2) {
    const factualClaims = claims.filter((claim) => claim.type === "factual");
    if (factualClaims.length === 0) {
      return "not_checked";
    }
    if (sourceCount2 === 0) {
      return "not_checked";
    }
    const checked = factualClaims.filter((claim) => ["supported", "partially_supported", "unsupported"].includes(claim.status));
    if (checked.length === 0) {
      return "not_checked";
    }
    const supported = checked.filter((claim) => claim.status === "supported").length;
    const partial = checked.filter((claim) => claim.status === "partially_supported").length;
    const unsupported = checked.filter((claim) => claim.status === "unsupported").length;
    const inlineOnly = factualClaims.filter((claim) => claim.status === "inline_citation_only").length;
    if (unsupported === 0 && partial === 0 && inlineOnly === 0) {
      return "supported";
    }
    if (supported > 0 || partial > 0 || inlineOnly > 0) {
      return "mixed";
    }
    return "weakly_supported";
  }
  function summaryHeadline(args) {
    if (args.sourceBand === "weakly_supported" || args.sourceBand === "mixed") {
      return `Quality is ${args.qualityBand}; some factual claims need source review.`;
    }
    if (args.provenanceBand === "insufficient_evidence") {
      return `Quality is ${args.qualityBand}; provenance-risk markers abstained due to limited evidence.`;
    }
    if (args.provenanceBand === "high") {
      return `Quality is ${args.qualityBand}; clustered provenance-risk markers need human review.`;
    }
    if (args.provenanceBand === "elevated") {
      return `Quality is ${args.qualityBand}; some provenance-risk markers are elevated.`;
    }
    return `Quality is ${args.qualityBand}; provenance-risk markers are low or weak.`;
  }
  function topFindings(dimensions) {
    return dimensions.flatMap((dimension) => dimension.findings.map((finding) => ({ dimension, finding }))).sort((left, right) => concernScore(right.dimension) - concernScore(left.dimension)).map((entry) => entry.finding).slice(0, 5);
  }
  function concernScore(dimension) {
    return isQualityDimension(dimension) ? 100 - dimension.score : dimension.score;
  }
  function extractionAssumptions(context) {
    if (!context) {
      return [];
    }
    return (context.confidence ?? 1) < 0.5 ? ["URL extraction confidence is low; review the source page before relying on results."] : [];
  }
  function sourceCount(input) {
    var _a, _b;
    return ((_b = (_a = input.metadata) == null ? void 0 : _a.sources) == null ? void 0 : _b.length) ?? 0;
  }
  function goalFromPurpose(value) {
    const lower = (value == null ? void 0 : value.toLowerCase()) ?? "";
    if (!lower) {
      return void 0;
    }
    if (/\b(source|claim|citation|evidence|support)\b/u.test(lower)) {
      return "source_support";
    }
    if (/\b(clarity|rewrite|readability|plain|edit)\b/u.test(lower)) {
      return "clarity_rewrite";
    }
    if (/\b(risk|integrity|provenance|safety|trust)\b/u.test(lower)) {
      return "risk_review";
    }
    if (/\b(publish|ready|approval|final)\b/u.test(lower)) {
      return "publish_ready_review";
    }
    if (/\b(triage|scan|overview|checklist)\b/u.test(lower)) {
      return "editorial_triage";
    }
    return void 0;
  }
  function analysisGoal(input) {
    var _a, _b;
    const explicit = (_a = input.metadata) == null ? void 0 : _a.goal;
    if (explicit && analysisGoals.includes(explicit)) {
      return explicit;
    }
    return goalFromPurpose((_b = input.metadata) == null ? void 0 : _b.purpose);
  }
  function reportProfile(input) {
    var _a;
    return ((_a = input.options) == null ? void 0 : _a.reportProfile) ?? "full";
  }
  function inputSummary(input, result, extraction) {
    var _a, _b, _c, _d;
    return {
      inputType: (extraction == null ? void 0 : extraction.requestedUrl) ? "url" : "text",
      requestedUrl: extraction == null ? void 0 : extraction.requestedUrl,
      finalUrl: extraction == null ? void 0 : extraction.finalUrl,
      title: extraction == null ? void 0 : extraction.title,
      languageHint: (_a = input.metadata) == null ? void 0 : _a.languageHint,
      locale: (_b = input.metadata) == null ? void 0 : _b.locale,
      genre: (_c = input.metadata) == null ? void 0 : _c.genre,
      audience: (_d = input.metadata) == null ? void 0 : _d.audience,
      goal: analysisGoal(input),
      sourceCount: sourceCount(input),
      wordCount: result.context.wordCount,
      sentenceCount: result.context.sentenceCount,
      paragraphCount: result.context.paragraphCount
    };
  }
  function proofreadSpans(issues) {
    return issues.map((issue2) => ({
      id: issue2.id,
      start: issue2.start,
      end: issue2.end,
      label: `proofreading_${issue2.kind}`,
      severity: issue2.severity,
      explanation: issue2.message,
      suggestion: issue2.suggestions[0] ?? "Review this passage."
    }));
  }
  function withSections(result) {
    return buildAnalysisSections(result);
  }
  function analyzeText$1(input, extraction) {
    var _a;
    const prepared = prepareText(input.text, input.metadata);
    const proofreading = ((_a = input.options) == null ? void 0 : _a.includeProofreading) === false ? disabledProofreading(prepared.detectedLanguage) : proofreadText(prepared, input.metadata);
    return analyzePreparedText(input, extraction, proofreading, prepared);
  }
  function disabledProofreading(language) {
    return {
      status: "disabled",
      language,
      providers: [],
      issues: [],
      caveats: ["Proofreading was disabled for this analysis."]
    };
  }
  function analyzePreparedText(input, extraction, proofreading, prepared = prepareText(input.text, input.metadata)) {
    var _a, _b, _c, _d, _e, _f;
    const mode = normalizeMode(input.mode);
    const selectedReportProfile = reportProfile(input);
    const metrics = computeMetrics(prepared);
    const provenance = analyzeProvenanceSignals(prepared, metrics, input.metadata, mode);
    const quality = analyzeQuality(prepared, metrics, input.metadata);
    const claims = analyzeClaims(prepared, input.metadata);
    const dimensions = [...provenance.dimensions, ...quality.dimensions];
    const factBand = sourceBand(claims.claims, sourceCount(input));
    const caveats = [...provenance.caveats];
    if (prepared.detectedLanguage === "unknown") {
      caveats.push("Language-specific checks are lower-confidence.");
    }
    if (prepared.mixedLanguage) {
      caveats.push("Mixed-language text can reduce confidence in language-specific markers.");
    }
    const recommendations = [
      ...quality.recommendations,
      ...claims.claims.filter((claim) => claim.status === "unsupported" || claim.status === "inline_citation_only" || claim.freshnessRisk).slice(0, 4).map((claim) => `${claim.recommendedAction} Claim: ${claim.claim}`)
    ];
    const headline = summaryHeadline({
      qualityBand: quality.band,
      provenanceBand: provenance.band,
      sourceBand: factBand
    });
    const result = {
      reportProfile: selectedReportProfile,
      inputSummary: {
        inputType: (extraction == null ? void 0 : extraction.requestedUrl) ? "url" : "text",
        requestedUrl: extraction == null ? void 0 : extraction.requestedUrl,
        finalUrl: extraction == null ? void 0 : extraction.finalUrl,
        title: extraction == null ? void 0 : extraction.title,
        languageHint: (_a = input.metadata) == null ? void 0 : _a.languageHint,
        locale: (_b = input.metadata) == null ? void 0 : _b.locale,
        genre: (_c = input.metadata) == null ? void 0 : _c.genre,
        audience: (_d = input.metadata) == null ? void 0 : _d.audience,
        goal: analysisGoal(input),
        sourceCount: sourceCount(input),
        wordCount: prepared.words.length,
        sentenceCount: prepared.sentences.length,
        paragraphCount: prepared.paragraphs.length
      },
      analysisSections: [],
      scoreContributions: dimensions.flatMap((dimension) => dimension.scoreContributions),
      proofreading,
      claimReview: claims.review,
      context: {
        detectedLanguage: prepared.detectedLanguage,
        languageConfidence: prepared.languageConfidence,
        detectedGenre: prepared.detectedGenre,
        genreConfidence: prepared.genreConfidence,
        textLengthStatus: prepared.textLengthStatus,
        wordCount: prepared.words.length,
        sentenceCount: prepared.sentences.length,
        paragraphCount: prepared.paragraphs.length,
        script: prepared.script,
        mixedLanguage: prepared.mixedLanguage,
        assumptions: [...prepared.assumptions, ...extractionAssumptions(extraction)],
        extraction
      },
      summary: {
        provenanceBand: provenance.band,
        provenanceConfidence: provenance.confidence,
        qualityBand: quality.band,
        sourceBand: factBand,
        headline,
        caveats: [...new Set(caveats)],
        keyPoints: topFindings(dimensions)
      },
      dimensions,
      spans: ((_e = input.options) == null ? void 0 : _e.includeSpans) === false ? [] : [...provenance.spans, ...quality.spans, ...claims.spans, ...proofreadSpans(proofreading.issues)],
      claims: claims.claims,
      recommendations: [...new Set(recommendations)].slice(0, 10),
      rawMetrics: mode === "research" || ((_f = input.options) == null ? void 0 : _f.includeRawMetrics) || selectedReportProfile === "machine" ? metrics : void 0,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    result.inputSummary = inputSummary(input, result, extraction);
    result.analysisSections = withSections(result);
    return result;
  }
  const analyzeText = analyzeText$1;
  const DEFAULT_MAX_INPUT_LENGTH = 2e4;
  const BLOCK_NAME = "flavorpress/content-analyzer";
  const BLOCK_METADATA = {
    apiVersion: 3,
    title: "Content Analyzer",
    category: "widgets",
    icon: "analytics",
    description: "Render a public local content-analysis form.",
    supports: {
      html: false
    }
  };
  const REPORT_DISCLAIMER = "Reports are directional review signals, not guarantees, certifications, or publishing approvals.";
  const DEFAULT_CONTEXT = {
    languageHint: "auto",
    genre: "auto",
    goal: "editorial_triage",
    sources: []
  };
  function nextFrame() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }
  function settings() {
    var _a, _b, _c, _d, _e, _f, _g;
    return {
      restUrl: ((_a = window.fpcaSettings) == null ? void 0 : _a.restUrl) ?? "/wp-json/flavorpress/v1/",
      nonce: ((_b = window.fpcaSettings) == null ? void 0 : _b.nonce) ?? "",
      adminUrl: ((_c = window.fpcaSettings) == null ? void 0 : _c.adminUrl) ?? "",
      frontendEnabled: ((_d = window.fpcaSettings) == null ? void 0 : _d.frontendEnabled) ?? true,
      storeRawText: ((_e = window.fpcaSettings) == null ? void 0 : _e.storeRawText) ?? false,
      maxInputLength: ((_f = window.fpcaSettings) == null ? void 0 : _f.maxInputLength) ?? DEFAULT_MAX_INPUT_LENGTH,
      analyzerVersion: ((_g = window.fpcaSettings) == null ? void 0 : _g.analyzerVersion) ?? "0.1.0"
    };
  }
  function compactLabel(value) {
    return value.replace(/_/g, " ");
  }
  function readableLabel(value) {
    return compactLabel(value).split(" ").map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
  }
  const languageOptions = [
    { label: "Auto-detect", value: "auto" },
    ...supportedLanguages.map((language) => ({ label: language.toUpperCase(), value: language }))
  ];
  const genreOptions = [
    { label: "Auto-detect", value: "auto" },
    ...analysisGenres.map((genre) => ({ label: readableLabel(genre), value: genre }))
  ];
  const goalOptions = analysisGoals.map((goal) => ({
    label: readableLabel(goal),
    value: goal
  }));
  function sourceLines(value) {
    return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 12);
  }
  function analysisContext(overrides) {
    return {
      ...DEFAULT_CONTEXT,
      ...overrides,
      sources: overrides.sources ?? DEFAULT_CONTEXT.sources
    };
  }
  function stripEditorMarkup(value) {
    const withStructure = value.replace(/<!--[\s\S]*?-->/g, " ").replace(/<script[\s\S]*?<\/script>/giu, " ").replace(/<style[\s\S]*?<\/style>/giu, " ").replace(/<br\s*\/?>/giu, "\n").replace(/<li[^>]*>/giu, "\n- ").replace(/<h([1-6])[^>]*>/giu, (_match, level) => `
${"#".repeat(Number(level))} `).replace(/<\/(?:p|div|section|article|main|blockquote|li|ul|ol|h[1-6])>/giu, "\n");
    return withStructure.replace(/<[^>]+>/g, " ").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function textHash(value) {
    let hash = 5381;
    for (let index = 0; index < value.length; index += 1) {
      hash = hash * 33 ^ value.charCodeAt(index);
    }
    return (hash >>> 0).toString(16);
  }
  function analyzeLocalText(text, mode, context = DEFAULT_CONTEXT) {
    return analyzeText({
      text,
      mode,
      metadata: {
        ...context.languageHint !== "auto" ? { languageHint: context.languageHint } : {},
        ...context.genre !== "auto" ? { genre: context.genre } : {},
        goal: context.goal,
        ...context.sources.length > 0 ? { sources: context.sources } : {}
      },
      options: {
        includeSpans: true,
        includeProofreading: true,
        reportProfile: "checklist"
      }
    });
  }
  async function storeReport(path, payload) {
    const config = settings();
    const url = `${config.restUrl.replace(/\/$/, "")}/${path}`;
    const response = await window.fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-WP-Nonce": config.nonce
      },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof (body == null ? void 0 : body.message) === "string" ? body.message : "The report could not be stored.";
      throw new Error(message);
    }
    return body;
  }
  function reportStats(result) {
    return [
      `Quality: ${result.summary.qualityBand}`,
      `Risk: ${compactLabel(result.summary.provenanceBand)}`,
      `Sources: ${compactLabel(result.summary.sourceBand)}`,
      `${result.context.wordCount} words`
    ];
  }
  function createNode(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) {
      node.className = className;
    }
    if (text !== void 0) {
      node.textContent = text;
    }
    return node;
  }
  function renderReportNode(result, saveError = "") {
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
  function renderFrontendReport(target, result, saveError = "") {
    target.replaceChildren(renderReportNode(result, saveError));
  }
  function initFrontendBlocks() {
    for (const root of Array.from(document.querySelectorAll("[data-fpca-frontend]"))) {
      const config = settings();
      const form = root.querySelector("[data-fpca-form]");
      const text = root.querySelector("[data-fpca-text]");
      const language = root.querySelector("[data-fpca-language]");
      const genre = root.querySelector("[data-fpca-genre]");
      const goal = root.querySelector("[data-fpca-goal]");
      const sources = root.querySelector("[data-fpca-sources]");
      const status = root.querySelector("[data-fpca-status]");
      const output = root.querySelector("[data-fpca-output]");
      const submit = form == null ? void 0 : form.querySelector('button[type="submit"]');
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
            languageHint: (language == null ? void 0 : language.value) || DEFAULT_CONTEXT.languageHint,
            genre: (genre == null ? void 0 : genre.value) || DEFAULT_CONTEXT.genre,
            goal: (goal == null ? void 0 : goal.value) || DEFAULT_CONTEXT.goal,
            sources: sourceLines((sources == null ? void 0 : sources.value) ?? "")
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
            result
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
  function initBlockEditor() {
    const wp = window.wp;
    if (!(wp == null ? void 0 : wp.blocks) || !wp.element || !wp.components) {
      return;
    }
    const { createElement: h } = wp.element;
    const { PanelBody } = wp.components;
    wp.blocks.registerBlockType(BLOCK_NAME, {
      ...BLOCK_METADATA,
      edit() {
        var _a, _b;
        const blockProps = ((_b = (_a = wp.blockEditor) == null ? void 0 : _a.useBlockProps) == null ? void 0 : _b.call(_a, { className: "fpca-block fpca-block--placeholder" })) ?? {
          className: "fpca-block fpca-block--placeholder"
        };
        return h(
          "div",
          blockProps,
          h(
            PanelBody,
            { title: "Content Analyzer", initialOpen: true },
            h("p", null, "Displays a public local content-analysis form on the front end."),
            h("p", { className: "fpca-muted" }, "Reports are stored for site administrators. Visitors only see their latest result in this page session.")
          )
        );
      },
      save() {
        return null;
      }
    });
  }
  function editorReportView(result, saveError, reportUrl, stale) {
    const wp = window.wp;
    if (!(wp == null ? void 0 : wp.element)) {
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
        reportStats(result).map((entry) => h("span", { key: entry }, entry))
      ),
      ...view.sections.filter((section) => section.items.length > 0).slice(0, 3).map(
        (section) => h(
          "section",
          { className: "fpca-section", key: section.id },
          h("h3", null, section.title),
          h(
            "ul",
            null,
            section.items.slice(0, 4).map(
              (item) => h(
                "li",
                { key: item.id },
                h("strong", null, item.title),
                " ",
                item.body
              )
            )
          )
        )
      ),
      saveError ? h("p", { className: "fpca-error", key: "save-error" }, saveError) : null,
      reportUrl ? h("p", { key: "admin-link" }, h("a", { href: reportUrl }, "View stored report")) : null
    ].filter(Boolean);
  }
  function initEditorSidebar() {
    const wp = window.wp;
    if (!(wp == null ? void 0 : wp.plugins) || !wp.editPost || !wp.element || !wp.components || !wp.data) {
      return;
    }
    const { registerPlugin } = wp.plugins;
    const { PluginSidebar, PluginSidebarMoreMenuItem } = wp.editPost;
    const { createElement: h, Fragment, useRef, useState } = wp.element;
    const { Button, Notice, PanelBody, SelectControl, Spinner, TextareaControl } = wp.components;
    const { useSelect } = wp.data;
    function Sidebar() {
      const runningRef = useRef(false);
      const [mode, setMode] = useState("editorial");
      const [languageHint, setLanguageHint] = useState(DEFAULT_CONTEXT.languageHint);
      const [genre, setGenre] = useState(DEFAULT_CONTEXT.genre);
      const [goal, setGoal] = useState(DEFAULT_CONTEXT.goal);
      const [sources, setSources] = useState("");
      const [running, setRunning] = useState(false);
      const [report, setReport] = useState(null);
      const [error, setError] = useState("");
      const [saveError, setSaveError] = useState("");
      const [reportUrl, setReportUrl] = useState("");
      const [analyzedHash, setAnalyzedHash] = useState("");
      const postContent = useSelect((select) => {
        var _a, _b;
        return ((_b = (_a = select("core/editor")) == null ? void 0 : _a.getEditedPostContent) == null ? void 0 : _b.call(_a)) || "";
      }, []);
      const postId = useSelect((select) => {
        var _a, _b;
        return ((_b = (_a = select("core/editor")) == null ? void 0 : _a.getCurrentPostId) == null ? void 0 : _b.call(_a)) || 0;
      }, []);
      const sourceText2 = stripEditorMarkup(postContent);
      const currentHash = textHash(sourceText2);
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
        if (sourceText2.length < 20) {
          setError("Add more post content before running analysis.");
          return;
        }
        if (sourceText2.length > config.maxInputLength) {
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
            sources: sourceLines(sources)
          });
          const nextReport = await analyzeLocalText(sourceText2, mode, context);
          generatedReport = true;
          setReport(nextReport);
          setAnalyzedHash(currentHash);
          if (!postId) {
            setSaveError("Save the draft before storing this report.");
            return;
          }
          const response = await storeReport("editor/reports", {
            inputText: sourceText2,
            mode,
            languageHint: context.languageHint,
            genre: context.genre,
            goal: context.goal,
            postId,
            analyzerVersion: config.analyzerVersion,
            result: nextReport
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
                  { label: "Research", value: "research" }
                ],
                onChange: setMode
              }),
              h(SelectControl, {
                label: "Language",
                value: languageHint,
                options: languageOptions,
                onChange: setLanguageHint
              }),
              h(SelectControl, {
                label: "Genre",
                value: genre,
                options: genreOptions,
                onChange: setGenre
              }),
              h(SelectControl, {
                label: "Review focus",
                value: goal,
                options: goalOptions,
                onChange: setGoal
              }),
              h(TextareaControl, {
                label: "Reference sources",
                value: sources,
                onChange: setSources,
                rows: 4,
                help: "One source URL, citation, or source excerpt per line. Only pasted source text is checked for claim support."
              }),
              h(Button, { variant: "primary", onClick: run, disabled: running }, running ? "Analyzing..." : "Analyze current draft"),
              running ? h(Spinner, null) : null,
              error ? h(Notice, { status: "error", isDismissible: false }, error) : null
            ),
            report ? h("div", { className: "fpca-report" }, ...editorReportView(report, saveError, reportUrl, stale)) : null
          )
        )
      );
    }
    registerPlugin("fpca-content-analyzer", {
      icon: "analytics",
      render: Sidebar
    });
  }
  initBlockEditor();
  initEditorSidebar();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFrontendBlocks, { once: true });
  } else {
    initFrontendBlocks();
  }
})();
