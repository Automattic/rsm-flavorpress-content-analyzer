import type { PreparedText, RawMetrics } from "./types.js";
import { phraseMarkers } from "./registries.js";

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function countRepeatedWords(words: string[]): number {
  const counts = new Map<string, number>();
  for (const word of words) {
    if (word.length >= 4) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}

function countRepeatedPhrases(words: string[], phraseLength = 3): number {
  const counts = new Map<string, number>();
  for (let index = 0; index <= words.length - phraseLength; index += 1) {
    const phrase = words.slice(index, index + phraseLength).join(" ");
    if (phrase.length >= 12) {
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function countRepeatedNgrams(words: string[], phraseLength: 2 | 3 | 4 | 5): number {
  const counts = new Map<string, number>();
  for (let index = 0; index <= words.length - phraseLength; index += 1) {
    const phrase = words.slice(index, index + phraseLength).join(" ");
    if (phrase.length >= phraseLength * 4) {
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
}

function countRepeatedOpenings(input: PreparedText): number {
  const openings = new Map<string, number>();
  for (const sentence of input.sentences) {
    const opening = sentence.words.slice(0, 3).join(" ");
    if (opening.length >= 6) {
      openings.set(opening, (openings.get(opening) ?? 0) + 1);
    }
  }
  return [...openings.values()].filter((count) => count > 1).length;
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function ratio(count: number, denominator: number): number {
  return denominator > 0 ? count / denominator : 0;
}

function countClaimLikeSentences(input: PreparedText): number {
  return input.sentences.filter((sentence) =>
    /\b(is|are|was|were|has|have|had|contains|requires|costs|increased|decreased|launched|published|supports|means)\b|\b\d+(?:[.,]\d+)?%?\b|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/u.test(
      sentence.text,
    ),
  ).length;
}

function citationProximity(input: PreparedText): number {
  if (input.citations.length + input.urls.length === 0 || input.sentences.length === 0) {
    return 0;
  }
  const evidence = [...input.citations, ...input.urls];
  const claimLike = input.sentences.filter((sentence) =>
    /\b(is|are|was|were|has|have|had|contains|requires|costs|increased|decreased|launched|published|supports|means)\b|\b\d+(?:[.,]\d+)?%?\b/u.test(
      sentence.text,
    ),
  );
  if (claimLike.length === 0) {
    return 0;
  }
  const nearEvidence = claimLike.filter((sentence) =>
    evidence.some((entry) => Math.abs(entry.start - sentence.end) <= 180 || (entry.start >= sentence.start && entry.end <= sentence.end)),
  ).length;
  return nearEvidence / claimLike.length;
}

function normalizedLexicalDiversity(uniqueWords: number, wordCount: number): number {
  if (wordCount === 0) {
    return 0;
  }
  return uniqueWords / Math.sqrt(wordCount * 2);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countConnectorMatches(input: PreparedText): number {
  if (input.detectedLanguage === "unknown" || input.detectedLanguage === "unsupported") {
    return 0;
  }
  return phraseMarkers
    .filter((marker) => marker.language === input.detectedLanguage)
    .reduce((total, marker) => {
      const pattern = new RegExp(escapeRegExp(marker.phrase), "giu");
      return total + [...input.lower.matchAll(pattern)].length;
    }, 0);
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

export function computeMetrics(input: PreparedText): RawMetrics {
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
  const hedgeCount = countMatches(
    lower,
    /\b(may|might|could|likely|possibly|perhaps|generally|typically|often|sometimes|appears|seems)\b/giu,
  );
  const weaselCount = countMatches(lower, /\b(many|some|various|numerous|clearly|obviously|significant|robust|seamless)\b/giu);
  const passiveCount = countMatches(
    lower,
    /\b(is|are|was|were|be|been|being)\s+[a-z]+(?:ed|en)\b|\b(is|are|was|were)\s+being\s+[a-z]+(?:ed|en)\b/giu,
  );
  const nominalizationCount = countMatches(
    lower,
    /\b[\p{L}\p{M}]+(?:tion|sion|ment|ness|ity|ance|ence|ship|ism)\b/giu,
  );
  const entityCount = countMatches(input.normalized, /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/gu);
  const dateCount = countMatches(
    input.normalized,
    /\b(?:20\d{2}|19\d{2}|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/gu,
  );
  const numberCount = countMatches(input.normalized, /\b\d+(?:[.,]\d+)?%?\b/gu);
  const evidenceCount = input.citations.length + input.urls.length + input.quoteLineCount;
  const actionabilityCount = countMatches(
    lower,
    /\b(start|choose|review|compare|contact|download|schedule|apply|use|open|check|fix|update|replace|decide|publish|approve)\b/giu,
  );

  return {
    lexicalDiversity: input.words.length > 0 ? uniqueWords.size / input.words.length : 0,
    normalizedLexicalDiversity: normalizedLexicalDiversity(uniqueWords.size, input.words.length),
    repeatedWordRate: input.words.length > 0 ? repeatedWordCount / input.words.length : 0,
    repeatedPhraseCount: countRepeatedPhrases(input.words),
    ngramRepetition: {
      2: countRepeatedNgrams(input.words, 2),
      3: countRepeatedNgrams(input.words, 3),
      4: countRepeatedNgrams(input.words, 4),
      5: countRepeatedNgrams(input.words, 5),
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
    urlCount: input.urls.length,
  };
}
