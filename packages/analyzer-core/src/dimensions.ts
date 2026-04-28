import type { Dimension } from "./types.js";

export const qualityDimensionIds = [
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
  "readability_formula",
] as const;

export const provenanceDimensionIds = [
  "lexical_repetition",
  "discourse_regularity",
  "connector_density",
  "formatting_density",
  "sentence_rhythm",
  "register_mismatch",
  "specific_texture",
] as const;

const qualityDimensionIdSet = new Set<string>(qualityDimensionIds);
const provenanceDimensionIdSet = new Set<string>(provenanceDimensionIds);

export function isQualityDimension(dimension: Pick<Dimension, "id">): boolean {
  return qualityDimensionIdSet.has(dimension.id);
}

export function isProvenanceDimension(dimension: Pick<Dimension, "id">): boolean {
  return provenanceDimensionIdSet.has(dimension.id);
}

export function dimensionKind(dimension: Pick<Dimension, "id">): "quality" | "provenance" {
  return isProvenanceDimension(dimension) ? "provenance" : "quality";
}

export function overallQualityScore(dimensions: Dimension[]): number {
  const qualityDimensions = dimensions.filter(isQualityDimension);
  if (qualityDimensions.length === 0) {
    return 0;
  }
  const total = qualityDimensions.reduce((sum, dimension) => sum + dimension.score, 0);
  return Math.round(total / qualityDimensions.length);
}
