import type { Course, Section } from '@/simulation/types';

/** Inclusive-start, exclusive-end containment. */
export const inSection = (meters: number, s: Section): boolean => meters >= s.start && meters < s.end;

export const sectionLength = (s: Section): number => Math.max(0, s.end - s.start);

export const totalLength = (list: Section[]): number => list.reduce((a, s) => a + sectionLength(s), 0);

/** Race phase (0 opening, 1 middle, 2 final, 3 last spurt) at a position. */
export function phaseAt(course: Course, meters: number): number {
  for (const p of course.phases) if (inSection(meters, p)) return p.phase;
  return course.phases[course.phases.length - 1]?.phase ?? 3;
}

export function phaseSection(course: Course, phase: number): Section {
  const found = course.phases.find((p) => p.phase === phase);
  return found ?? { start: 0, end: course.distance };
}

/** 1-based corner index at a position, or 0 when not on a corner. */
export function cornerNumberAt(course: Course, meters: number): number {
  for (let i = 0; i < course.corners.length; i += 1) {
    if (inSection(meters, course.corners[i])) return i + 1;
  }
  return 0;
}

export const isOnCorner = (course: Course, meters: number): boolean => cornerNumberAt(course, meters) > 0;

export const isOnStraight = (course: Course, meters: number): boolean =>
  course.straights.some((s) => inSection(meters, s));

export const uphillAt = (course: Course, meters: number) =>
  course.uphills.find((s) => inSection(meters, s)) ?? null;

export const downhillAt = (course: Course, meters: number) =>
  course.downhills.find((s) => inSection(meters, s)) ?? null;

export const isOnFinalCorner = (course: Course, meters: number): boolean =>
  course.finalCorner ? inSection(meters, course.finalCorner) : false;

/** `is_finalcorner` in game means "final corner or anything after it". */
export const isFinalCornerOrLater = (course: Course, meters: number): boolean =>
  course.finalCorner ? meters >= course.finalCorner.start : meters >= course.finalStraightStart;

export const isOnFinalStraight = (course: Course, meters: number): boolean =>
  meters >= course.finalStraightStart;

/** Straight the runner is on, or null. */
export const straightAt = (course: Course, meters: number) =>
  course.straights.find((s) => inSection(meters, s)) ?? null;

/** Where the last spurt can begin at the earliest (start of phase 3). */
export function lastSpurtStart(course: Course): number {
  return phaseSection(course, 3).start;
}

export interface CourseSummary {
  distance: number;
  straightCount: number;
  straightMeters: number;
  cornerCount: number;
  cornerMeters: number;
  uphillCount: number;
  uphillMeters: number;
  downhillCount: number;
  downhillMeters: number;
  finalStraightMeters: number;
  finalCornerStart: number | null;
  phaseBoundaries: { phase: number; label: string; start: number; end: number }[];
}

const PHASE_LABELS = ['Early race', 'Mid race', 'Late race', 'Final spurt'];

export function summarizeCourse(course: Course): CourseSummary {
  return {
    distance: course.distance,
    straightCount: course.straights.length,
    straightMeters: Math.round(totalLength(course.straights)),
    cornerCount: course.corners.length,
    cornerMeters: Math.round(totalLength(course.corners)),
    uphillCount: course.uphills.length,
    uphillMeters: Math.round(totalLength(course.uphills)),
    downhillCount: course.downhills.length,
    downhillMeters: Math.round(totalLength(course.downhills)),
    finalStraightMeters: Math.round(course.distance - course.finalStraightStart),
    finalCornerStart: course.finalCorner ? course.finalCorner.start : null,
    phaseBoundaries: course.phases.map((p) => ({
      phase: p.phase,
      label: PHASE_LABELS[p.phase] ?? `Phase ${p.phase}`,
      start: p.start,
      end: p.end,
    })),
  };
}

/**
 * Merges overlapping / adjacent windows and clips them to the course.
 * Used when several conditions each narrow down where a skill may fire.
 */
export function intersectWindows(a: Section[], b: Section[]): Section[] {
  const out: Section[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return mergeWindows(out);
}

export function mergeWindows(windows: Section[]): Section[] {
  if (windows.length <= 1) return windows.slice();
  const sorted = windows.slice().sort((p, q) => p.start - q.start);
  const out: Section[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = out[out.length - 1];
    if (sorted[i].start <= last.end) last.end = Math.max(last.end, sorted[i].end);
    else out.push({ ...sorted[i] });
  }
  return out;
}
