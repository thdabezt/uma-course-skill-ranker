import { describe, expect, it } from 'vitest';

import { courses } from '@/data';
import {
  DISTANCE_CATEGORY_LABELS,
  getDistanceCategory,
  type DistanceCategory,
} from '@/courses/distanceCategory';
import { auditCourses } from '../scripts/lib/audit-courses.mjs';
import { EXAMPLE_COURSES } from './fixtures';

const { tokyoTurf1400, tokyoTurf1600, tokyoTurf2000, tokyoTurf2400, tokyoTurf2500 } = EXAMPLE_COURSES;

describe('getDistanceCategory', () => {
  it('classifies the named Tokyo turf courses', () => {
    expect(getDistanceCategory(1400)).toBe('sprint');
    expect(getDistanceCategory(1600)).toBe('mile');
    expect(getDistanceCategory(2000)).toBe('medium');
    expect(getDistanceCategory(2400)).toBe('medium');
    expect(getDistanceCategory(2500)).toBe('long');
  });

  it('is correct on every band boundary', () => {
    const cases: [number, DistanceCategory][] = [
      [1000, 'sprint'],
      [1399, 'sprint'],
      [1400, 'sprint'],
      [1401, 'mile'],
      [1500, 'mile'],
      [1799, 'mile'],
      [1800, 'mile'],
      [1801, 'medium'],
      [1900, 'medium'],
      [2399, 'medium'],
      [2400, 'medium'],
      [2401, 'long'],
      [2500, 'long'],
      [3600, 'long'],
    ];
    for (const [m, expected] of cases) {
      expect(`${m} -> ${getDistanceCategory(m)}`).toBe(`${m} -> ${expected}`);
    }
  });

  it('exposes a label for every category', () => {
    for (const c of ['sprint', 'mile', 'medium', 'long'] as DistanceCategory[]) {
      expect(DISTANCE_CATEGORY_LABELS[c]).toBeTruthy();
    }
  });
});

describe('stored course classifications', () => {
  it('matches the centralized rule for every course', () => {
    for (const c of courses) {
      expect(`${c.name}: ${c.distanceCategory}`).toBe(`${c.name}: ${getDistanceCategory(c.distance)}`);
    }
  });

  it('classifies the regression set correctly', () => {
    expect(tokyoTurf1400.distanceCategory).toBe('sprint');
    expect(tokyoTurf1600.distanceCategory).toBe('mile');
    expect(tokyoTurf2000.distanceCategory).toBe('medium');
    expect(tokyoTurf2400.distanceCategory).toBe('medium');
    expect(tokyoTurf2500.distanceCategory).toBe('long');
  });

  it('overrides GameTora where its own enum disagrees', () => {
    // GameTora tags 1300 m and 1400 m courses as Mile; the official band is Sprint.
    const overridden = courses.filter(
      (c) => c.upstreamDistanceCategory && c.upstreamDistanceCategory !== c.distanceCategory,
    );
    expect(overridden.length).toBeGreaterThan(0);
    for (const c of overridden) {
      expect(c.distance).toBeLessThanOrEqual(1400);
      expect(c.distanceCategory).toBe('sprint');
      expect(c.upstreamDistanceCategory).toBe('mile');
    }
  });

  it('does not classify any course as Sprint above 1400 m or Long below 2401 m', () => {
    for (const c of courses) {
      if (c.distanceCategory === 'sprint') expect(c.distance).toBeLessThanOrEqual(1400);
      if (c.distanceCategory === 'long') expect(c.distance).toBeGreaterThan(2400);
    }
  });
});

describe('course audit', () => {
  const { issues, checked } = auditCourses(courses);
  const errors = issues.filter((i) => i.severity === 'error');

  it('checks every shipped course', () => {
    expect(checked).toBe(courses.length);
  });

  it('reports no structural errors', () => {
    expect(errors.map((e) => `${e.course}: ${e.check} - ${e.detail}`)).toEqual([]);
  });

  it('detects an injected distance-category mismatch', () => {
    const broken = [{ ...tokyoTurf1400, distanceCategory: 'mile' }];
    const r = auditCourses(broken);
    expect(r.issues.some((i) => i.check === 'distance-category' && i.severity === 'error')).toBe(true);
  });

  it('detects an out-of-range section', () => {
    const broken = [
      { ...tokyoTurf1400, corners: [{ start: 100, end: tokyoTurf1400.distance + 500, number: 1 }] },
    ];
    const r = auditCourses(broken);
    expect(r.issues.some((i) => i.check === 'section-out-of-range')).toBe(true);
  });

  it('detects overlapping sections', () => {
    const broken = [
      {
        ...tokyoTurf1400,
        uphills: [{ start: 100, end: 400, gradePercent: 1 }],
        downhills: [{ start: 300, end: 600, gradePercent: 1 }],
      },
    ];
    const r = auditCourses(broken);
    expect(r.issues.some((i) => i.check === 'overlapping-sections')).toBe(true);
  });

  it('detects a broken phase chain', () => {
    const broken = [
      {
        ...tokyoTurf1400,
        phases: [
          { start: 0, end: 200, phase: 0 },
          { start: 300, end: 800, phase: 1 },
          { start: 800, end: 1100, phase: 2 },
          { start: 1100, end: tokyoTurf1400.distance, phase: 3 },
        ],
      },
    ];
    const r = auditCourses(broken);
    expect(r.issues.some((i) => i.check === 'phase-boundaries')).toBe(true);
  });

  it('detects a missing course variant', () => {
    const broken = [{ ...tokyoTurf1400, layout: '' }];
    const r = auditCourses(broken);
    expect(r.issues.some((i) => i.check === 'missing-layout')).toBe(true);
  });

  it('detects an invalid inner/outer variant', () => {
    const broken = [{ ...tokyoTurf1400, layout: 'sideways' }];
    const r = auditCourses(broken);
    expect(r.issues.some((i) => i.check === 'invalid-layout')).toBe(true);
  });

  it('detects a duplicate course identity', () => {
    const broken = [tokyoTurf1400, { ...tokyoTurf1400, id: tokyoTurf1400.id + 1 }];
    const r = auditCourses(broken);
    expect(r.issues.some((i) => i.check === 'duplicate-identity')).toBe(true);
  });
});

describe('course identity and layout coverage', () => {
  it('gives every course a unique id', () => {
    expect(new Set(courses.map((c) => c.id)).size).toBe(courses.length);
  });

  it('records a surface, direction and course variant for every course', () => {
    for (const c of courses) {
      expect(['turf', 'dirt']).toContain(c.surface);
      expect(['right', 'left', 'straight']).toContain(c.direction);
      expect(['standard', 'inner', 'outer', 'outer-inner']).toContain(c.layout);
    }
  });

  it('gives every course a start at 0 m and a finish at its full distance', () => {
    for (const c of courses) {
      expect(c.phases[0].start).toBe(0);
      expect(c.phases[3].end).toBe(c.distance);
      expect(c.finalStraightStart).toBeLessThan(c.distance);
    }
  });

  it('keeps inner and outer variants of the same distance distinct', () => {
    const groups = new Map<string, Set<string>>();
    for (const c of courses) {
      const key = `${c.trackId}|${c.surface}|${c.distance}`;
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key)!.add(c.layout);
    }
    for (const [key, layouts] of groups) {
      const sameKey = courses.filter((c) => `${c.trackId}|${c.surface}|${c.distance}` === key);
      // Several rows for one distance must differ by their inner/outer variant.
      if (sameKey.length > 1) expect(layouts.size).toBeGreaterThan(1);
    }
  });
});
