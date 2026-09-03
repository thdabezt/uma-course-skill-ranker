import { describe, expect, it } from 'vitest';

import { courses } from '@/data';
import {
  computeTrackInfo,
  describeSpurtGeometry,
  downhillSpeedBonus,
  statThresholdMultiplier,
  uphillSpeedPenalty,
} from '@/courses/trackInfo';
import { EXAMPLE_COURSES } from './fixtures';

const byId = (id: number) => courses.find((c) => c.id === id)!;

describe('track info: distance-derived markers', () => {
  it('matches the phase boundaries GameTora publishes for every course', () => {
    for (const c of courses) {
      const info = computeTrackInfo(c);
      for (const p of info.phases) {
        const published = c.phases.find((x) => x.phase === p.phase)!;
        expect(Math.round(p.start)).toBe(published.start);
        expect(Math.round(p.end)).toBe(published.end);
      }
    }
  });

  it('matches the published position-keep end and earliest spurt for every course', () => {
    for (const c of courses) {
      const info = computeTrackInfo(c);
      expect(Math.round(info.positionKeepEnd)).toBe(c.positionKeepEnd);
      if (c.spurtStart) expect(Math.round(info.spurt.earliestSpurt)).toBe(c.spurtStart.meters);
    }
  });

  it('splits the course into 24 sections with the rush window on sections 3-9', () => {
    const info = computeTrackInfo(EXAMPLE_COURSES.tokyoTurf2400);
    expect(info.sections).toHaveLength(24);
    expect(info.sections[0].start).toBe(0);
    expect(info.sections[23].end).toBe(2400);
    expect(info.sections.filter((s) => s.rushCanStart).map((s) => s.index)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(info.sections.filter((s) => s.positionKeep)).toHaveLength(10);
    expect(info.rushWindow).toEqual({ start: 200, end: 900 });
  });

  it('computes the base speed from the distance', () => {
    expect(computeTrackInfo(EXAMPLE_COURSES.tokyoTurf2400).baseSpeed).toBeCloseTo(19.6);
    expect(computeTrackInfo(EXAMPLE_COURSES.chukyoTurf1200).baseSpeed).toBeCloseTo(20.8);
  });

  it('flags basis distances (multiples of 400 m)', () => {
    expect(computeTrackInfo(EXAMPLE_COURSES.tokyoTurf2400).isBasisDistance).toBe(true);
    expect(computeTrackInfo(EXAMPLE_COURSES.nakayamaTurf2500).isBasisDistance).toBe(false);
  });
});

describe('track info: geometry', () => {
  it('numbers corners like the game and marks the repeated ones on two-lap courses', () => {
    const kyoto3200 = computeTrackInfo(byId(10811));
    expect(kyoto3200.corners.map((c) => c.number)).toEqual([3, 4, 1, 2, 3, 4]);
    expect(kyoto3200.corners.filter((c) => c.repeated)).toHaveLength(4);
    expect(kyoto3200.finalCorner?.number).toBe(4);
    expect(kyoto3200.finalCorner?.isFinal).toBe(true);
  });

  it('labels home and back straights and the final straight', () => {
    const info = computeTrackInfo(EXAMPLE_COURSES.tokyoTurf2400);
    expect(info.finalStraight?.kind).toBe('home');
    expect(info.finalStraight?.isFinal).toBe(true);
    expect(info.straights.some((s) => s.kind === 'back')).toBe(true);
  });

  it('finds no-man\'s-land between straights and corners', () => {
    // Tokyo 2400: the stretch between the first straight and corner 1 is neither.
    const info = computeTrackInfo(EXAMPLE_COURSES.tokyoTurf2400);
    for (const gap of info.noMansLand) {
      expect(gap.end).toBeGreaterThan(gap.start);
      const overlapsCorner = info.corners.some((c) => gap.start < c.end && c.start < gap.end);
      const overlapsStraight = info.straights.some((s) => gap.start < s.end && s.start < gap.end);
      expect(overlapsCorner || overlapsStraight).toBe(false);
    }
  });

  it('keeps the two Kyoto 1600 layouts geometrically distinct', () => {
    const inner = computeTrackInfo(byId(10804));
    const outer = computeTrackInfo(byId(10805));
    expect(inner.finalCorner?.start).not.toBe(outer.finalCorner?.start);
    expect(inner.finalStraight?.start).not.toBe(outer.finalStraight?.start);
  });
});

describe('track info: spurt timing', () => {
  it('classifies the final corner against the 2/3 mark', () => {
    // Tokyo 2400: final corner 1625-1875, spurt at 1600 -> the corner starts after the mark.
    expect(computeTrackInfo(EXAMPLE_COURSES.tokyoTurf2400).spurt.geometry).toBe('final-corner-after-spurt');
    // Nakayama 1200: final corner 650-890, spurt at 800 -> inside the corner.
    expect(computeTrackInfo(byId(10501)).spurt.geometry).toBe('final-corner-contains-spurt');
    // Niigata 1000: straight course.
    expect(computeTrackInfo(byId(10301)).spurt.geometry).toBe('no-corners');
  });

  it('reports the offsets in metres and describes them', () => {
    const info = computeTrackInfo(EXAMPLE_COURSES.tokyoTurf2400);
    expect(info.spurt.finalCornerOffset).toBe(25);
    expect(info.spurt.planTail).toBe(2340);
    expect(describeSpurtGeometry(info)).toContain('1600 m');
  });
});

describe('track info: formulas', () => {
  it('applies the stat-threshold speed multiplier by 300-point bands, capped at 901', () => {
    expect(statThresholdMultiplier([], { speed: 1200 })).toBe(1);
    expect(statThresholdMultiplier(['stamina'], { stamina: 300 })).toBeCloseTo(1.05);
    expect(statThresholdMultiplier(['stamina'], { stamina: 301 })).toBeCloseTo(1.1);
    expect(statThresholdMultiplier(['stamina'], { stamina: 900 })).toBeCloseTo(1.15);
    expect(statThresholdMultiplier(['stamina'], { stamina: 1400 })).toBeCloseTo(1.2);
    expect(statThresholdMultiplier(['power', 'wit'], { power: 1000, wit: 200 })).toBeCloseTo(1.125);
  });

  it('computes slope effects', () => {
    expect(uphillSpeedPenalty(2, 1000)).toBeCloseTo(0.4);
    expect(downhillSpeedBonus(2)).toBeCloseTo(0.5);
  });
});
