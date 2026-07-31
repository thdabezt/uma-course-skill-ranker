/**
 * SINGLE SOURCE OF TRUTH for race distance classification.
 *
 * Imported by both the application (TypeScript) and `scripts/build-data.mjs`
 * (Node type-stripping), so the rule can never diverge between the data pipeline
 * and the UI. Nothing else is allowed to classify a distance.
 *
 * Official in-game categories:
 *   Sprint  1000 - 1400 m
 *   Mile    1500 - 1800 m
 *   Medium  1900 - 2400 m
 *   Long    2500 m and above
 *
 * GameTora's raw `distance` enum disagrees at the boundaries (it tags 1300 m and
 * 1400 m courses as Mile), so the raw value is only used as a cross-check that the
 * course validator reports on - never as the stored classification.
 */

export type DistanceCategory = 'sprint' | 'mile' | 'medium' | 'long';

export const DISTANCE_CATEGORY_BOUNDS: { category: DistanceCategory; maxMeters: number }[] = [
  { category: 'sprint', maxMeters: 1400 },
  { category: 'mile', maxMeters: 1800 },
  { category: 'medium', maxMeters: 2400 },
  { category: 'long', maxMeters: Number.POSITIVE_INFINITY },
];

export function getDistanceCategory(distanceMeters: number): DistanceCategory {
  for (const b of DISTANCE_CATEGORY_BOUNDS) {
    if (distanceMeters <= b.maxMeters) return b.category;
  }
  return 'long';
}

export const DISTANCE_CATEGORY_LABELS: Record<DistanceCategory, string> = {
  sprint: 'Sprint',
  mile: 'Mile',
  medium: 'Medium',
  long: 'Long',
};

/** GameTora's numeric `distance` enum, used only for cross-checking. */
export const GAMETORA_DISTANCE_ENUM: Record<number, DistanceCategory> = {
  1: 'sprint',
  2: 'mile',
  3: 'medium',
  4: 'long',
};

/** GameTora skill tag ids for distance restrictions. */
export const DISTANCE_CATEGORY_BY_SKILL_TAG: Record<string, DistanceCategory> = {
  sho: 'sprint',
  mil: 'mile',
  med: 'medium',
  lng: 'long',
};
