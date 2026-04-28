import type {
  AnalysisMetadata,
  Claim,
  ClaimSupportNeed,
  ClaimReview,
  ClaimStatus,
  ClaimType,
  PreparedText,
  SourceInput,
  TextSpan,
} from "./types.js";

interface ClaimAnalysis {
  claims: Claim[];
  review: ClaimReview;
  spans: TextSpan[];
}

interface NormalizedSource {
  label: string;
  text: string;
}

interface SourceMatch {
  label: string;
  coverage: number;
  overlap: number;
  neededOverlap: number;
  missingNumbers: string[];
  missingDates: string[];
  missingEntities: string[];
  contradictionGaps: string[];
  hasRequiredAgreement: boolean;
}

const claimStopwords = new Set([
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
  "would",
]);

const sentenceStartNonEntities = new Set([
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
  "While",
]);

function sourceLabel(source: string | SourceInput, index: number): string {
  if (typeof source === "string") {
    return looksLikeReferenceLocator(source) ? source : `source-${index + 1}`;
  }
  return source.title ?? source.url ?? source.citation ?? source.id ?? `source-${index + 1}`;
}

function looksLikeReferenceLocator(value: string): boolean {
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

function sourceText(source: string | SourceInput): string {
  if (typeof source === "string") {
    return looksLikeReferenceLocator(source) ? "" : source;
  }
  return source.text ?? "";
}

function normalizeSources(metadata: AnalysisMetadata | undefined): NormalizedSource[] {
  return (metadata?.sources ?? [])
    .map((source, index) => {
      const text = sourceText(source).trim();
      return {
        label: sourceLabel(source, index),
        text: text.toLowerCase(),
      };
    })
    .filter((source) => source.text.length > 0);
}

function classifyClaim(sentence: string): ClaimType {
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

function isClaimCandidate(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  if (sentence.endsWith("?")) {
    return false;
  }
  const hasFactVerb =
    /\b(is|are|was|were|has|have|had|contains|describes|explains|helps|includes|preserves|provides|requires|costs|increased|decreased|launched|published|shows|supports|means)\b/u.test(lower);
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

function keywords(value: string): Set<string> {
  return new Set(
    [...value.toLowerCase().matchAll(/[\p{L}\p{M}][\p{L}\p{M}'-]*/gu)]
      .map((match) => match[0])
      .filter((word) => word.length >= 5 && !claimStopwords.has(word)),
  );
}

function stripInlineEvidence(value: string): string {
  return value
    .replace(/\bhttps?:\/\/[^\s<>)\]]+|\[(?:\d+|[A-Z][A-Za-z0-9_-]{1,20})\]|\bdoi:\s*10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function absoluteDates(sentence: string): string[] {
  return dates(sentence).filter((value) => /\b(?:19|20)\d{2}\b/u.test(value));
}

function sourceIncludesValue(sourceTextValue: string, value: string): boolean {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{M}\\d])${escapeRegExp(value.toLowerCase())}(?=$|[^\\p{L}\\p{M}\\d])`, "u");
  return pattern.test(sourceTextValue);
}

function commonEntity(value: string): boolean {
  return /^(?:The|This|That|These|Those|A|An|It|Its|Editors?|Customers?|Users?|Teams?|Managers?|Administrators?)$/u.test(value);
}

function strongSourceMatch(match: SourceMatch): boolean {
  const completeSmallClaim = match.coverage >= 0.92 && match.overlap >= Math.min(match.neededOverlap, 2);
  return match.hasRequiredAgreement && (completeSmallClaim || (match.overlap >= match.neededOverlap && match.coverage >= 0.38));
}

function hasNegation(value: string): boolean {
  return /\b(?:does not|do not|did not|is not|are not|was not|were not|has no|have no|no longer|never|without|lacks?|cannot|can't|doesn't|don't|isn't|aren't)\b/iu.test(
    value,
  );
}

function sourceSegments(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function hasNegationNearAnchor(sourceTextValue: string, anchors: string[]): boolean {
  const normalizedAnchors = anchors.map((anchor) => anchor.toLowerCase()).filter(Boolean);
  if (normalizedAnchors.length === 0) {
    return false;
  }
  return sourceSegments(sourceTextValue).some((segment) => {
    const lowerSegment = segment.toLowerCase();
    return hasNegation(lowerSegment) && normalizedAnchors.some((anchor) => sourceIncludesValue(lowerSegment, anchor));
  });
}

function contradictionGapsFor(claim: string, sourceTextValue: string, anchors: string[]): string[] {
  const claimNegated = hasNegation(claim);
  const sourceNegated = hasNegationNearAnchor(sourceTextValue, anchors);
  if (claimNegated !== sourceNegated) {
    return ["Provided material appears to negate this claim."];
  }
  return [];
}

function findSupportingSources(matches: SourceMatch[]): string[] {
  return matches.filter(strongSourceMatch).map((match) => match.label);
}

function findSourceMatches(claim: string, sources: NormalizedSource[]): SourceMatch[] {
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
  return sources
    .map((source) => {
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
        hasRequiredAgreement:
          missingNumbers.length === 0 && missingDates.length === 0 && missingEntities.length === 0 && contradictionGaps.length === 0,
      };
    })
    .filter((match) => match.overlap > 0)
    .sort((left, right) => right.coverage - left.coverage || Number(right.hasRequiredAgreement) - Number(left.hasRequiredAgreement));
}

function inlineEvidence(sentence: string): string[] {
  return [
    ...sentence.matchAll(/\bhttps?:\/\/[^\s<>)\]]+|\[(?:\d+|[A-Z][A-Za-z0-9_-]{1,20})\]|\bdoi:\s*10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/giu),
  ].map((match) => match[0]);
}

function inlineEvidenceNear(input: PreparedText, sentence: { text: string; end: number }): string[] {
  const paragraph = input.paragraphs.find((entry) => sentence.end >= entry.start && sentence.end <= entry.end);
  const tailEnd = paragraph ? Math.min(paragraph.end, sentence.end + 180) : Math.min(input.normalized.length, sentence.end + 180);
  return [...new Set([...inlineEvidence(sentence.text), ...inlineEvidence(input.normalized.slice(sentence.end, tailEnd))])];
}

function freshnessRisk(sentence: string): boolean {
  return /\b(today|currently|latest|newest|now|as of|price|cost|ranking|ranked|law|regulation|model|version|CEO|president|market share|inflation|interest rate)\b|\b20\d{2}\b/iu.test(sentence);
}

function entities(sentence: string): string[] {
  const matches = [...sentence.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/gu)].map((match) => ({
    value: match[0],
    index: match.index ?? 0,
  }));
  return [
    ...new Set(
      matches
        .filter((match) => !(match.index === 0 && sentenceStartNonEntities.has(match.value)) && !commonEntity(match.value))
        .map((match) => match.value),
    ),
  ].slice(0, 8);
}

function numbers(sentence: string): string[] {
  return [...new Set([...sentence.matchAll(/\b\d+(?:[.,]\d+)?%?\b/gu)].map((match) => match[0]))].slice(0, 8);
}

function dates(sentence: string): string[] {
  return [
    ...new Set(
      [...sentence.matchAll(/\b(?:20\d{2}|19\d{2}|today|currently|as of|latest|newest|now)\b/giu)].map((match) => match[0]),
    ),
  ].slice(0, 8);
}

function importanceFor(sentence: string, type: ClaimType, stale: boolean): Claim["importance"] {
  if (stale || /\b(price|cost|law|regulation|medical|financial|security|ranking|market share)\b/iu.test(sentence)) {
    return "high";
  }
  if (type === "factual" && (numbers(sentence).length > 0 || entities(sentence).length > 1)) {
    return "medium";
  }
  return "low";
}

function supportNeedFor(type: ClaimType, status: ClaimStatus, importance: Claim["importance"], stale: boolean, sourceCount: number): ClaimSupportNeed {
  if (type !== "factual" || status === "supported") {
    return "none";
  }
  if (stale || importance === "high") {
    return "essential";
  }
  if (status === "unsupported") {
    return sourceCount > 0 ? "essential" : "important";
  }
  if (status === "inline_citation_only") {
    return "important";
  }
  if (status === "partially_supported") {
    return "recommended";
  }
  return importance === "medium" ? "recommended" : "none";
}

function supportGapsFor(
  sentence: string,
  status: ClaimStatus,
  stale: boolean,
  evidenceSourceCount: number,
  providedSourceCount: number,
  matches: SourceMatch[],
  inline: string[],
): string[] {
  const gaps: string[] = [];
  const comparableSentence = stripInlineEvidence(sentence);
  const claimNumbers = numbers(comparableSentence);
  const claimDates = dates(comparableSentence);
  const claimEntities = entities(comparableSentence);
  const bestMatch = matches[0];

  if (evidenceSourceCount === 0 && status === "not_checked") {
    gaps.push(
      providedSourceCount > 0
        ? "Provided references did not include source text to check."
        : "No source material was provided.",
    );
  }
  if (status === "unsupported") {
    gaps.push("No provided material matched the claim strongly enough.");
  }
  if (status === "partially_supported") {
    gaps.push("Provided material overlaps with the claim but does not support the full wording.");
  }
  if (bestMatch?.missingNumbers.length) {
    gaps.push(`Provided material does not match this number: ${bestMatch.missingNumbers.slice(0, 3).join(", ")}.`);
  }
  if (bestMatch?.missingDates.length) {
    gaps.push(`Provided material does not match this date: ${bestMatch.missingDates.slice(0, 3).join(", ")}.`);
  }
  if (bestMatch?.missingEntities.length) {
    gaps.push(`Provided material does not mention this named entity: ${bestMatch.missingEntities.slice(0, 3).join(", ")}.`);
  }
  if (bestMatch?.contradictionGaps.length) {
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

function recommendedActionFor(status: ClaimStatus, stale: boolean, supportNeed: ClaimSupportNeed, gaps: string[]): string {
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
    return supportNeed === "essential"
      ? "Add source evidence or qualify the claim before publishing."
      : "Add source evidence, qualify the claim, or remove it.";
  }
  if (stale || gaps.length > 0) {
    return "Check this claim against current source material before relying on it.";
  }
  return "Review whether this claim needs source material for the intended publishing context.";
}

function paragraphIndexFor(input: PreparedText, start: number): number | undefined {
  const index = input.paragraphs.findIndex((paragraph) => start >= paragraph.start && start <= paragraph.end);
  return index >= 0 ? index : undefined;
}

function sectionIdFor(input: PreparedText, start: number): string | undefined {
  return input.blocks.find((block) => start >= block.start && start <= block.end)?.parentSectionId;
}

function paragraphFor(input: PreparedText, start: number): PreparedText["paragraphs"][number] | undefined {
  return input.paragraphs.find((paragraph) => start >= paragraph.start && start <= paragraph.end);
}

function isProceduralStructuredStep(input: PreparedText, sentence: { text: string; start: number }): boolean {
  const paragraph = paragraphFor(input, sentence.start);
  if (paragraph?.role !== "structured_item") {
    return false;
  }
  const plain = sentence.text.replace(/^\s*(?:[-*]|\d+[.)])\s+/u, "").trim();
  if (numbers(plain).length > 0 || absoluteDates(plain).length > 0) {
    return false;
  }
  const hasActionStart =
    /^(?:add|choose|click|confirm|copy|create|delete|download|edit|enter|go|open|paste|press|review|save|select|set|tap|update|upload|verify)\b/iu.test(
      plain,
    );
  return hasActionStart && entities(plain).length <= 1;
}

function statusFor(type: ClaimType, matches: SourceMatch[], inline: string[], sourceCount: number): ClaimStatus {
  if (type !== "factual") {
    return "not_checked";
  }
  const best = matches[0];
  const bestCoverage = best?.coverage ?? 0;
  const bestOverlap = best?.overlap ?? 0;
  if (best && bestCoverage >= 0.48 && strongSourceMatch(best)) {
    return "supported";
  }
  if (bestOverlap >= 2 && bestCoverage >= 0.25) {
    return "partially_supported";
  }
  if (inline.length > 0 && sourceCount === 0) {
    return "inline_citation_only";
  }
  return sourceCount > 0 ? "unsupported" : "not_checked";
}

function notesFor(status: ClaimStatus, stale: boolean): string {
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

function buildReview(claims: Claim[], evidenceSourceCount: number, providedSourceCount: number): ClaimReview {
  const factual = claims.filter((claim) => claim.type === "factual");
  const caveats: string[] = [];
  if (evidenceSourceCount === 0 && factual.length > 0) {
    caveats.push(
      providedSourceCount > 0
        ? "Provided references did not include source text, so factual claims were not checked for support."
        : "No source material was provided, so factual claims were not checked for support.",
    );
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
    caveats,
  };
}

export function analyzeClaims(input: PreparedText, metadata: AnalysisMetadata | undefined): ClaimAnalysis {
  const sources = normalizeSources(metadata);
  const providedSourceCount = metadata?.sources?.length ?? 0;
  const claims: Claim[] = [];
  const spans: TextSpan[] = [];

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
      supportCoverage: Number((matches[0]?.coverage ?? 0).toFixed(2)),
      evidence:
        sourceSupport.length > 0
          ? sourceSupport
          : status === "partially_supported"
            ? matches.slice(0, 2).map((match) => match.label)
            : [],
      notes: notesFor(status, stale),
      freshnessRisk: stale,
      inlineCitations: inline,
      supportNeed,
      supportGaps,
      recommendedAction: recommendedActionFor(status, stale, supportNeed, supportGaps),
    });

    if (status === "unsupported" || status === "inline_citation_only" || stale) {
      spans.push({
        id: `claim-span-${claims.length}`,
        start: sentence.start,
        end: sentence.end,
        label: status === "unsupported" ? "unsupported_claim" : status === "inline_citation_only" ? "inline_citation_only" : "freshness_risk",
        severity: status === "unsupported" ? "medium" : "low",
        explanation: status === "unsupported" ? notesFor(status, stale) : status === "inline_citation_only" ? notesFor(status, stale) : "This claim may be time-sensitive.",
        suggestion:
          status === "unsupported"
            ? "Add source support or qualify the claim."
            : status === "inline_citation_only"
              ? "Provide the source material if you want the analyzer to assess support."
              : "Check this against current evidence before publishing.",
      });
    }

    if (claims.length >= 24) {
      break;
    }
  }

  return { claims, review: buildReview(claims, sources.length, providedSourceCount), spans };
}
