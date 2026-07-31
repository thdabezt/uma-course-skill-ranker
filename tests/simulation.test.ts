import { describe, expect, it } from 'vitest';

import { courses, skills, skillsById } from '@/data';
import { phaseAt, summarizeCourse } from '@/courses/sections';
import { SIMULATION } from '@/simulation/config';
import { baseSpeedOf, effectiveStats, maxHpOf, simulateRace } from '@/simulation/simulator';
import { EXAMPLE_COURSES, runnerFor, setupFor } from './fixtures';

const { tokyoTurf2400, nakayamaTurf2500, chukyoTurf1200, ooiDirt2000 } = EXAMPLE_COURSES;

describe('manually verified example courses', () => {
  it('Tokyo turf 2400 m: left-handed, medium category, has an uphill', () => {
    expect(tokyoTurf2400.direction).toBe('left');
    expect(tokyoTurf2400.distanceCategory).toBe('medium');
    expect(tokyoTurf2400.uphills.length).toBeGreaterThan(0);
    expect(tokyoTurf2400.corners.length).toBe(4);
  });

  it('Nakayama turf 2500 m: right-handed, has an uphill, short home straight', () => {
    expect(nakayamaTurf2500.direction).toBe('right');
    expect(nakayamaTurf2500.uphills.length).toBeGreaterThan(0);
    expect(nakayamaTurf2500.distance - nakayamaTurf2500.finalStraightStart).toBeLessThan(400);
  });

  it('Chukyo turf 1200 m is classified as a short race', () => {
    expect(chukyoTurf1200.distanceCategory).toBe('sprint');
    expect(chukyoTurf1200.surface).toBe('turf');
  });

  it('Ooi dirt 2000 m is a dirt course on a local racecourse', () => {
    expect(ooiDirt2000.surface).toBe('dirt');
    expect(ooiDirt2000.trackName).toBe('Ooi');
  });
});

describe('course-section detection', () => {
  it('phases cover the whole course, in order, without gaps', () => {
    for (const c of courses) {
      expect(c.phases.map((p) => p.phase)).toEqual([0, 1, 2, 3]);
      expect(c.phases[0].start).toBe(0);
      expect(c.phases[3].end).toBe(c.distance);
      for (let i = 1; i < c.phases.length; i += 1) {
        expect(c.phases[i].start).toBe(c.phases[i - 1].end);
      }
    }
  });

  it('reports the phase at a position', () => {
    const c = tokyoTurf2400;
    expect(phaseAt(c, 0)).toBe(0);
    expect(phaseAt(c, c.phases[1].start + 1)).toBe(1);
    expect(phaseAt(c, c.phases[2].start + 1)).toBe(2);
    expect(phaseAt(c, c.distance - 1)).toBe(3);
  });

  it('places the final corner before the final straight on every course', () => {
    for (const c of courses) {
      if (!c.finalCorner) continue;
      expect(c.finalCorner.start).toBeLessThanOrEqual(c.finalStraightStart);
      expect(c.finalStraightStart).toBeLessThanOrEqual(c.distance);
    }
  });

  it('summarizes corners, straights and slopes', () => {
    const s = summarizeCourse(nakayamaTurf2500);
    expect(s.cornerCount).toBeGreaterThan(0);
    expect(s.straightCount).toBeGreaterThan(0);
    expect(s.uphillCount).toBeGreaterThan(0);
    expect(s.cornerMeters + s.straightMeters).toBeGreaterThan(s.distance * 0.5);
  });

  it('keeps every section inside the course', () => {
    for (const c of courses) {
      for (const sec of [...c.corners, ...c.straights, ...c.uphills, ...c.downhills]) {
        expect(sec.start).toBeGreaterThanOrEqual(0);
        expect(sec.end).toBeLessThanOrEqual(c.distance + 1);
        expect(sec.end).toBeGreaterThan(sec.start);
      }
    }
  });
});

describe('race simulation', () => {
  it('uses the configured 1/15 s timestep', () => {
    expect(SIMULATION.frameSeconds).toBeCloseTo(1 / 15, 10);
  });

  it('is deterministic', () => {
    const a = simulateRace(setupFor(tokyoTurf2400), runnerFor());
    const b = simulateRace(setupFor(tokyoTurf2400), runnerFor());
    expect(a.finishTimeSeconds).toBe(b.finishTimeSeconds);
    expect(a.minHpFraction).toBe(b.minHpFraction);
  });

  it('finishes every Global course', () => {
    for (const c of courses) {
      const r = simulateRace(setupFor(c), runnerFor());
      expect(r.finished).toBe(true);
      expect(r.finishTimeSeconds).toBeGreaterThan(0);
    }
  });

  it('takes longer on a longer course', () => {
    const t1600 = courses.find((c) => c.trackName === 'Tokyo' && c.surface === 'turf' && c.distance === 1600)!;
    const a = simulateRace(setupFor(t1600), runnerFor());
    const b = simulateRace(setupFor(tokyoTurf2400), runnerFor());
    expect(b.finishTimeSeconds).toBeGreaterThan(a.finishTimeSeconds);
  });

  it('is slower with a worse track condition', () => {
    const firm = simulateRace(setupFor(tokyoTurf2400), runnerFor());
    const heavy = simulateRace(
      { ...setupFor(tokyoTurf2400), trackCondition: 'heavy' },
      runnerFor(),
    );
    expect(heavy.finishTimeSeconds).toBeGreaterThan(firm.finishTimeSeconds);
  });

  it('is slower with a bad distance aptitude', () => {
    const good = simulateRace(setupFor(tokyoTurf2400), runnerFor('pace_chaser'));
    const bad = simulateRace(setupFor(tokyoTurf2400), runnerFor('pace_chaser', { distanceAptitude: 'F' }));
    expect(bad.finishTimeSeconds).toBeGreaterThan(good.finishTimeSeconds);
  });

  it('runs out of stamina with a very low stamina stat on a long course', () => {
    const r = simulateRace(setupFor(nakayamaTurf2500), runnerFor('pace_chaser', { stamina: 100 }));
    expect(r.ranOutOfStamina).toBe(true);
  });

  it('does not run out of stamina with the reference build on a sprint', () => {
    const r = simulateRace(setupFor(chukyoTurf1200), runnerFor());
    expect(r.ranOutOfStamina).toBe(false);
  });
});

describe('derived quantities', () => {
  it('computes base speed from the course distance', () => {
    expect(baseSpeedOf(2000)).toBeCloseTo(20, 6);
    expect(baseSpeedOf(1000)).toBeCloseTo(21, 6);
    expect(baseSpeedOf(3000)).toBeCloseTo(19, 6);
  });

  it('computes max HP as distance + 0.8 * stamina * strategy coefficient', () => {
    const setup = setupFor(tokyoTurf2400, 'late_surger');
    const runner = runnerFor('late_surger');
    const stats = effectiveStats(runner, setup);
    // The Late Surger stamina coefficient is 1.0.
    expect(maxHpOf(runner, setup, stats)).toBeCloseTo(2400 + 0.8 * stats.stamina, 6);
  });
});

describe('Global availability filtering', () => {
  it('every loaded skill, character and course is flagged Global-available', () => {
    expect(skills.length).toBeGreaterThan(500);
    expect(skills.every((s) => s.globalAvailable)).toBe(true);
    expect(courses.every((c) => c.globalAvailable)).toBe(true);
  });

  it('excludes racecourses with no Global race', () => {
    expect(courses.some((c) => c.trackName === 'Santa Anita Park')).toBe(false);
    expect(courses.some((c) => c.trackName === 'Del Mar')).toBe(false);
  });

  it('contains no evolution skill, because none has shipped on Global', async () => {
    expect(skills.some((s) => s.rarity === 'evolution')).toBe(false);
  });

  it('keeps Japan-only content in a separate file', async () => {
    const { loadExcludedContent } = await import('@/data');
    const excluded = await loadExcludedContent();
    expect(excluded.skills.length).toBeGreaterThan(0);
    const globalIds = new Set(skills.map((s) => s.id));
    for (const s of excluded.skills) expect(globalIds.has(s.id)).toBe(false);
  });

  it('resolves every prerequisite to a Global skill', () => {
    for (const s of skills) {
      for (const p of s.prerequisiteIds) expect(skillsById.has(p)).toBe(true);
    }
  });
});
