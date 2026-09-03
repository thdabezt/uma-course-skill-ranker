import { describe, expect, it } from 'vitest';

import { courses, skills } from '@/data';
import { analyzeSkill, createAnalysisContext } from '@/analysis/skillAnalysis';
import { isAccelSkill, isSpeedSkill } from '@/analysis/rankSkills';
import { DEFAULT_RUNNER } from '@/simulation/config';
import type { RaceSetup, RunnerStats } from '@/simulation/types';

const course = (track: string, surface: 'turf' | 'dirt', distance: number, layout?: string) =>
  courses.find((c) => c.trackName === track && c.surface === surface && c.distance === distance && (!layout || c.layout === layout))!;

const skillByName = (name: string, rarity?: string) => skills.find((s) => s.name === name && (!rarity || s.rarity === rarity))!;

const runner: RunnerStats = { ...DEFAULT_RUNNER, runningStyle: 'pace_chaser' };
const setupFor = (c: ReturnType<typeof course>): RaceSetup => ({
  course: c,
  runningStyle: 'pace_chaser',
  trackCondition: 'firm',
  weather: 'sunny',
  season: 'spring',
});

describe('skill analysis', () => {
  it('rates a final-corner acceleration skill as perfect where the corner holds the 2/3 mark', () => {
    // Nakayama 1200 (outer): final corner 650-890 m, final leg from 800 m. Budding
    // Blossom's inheritable copy (final corner second half, phase >= 2) fires at 800 m.
    const ctx = createAnalysisContext(setupFor(course('Nakayama', 'turf', 1200)), runner);
    const a = analyzeSkill(ctx, skillByName('Budding Blossom', 'inherited_unique'), 24);
    expect(a.reliability).toBe('immediate');
    expect(a.activation?.meanStart).toBeCloseTo(800, -1);
    expect(a.accel?.verdict).toBe('perfect');
    expect(a.accel!.referenceGain).toBeGreaterThan(0.5);
    expect(a.gain.mean).toBeGreaterThan(0.5);
  });

  it('rates the same skill as useless where the final corner ends before the final leg', () => {
    // Tokyo 2400: final corner 1625-1875 m, its second half starts 150 m after the 2/3 mark.
    const ctx = createAnalysisContext(setupFor(course('Tokyo', 'turf', 2400)), runner);
    const a = analyzeSkill(ctx, skillByName('Budding Blossom', 'inherited_unique'), 24);
    expect(a.accel?.verdict).toBe('does-not-work');
    expect(a.timing.offsetFromPhase2).toBeGreaterThan(100);
  });

  it('flags a running-style restricted skill as never firing', () => {
    const ctx = createAnalysisContext(setupFor(course('Tokyo', 'turf', 2400)), runner);
    const skill = skills.find((s) => s.runningStyleRestriction.length === 1 && s.runningStyleRestriction[0] === 'end_closer')!;
    const a = analyzeSkill(ctx, skill, 8);
    expect(a.reliability).toBe('never');
    expect(a.samples).toBe(0);
  });

  it('reports a random-region skill with an activation spread and a zone-based verdict', () => {
    const ctx = createAnalysisContext(setupFor(course('Tokyo', 'turf', 2400)), runner);
    const skill = skills.find((s) => s.effectKinds.includes('acceleration') && s.conditionGroups.some((g) => g.condition === 'all_corner_random==1'))!;
    const a = analyzeSkill(ctx, skill, 40);
    expect(a.reliability).toBe('random');
    expect(a.activation!.maxStart - a.activation!.minStart).toBeGreaterThan(50);
    expect(['lottery', 'does-not-work', 'near-perfect', 'perfect']).toContain(a.accel?.verdict);
    expect(a.accel!.usefulShare).toBeGreaterThanOrEqual(0);
  });

  it('credits a speed skill that carries into the final leg', () => {
    // Ambitious Breeze fires at 1441 m on Tokyo 2400 and is still active at the
    // 1600 m speed jump in every run.
    const ctx = createAnalysisContext(setupFor(course('Tokyo', 'turf', 2400)), runner);
    const a = analyzeSkill(ctx, skillByName('Ambitious Breeze'), 24);
    expect(a.speed).not.toBeNull();
    expect(['S', 'A']).toContain(a.speed!.tier);
    expect(a.gain.mean).toBeGreaterThan(1);
    expect(a.timing.carryoverShare).toBeGreaterThan(0.9);
  });

  it('shows an immediate final-leg speed skill being shadowed by the acceleration', () => {
    const ctx = createAnalysisContext(setupFor(course('Tokyo', 'turf', 2400)), runner);
    const a = analyzeSkill(ctx, skillByName('∴win Q.E.D.', 'inherited_unique'), 16);
    expect(a.timing.shadowShare).toBeGreaterThan(0.9);
    expect(a.gain.mean).toBeLessThan(0.2);
  });

  it('puts a skill with both a speed and an acceleration part in both tabs', () => {
    // Shooting Star: current-speed + acceleration; Break It Down!: target-speed + acceleration.
    for (const name of ['Shooting Star', 'Break It Down!']) {
      const skill = skillByName(name, 'inherited_unique');
      expect(isSpeedSkill(skill)).toBe(true);
      expect(isAccelSkill(skill)).toBe(true);
    }
    const both = skills.filter((s) => isSpeedSkill(s) && isAccelSkill(s));
    expect(both.length).toBeGreaterThanOrEqual(50);
    const ctx = createAnalysisContext(setupFor(course('Nakayama', 'turf', 1200)), runner);
    const a = analyzeSkill(ctx, skillByName('Shooting Star', 'inherited_unique'), 16);
    expect(a.speed).not.toBeNull();
    expect(a.accel).not.toBeNull();
  });

  it('keeps the simulated tier for skills that need another runner (no extra cap)', () => {
    // #LookatCurren fires on overtaking; the engine draws the moment from a distribution.
    const ctx = createAnalysisContext(setupFor(course('Tokyo', 'turf', 1600)), runner);
    const a = analyzeSkill(ctx, skillByName('#LookatCurren', 'inherited_unique'), 24);
    expect(a.reliability).toBe('field');
    expect(a.activation?.rate).toBeGreaterThan(0.9);
    expect(a.speed?.explanation).toContain('Needs other runners');
    const expected = a.gain.mean >= 1.5 ? 'S' : a.gain.mean >= 1 ? 'A' : a.gain.mean >= 0.5 ? 'B' : a.gain.mean >= 0.15 ? 'C' : 'D';
    expect(a.speed?.tier).toBe(expected);
  });

  it('distinguishes the Kyoto 1600 inner and outer layouts', () => {
    const inner = createAnalysisContext(setupFor(course('Kyoto', 'turf', 1600, 'inner')), runner);
    const outer = createAnalysisContext(setupFor(course('Kyoto', 'turf', 1600, 'outer')), runner);
    const skill = skills.find((s) => s.effectKinds.includes('acceleration') && s.conditionGroups.some((g) => g.condition === 'is_finalcorner==1'))
      ?? skills.find((s) => s.effectKinds.includes('acceleration') && s.conditionGroups.some((g) => g.condition.startsWith('is_finalcorner==1')))!;
    const a = analyzeSkill(inner, skill, 16);
    const b = analyzeSkill(outer, skill, 16);
    expect(a.region?.start).not.toBe(b.region?.start);
  });
});
