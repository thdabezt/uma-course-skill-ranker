/**
 * Everything the Race Setup panel shows about a racecourse, computed from the
 * normalized course geometry and the race model's fixed rules.
 *
 * Mechanics references (uma-skill-tools, the engine vendored under src/engine):
 *   - phases at 1/6, 2/3 and 5/6 of the distance (CourseData.phaseStart)
 *   - 24 equal sections drive the per-section Wit speed variance
 *     (RaceSolver: sectionLength = distance / 24)
 *   - position keep (pacing behind the leader) runs through section 10 in the
 *     game; the solo engine models the first 5 sections
 *   - rushing (kakari) can only begin at the start of sections 3-9
 *     (RaceSolver: kakariStart = (2 + uniform(7)) * sectionLength)
 *   - the last spurt can begin at the 2/3 mark and the spurt planner assumes the
 *     spurt has to last until 60 m before the line (HpPolicy.getLastSpurtPair)
 *   - `is_finalcorner` stays true from the final corner's start to the finish
 *   - stat thresholds: +5 % Speed per 300 points of the listed stat, capped at 901
 *     (CourseHelpers.courseSpeedModifier)
 */
import type { Course, Section } from '@/simulation/types';

export const SECTION_COUNT = 24;
/** Sections during which the game keeps runners in formation (position keep). */
export const POSITION_KEEP_SECTIONS = 10;
/** The engine only models pace-down for these first sections. */
export const ENGINE_POSITION_KEEP_SECTIONS = 5;
/** Rushing can begin at the start of a section in this 1-based range. */
export const RUSH_SECTION_RANGE: [number, number] = [3, 9];
/** The spurt planner reserves the last metres of the race (HpPolicy). */
export const SPURT_PLAN_TAIL_METERS = 60;
/** `is_last_straight_onetime` only fires within this many metres of the straight's start. */
export const LAST_STRAIGHT_ONETIME_METERS = 10;

export const PHASE_LABELS = ['Opening leg', 'Middle leg', 'Final leg', 'Last spurt'] as const;

export interface PhaseInfo {
  phase: 0 | 1 | 2 | 3;
  label: (typeof PHASE_LABELS)[number];
  start: number;
  end: number;
  /** 1-based, inclusive section range covered by the phase. */
  sections: [number, number];
}

export interface SectionInfo {
  /** 1-based. */
  index: number;
  start: number;
  end: number;
  phase: 0 | 1 | 2 | 3;
  positionKeep: boolean;
  rushCanStart: boolean;
}

export interface CornerInfo {
  /** Order along the course, 1-based. */
  order: number;
  /** In-game corner number 1-4 (the 4th corner leads into the home straight). */
  number: number;
  start: number;
  end: number;
  mid: number;
  isFinal: boolean;
  /** True when this corner number appears more than once (two-lap courses). */
  repeated: boolean;
}

export interface StraightInfo {
  start: number;
  end: number;
  frontType: number;
  kind: 'home' | 'back' | 'other';
  isFinal: boolean;
}

export interface SlopeInfo {
  start: number;
  end: number;
  kind: 'up' | 'down';
  gradePercent: number;
}

export type SpurtGeometry =
  /** The 2/3 mark falls inside the final corner: corner-triggered accels fire around the speed jump. */
  | 'final-corner-contains-spurt'
  /** The final corner is over before the 2/3 mark: its accel skills fire in the middle leg. */
  | 'final-corner-before-spurt'
  /** The final corner begins after the 2/3 mark: its accel skills fire late in the final leg. */
  | 'final-corner-after-spurt'
  | 'no-corners';

export interface SpurtTiming {
  earliestSpurt: number;
  planTail: number;
  geometry: SpurtGeometry;
  /** Final corner start minus the 2/3 mark (negative = corner starts before the mark). */
  finalCornerOffset: number | null;
  /** Final corner end minus the 2/3 mark. */
  finalCornerEndOffset: number | null;
  /** Final straight start minus the 2/3 mark. */
  finalStraightOffset: number;
  /** Slope under the 2/3 mark, if any. */
  slopeAtSpurt: SlopeInfo | null;
}

export interface StatThresholdInfo {
  stat: string;
  /** Speed multiplier bonus by stat band: <=300, 301-600, 601-900, >=901. */
  bands: { upTo: number | null; bonusPercent: number }[];
}

export interface TrackInfo {
  distance: number;
  baseSpeed: number;
  sectionLength: number;
  phases: PhaseInfo[];
  sections: SectionInfo[];
  positionKeepEnd: number;
  enginePositionKeepEnd: number;
  rushWindow: Section;
  corners: CornerInfo[];
  straights: StraightInfo[];
  /** Stretches that are neither a corner nor a straight: corner / straight skills never fire here. */
  noMansLand: Section[];
  slopes: SlopeInfo[];
  finalCorner: CornerInfo | null;
  finalStraight: StraightInfo | null;
  spurt: SpurtTiming;
  isBasisDistance: boolean;
  statThresholds: StatThresholdInfo[];
  laps: number;
}

export const baseSpeedFor = (distance: number): number => 20 - (distance - 2000) / 1000;

export function phaseStart(distance: number, phase: 0 | 1 | 2 | 3): number {
  return [0, distance / 6, (distance * 2) / 3, (distance * 5) / 6][phase];
}

export function phaseEnd(distance: number, phase: 0 | 1 | 2 | 3): number {
  return [distance / 6, (distance * 2) / 3, (distance * 5) / 6, distance][phase];
}

export function phaseOf(distance: number, meters: number): 0 | 1 | 2 | 3 {
  if (meters < distance / 6) return 0;
  if (meters < (distance * 2) / 3) return 1;
  if (meters < (distance * 5) / 6) return 2;
  return 3;
}

/** Uphill target-speed penalty in m/s: grade% * 200 / power (RaceSolver.updateTargetSpeed). */
export function uphillSpeedPenalty(gradePercent: number, power: number): number {
  return (gradePercent * 200) / Math.max(power, 1);
}

/** Downhill-mode target-speed bonus in m/s: 0.3 + grade% / 10 (RaceSolver, Global build). */
export function downhillSpeedBonus(gradePercent: number): number {
  return 0.3 + gradePercent / 10;
}

/** Chance per second of entering downhill mode: wit * 0.0004, capped at 1. */
export function downhillModeChancePerSecond(wit: number): number {
  return Math.min(1, Math.max(0, wit * 0.0004));
}

/**
 * Speed multiplier granted by the course's stat thresholds
 * (CourseHelpers.courseSpeedModifier): each listed stat contributes
 * 5 % * (1 + floor(min(stat, 901) / 300.01)), averaged over the listed stats.
 */
export function statThresholdMultiplier(
  thresholds: string[],
  stats: Record<string, number>,
): number {
  if (!thresholds.length) return 1;
  const total = thresholds.reduce((acc, stat) => {
    const value = Math.min(stats[stat] ?? 0, 901);
    return acc + (1 + Math.floor(value / 300.01)) * 0.05;
  }, 0);
  return 1 + total / thresholds.length;
}

const THRESHOLD_BANDS = [
  { upTo: 300, bonusPercent: 5 },
  { upTo: 600, bonusPercent: 10 },
  { upTo: 900, bonusPercent: 15 },
  { upTo: null, bonusPercent: 20 },
];

function slopeAt(slopes: SlopeInfo[], meters: number): SlopeInfo | null {
  return slopes.find((s) => meters >= s.start && meters < s.end) ?? null;
}

export function computeTrackInfo(course: Course): TrackInfo {
  const D = course.distance;
  const sectionLength = D / SECTION_COUNT;

  const phases: PhaseInfo[] = ([0, 1, 2, 3] as const).map((p) => {
    const start = phaseStart(D, p);
    const end = phaseEnd(D, p);
    return {
      phase: p,
      label: PHASE_LABELS[p],
      start,
      end,
      sections: [Math.floor(start / sectionLength) + 1, Math.ceil(end / sectionLength)],
    };
  });

  const sections: SectionInfo[] = Array.from({ length: SECTION_COUNT }, (_, i) => {
    const index = i + 1;
    const start = i * sectionLength;
    return {
      index,
      start,
      end: start + sectionLength,
      phase: phaseOf(D, start),
      positionKeep: index <= POSITION_KEEP_SECTIONS,
      rushCanStart: index >= RUSH_SECTION_RANGE[0] && index <= RUSH_SECTION_RANGE[1],
    };
  });

  const sorted = course.corners.slice().sort((a, b) => a.start - b.start);
  const numberCounts = new Map<number, number>();
  for (const c of sorted) {
    const n = c.number ?? 0;
    numberCounts.set(n, (numberCounts.get(n) ?? 0) + 1);
  }
  const corners: CornerInfo[] = sorted.map((c, i) => {
    // Fallback numbering when the data carries none: count back from the last
    // corner, which is always corner 4 (ActivationConditions `corner`).
    const number = c.number ?? 4 - ((sorted.length - 1 - i) % 4);
    return {
      order: i + 1,
      number,
      start: c.start,
      end: c.end,
      mid: (c.start + c.end) / 2,
      isFinal: i === sorted.length - 1,
      repeated: (numberCounts.get(c.number ?? number) ?? 0) > 1,
    };
  });

  const straights: StraightInfo[] = course.straights
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((s, i, arr) => ({
      start: s.start,
      end: s.end,
      frontType: s.frontType,
      kind: s.frontType === 1 ? 'home' : s.frontType === 2 ? 'back' : 'other',
      isFinal: i === arr.length - 1,
    }));

  // Gaps between the union of corners and straights.
  const covered: Section[] = [...corners, ...straights]
    .map((s) => ({ start: s.start, end: s.end }))
    .sort((a, b) => a.start - b.start);
  const noMansLand: Section[] = [];
  let cursor = 0;
  for (const s of covered) {
    if (s.start > cursor + 0.5) noMansLand.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < D - 0.5) noMansLand.push({ start: cursor, end: D });

  const slopes: SlopeInfo[] = [
    ...course.uphills.map((s) => ({ start: s.start, end: s.end, kind: 'up' as const, gradePercent: s.gradePercent })),
    ...course.downhills.map((s) => ({ start: s.start, end: s.end, kind: 'down' as const, gradePercent: s.gradePercent })),
  ].sort((a, b) => a.start - b.start);

  const finalCorner = corners.length ? corners[corners.length - 1] : null;
  const finalStraight = straights.length ? straights[straights.length - 1] : null;
  const earliestSpurt = phaseStart(D, 2);

  let geometry: SpurtGeometry = 'no-corners';
  if (finalCorner) {
    if (finalCorner.start <= earliestSpurt && earliestSpurt < finalCorner.end) geometry = 'final-corner-contains-spurt';
    else if (finalCorner.end <= earliestSpurt) geometry = 'final-corner-before-spurt';
    else geometry = 'final-corner-after-spurt';
  }

  const spurt: SpurtTiming = {
    earliestSpurt,
    planTail: D - SPURT_PLAN_TAIL_METERS,
    geometry,
    finalCornerOffset: finalCorner ? finalCorner.start - earliestSpurt : null,
    finalCornerEndOffset: finalCorner ? finalCorner.end - earliestSpurt : null,
    finalStraightOffset: (finalStraight ? finalStraight.start : course.finalStraightStart) - earliestSpurt,
    slopeAtSpurt: slopeAt(slopes, earliestSpurt),
  };

  return {
    distance: D,
    baseSpeed: baseSpeedFor(D),
    sectionLength,
    phases,
    sections,
    positionKeepEnd: POSITION_KEEP_SECTIONS * sectionLength,
    enginePositionKeepEnd: ENGINE_POSITION_KEEP_SECTIONS * sectionLength,
    rushWindow: { start: (RUSH_SECTION_RANGE[0] - 1) * sectionLength, end: RUSH_SECTION_RANGE[1] * sectionLength },
    corners,
    straights,
    noMansLand,
    slopes,
    finalCorner,
    finalStraight,
    spurt,
    isBasisDistance: D % 400 === 0,
    statThresholds: course.statThresholds.map((stat) => ({ stat, bands: THRESHOLD_BANDS })),
    laps: course.laps,
  };
}

/** Human-readable one-liner for the spurt / final-corner relation. */
export function describeSpurtGeometry(info: TrackInfo): string {
  const { spurt } = info;
  const at = `${Math.round(spurt.earliestSpurt)} m`;
  switch (spurt.geometry) {
    case 'final-corner-contains-spurt':
      return `The final leg begins at ${at}, inside the final corner (${Math.round(info.finalCorner!.start)}-${Math.round(
        info.finalCorner!.end,
      )} m). Final-corner acceleration skills fire right around the speed jump.`;
    case 'final-corner-before-spurt':
      return `The final corner ends ${Math.round(-spurt.finalCornerEndOffset!)} m before the final leg begins at ${at}. Final-corner acceleration skills fire in the middle leg, where there is nothing to accelerate into.`;
    case 'final-corner-after-spurt':
      return `The final leg begins at ${at}, ${Math.round(spurt.finalCornerOffset!)} m before the final corner starts. Final-corner acceleration skills fire late; only "final leg" skills catch the speed jump.`;
    default:
      return `Straight course: the final leg begins at ${at} and there are no corners for corner skills to use.`;
  }
}
