import type {
  AnalysisGenre,
  AnalysisMetadata,
  LanguageCode,
  ParagraphRole,
  PreparedText,
  SupportedLanguage,
  TextBlock,
  TextLengthStatus,
  TextSection,
} from "./types.js";
import { analysisGenres, supportedLanguages } from "./types.js";

const languageStopwords: Record<SupportedLanguage, string[]> = {
  en: ["the", "and", "that", "with", "for", "this", "from", "are", "not", "have", "will", "can"],
  es: ["el", "la", "los", "las", "que", "con", "para", "una", "por", "como", "este", "esta"],
  pt: ["de", "que", "para", "com", "uma", "por", "como", "este", "esta", "sao", "mais", "nao"],
  fr: ["le", "la", "les", "des", "que", "pour", "avec", "une", "dans", "est", "sont", "pas"],
  de: ["der", "die", "das", "und", "mit", "fur", "nicht", "eine", "ist", "sind", "auf", "dass"],
};

const wordPattern = /[\p{L}\p{M}][\p{L}\p{M}'-]*/gu;
const urlPattern = /\bhttps?:\/\/[^\s<>)\]]+/giu;
const citationPattern =
  /\[(?:\d+|[A-Z][A-Za-z0-9_-]{1,20})\]|\bdoi:\s*10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b|\([A-Z][A-Za-z-]+(?:\s+et\s+al\.)?,\s*\d{4}\)/giu;

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").normalize("NFC");
}

function collectMatches(pattern: RegExp, text: string): Array<{ value: string; start: number; end: number }> {
  const matches: Array<{ value: string; start: number; end: number }> = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    const start = match.index ?? 0;
    matches.push({ value, start, end: start + value.length });
  }
  return matches;
}

function collectWords(text: string): string[] {
  return [...stripAccents(text).matchAll(wordPattern)].map((match) => match[0].toLowerCase());
}

function classifyParagraphRole(index: number, total: number, value: string): ParagraphRole {
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

function collectParagraphs(text: string): Array<{ id: string; text: string; start: number; end: number; role: ParagraphRole; parentSectionId?: string }> {
  const base: Array<{ text: string; start: number; end: number }> = [];
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
    role: classifyParagraphRole(index, base.length, paragraph.text),
  }));
}

function collectSentences(text: string): Array<{ text: string; start: number; end: number; words: string[] }> {
  const sentences: Array<{ text: string; start: number; end: number; words: string[] }> = [];
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

function countLineMatches(text: string, predicate: (line: string) => boolean): number {
  return text.split("\n").filter((line) => predicate(line.trim())).length;
}

function blockTypeForLine(line: string): TextBlock["type"] {
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

function countInRange(matches: Array<{ start: number; end: number }>, start: number, end: number): number {
  return matches.filter((match) => match.start >= start && match.end <= end).length;
}

function collectBlocks(
  text: string,
  citations: Array<{ value: string; start: number; end: number }>,
  urls: Array<{ value: string; start: number; end: number }>,
): { blocks: TextBlock[]; sections: TextSection[] } {
  const blocks: TextBlock[] = [];
  const sections: TextSection[] = [];
  const headingStack: TextSection[] = [];
  const paragraphLike = collectParagraphs(text);

  for (const paragraph of paragraphLike) {
    const lines = paragraph.text.split("\n").map((line) => line.trim()).filter(Boolean);
    const firstLine = lines[0] ?? paragraph.text;
    const type = blockTypeForLine(firstLine);
    const headingMatch = firstLine.match(/^(#{1,6})\s+(.+)$/u);
    const headingLevel = headingMatch ? headingMatch[1].length : undefined;
    const activeSection = headingStack.at(-1);
    const blockId = `b-${blocks.length + 1}`;
    let parentSectionId = activeSection?.id;

    if (headingMatch && headingLevel) {
      while (headingStack.length > 0 && headingStack.at(-1)!.headingLevel >= headingLevel) {
        const completed = headingStack.pop()!;
        completed.end = Math.max(completed.end, paragraph.start - 1);
      }
      const parentId = headingStack.at(-1)?.id;
      const section: TextSection = {
        id: `s-${sections.length + 1}`,
        title: headingMatch[2].trim(),
        headingLevel,
        start: paragraph.start,
        end: paragraph.end,
        parentId,
        blockIds: [blockId],
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
        urlCount: countInRange(urls, paragraph.start, paragraph.end),
      },
    });
  }

  if (sections.length === 0 && blocks.length > 0) {
    sections.push({
      id: "s-1",
      title: "Body",
      headingLevel: 1,
      start: blocks[0].start,
      end: blocks.at(-1)!.end,
      blockIds: blocks.map((block) => block.id),
    });
    for (const block of blocks) {
      block.parentSectionId = "s-1";
    }
  }

  for (const section of sections) {
    if (section.end < section.start) {
      section.end = blocks.find((block) => block.id === section.blockIds.at(-1))?.end ?? section.start;
    }
  }

  return { blocks, sections };
}

function assignParagraphSections(
  paragraphs: PreparedText["paragraphs"],
  blocks: TextBlock[],
): PreparedText["paragraphs"] {
  return paragraphs.map((paragraph) => ({
    ...paragraph,
    parentSectionId: blocks.find((block) => block.start === paragraph.start && block.end === paragraph.end)?.parentSectionId,
  }));
}

function detectScript(text: string): string {
  const checks: Array<[string, RegExp]> = [
    ["latin", /\p{Script=Latin}/u],
    ["cyrillic", /\p{Script=Cyrillic}/u],
    ["arabic", /\p{Script=Arabic}/u],
    ["han", /\p{Script=Han}/u],
    ["devanagari", /\p{Script=Devanagari}/u],
  ];
  for (const [label, pattern] of checks) {
    if (pattern.test(text)) {
      return label;
    }
  }
  return "unknown";
}

function normalizeLanguageHint(value: string | undefined): SupportedLanguage | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase().slice(0, 2);
  return supportedLanguages.includes(normalized as SupportedLanguage)
    ? (normalized as SupportedLanguage)
    : null;
}

function normalizeGenre(value: unknown): AnalysisGenre | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return analysisGenres.includes(normalized as AnalysisGenre) ? (normalized as AnalysisGenre) : null;
}

function detectLanguage(words: string[], metadata?: AnalysisMetadata): {
  language: LanguageCode;
  confidence: number;
  mixed: boolean;
  assumptions: string[];
} {
  const assumptions: string[] = [];
  const hint = normalizeLanguageHint(metadata?.languageHint);
  if (words.length === 0) {
    return { language: hint ?? "unknown", confidence: hint ? 0.5 : 0, mixed: false, assumptions };
  }

  const scores = supportedLanguages
    .map((language) => {
      const stopwords = new Set(languageStopwords[language]);
      const score = words.filter((word) => stopwords.has(word)).length;
      return { language, score };
    })
    .sort((left, right) => right.score - left.score);
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

function detectGenre(text: string, metadata?: AnalysisMetadata): {
  genre: AnalysisGenre;
  confidence: number;
  assumptions: string[];
} {
  const assumptions: string[] = [];
  const explicit = normalizeGenre(metadata?.genre);
  if (explicit) {
    return { genre: explicit, confidence: 0.75, assumptions: [] };
  }
  if (metadata?.genre) {
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

function classifyLength(wordCount: number): TextLengthStatus {
  if (wordCount < 60) {
    return "too_short";
  }
  if (wordCount < 140) {
    return "short";
  }
  return "sufficient";
}

export function prepareText(text: string, metadata?: AnalysisMetadata): PreparedText {
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
    assumptions: [...language.assumptions, ...genre.assumptions],
  };
}
