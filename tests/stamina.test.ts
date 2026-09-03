import { describe, expect, it } from 'vitest';

import { courses, skills } from '@/data';
import { computeStamina, staminaSweep } from '@/analysis/stamina';
import { DEFAULT_RUNNER } from '@/simulation/config';
import type { RaceSetup, RunnerStats } from '@/simulation/types';

const course = (track: string, surface: 'turf' | 'dirt', distance: number) =>
  courses.find((c) => c.trackName === track && c.surface === surface && c.distance === distance)!;

const setupFor = (c: ReturnType<typeof course>, style: RunnerStats['runningStyle'] = 'pace_chaser'): RaceSetup => ({
  course: c,
  runningStyle: style,
  trackCondition: 'firm',
  weather: 'sunny',
  season: 'spring',
});

const options = { usePosKeep: true, useCompeteTop: true, useIntChecks: false, forceFullSpurt: true };

describe('stamina calculator', () => {
  it('reports a plausible required stamina for a pace chaser on Tokyo 2400', () => {
    const runner: RunnerStats = { ...DEFAULT_RUNNER, runningStyle: 'pace_chaser' };
    const r = computeStamina({ setup: setupFor(course('Tokyo', 'turf', 2400)), runner, options, skills: [], samples: 80 });
    expect(r.fullSpurtRate).toBeGreaterThanOrEqual(0);
    expect(r.fullSpurtRate).toBeLessThanOrEqual(1);
    expect(r.requiredHp.median).toBeGreaterThan(2400);
    expect(r.staminaFor[100]).toBeGreaterThanOrEqual(r.staminaFor[50]);
    // A 900-stamina Pace Chaser at Great mood is in the usual 700-1100 band for 2400 m.
    expect(r.staminaFor[95]).toBeGreaterThan(500);
    expect(r.staminaFor[95]).toBeLessThan(1300);
    expect(r.rushed.rate).toBeGreaterThanOrEqual(0);
    expect(r.whatIf.some((w) => w.label.includes('position keep'))).toBe(true);
  });

  it('attributes a spot-struggle cost to front runners only', () => {
    const runner: RunnerStats = { ...DEFAULT_RUNNER, runningStyle: 'front_runner' };
    const r = computeStamina({ setup: setupFor(course('Tokyo', 'turf', 1600), 'front_runner'), runner, options, skills: [], samples: 60 });
    expect(r.spotStruggle).not.toBeNull();
    expect(r.spotStruggle!.rate).toBeGreaterThan(0.9);
    expect(r.whatIf.some((w) => w.label.includes('spot struggle'))).toBe(true);
  });

  it('needs less stamina with a gold recovery skill', () => {
    const runner: RunnerStats = { ...DEFAULT_RUNNER, runningStyle: 'pace_chaser' };
    const heal = skills.find((s) => s.category === 'recovery' && s.rarity === 'gold' && s.conditionGroups.some((g) => g.condition.includes('phase_random==1')))!;
    const base = computeStamina({ setup: setupFor(course('Kyoto', 'turf', 3200)), runner, options, skills: [], samples: 60 });
    const withHeal = computeStamina({ setup: setupFor(course('Kyoto', 'turf', 3200)), runner, options, skills: [{ id: String(heal.id) }], samples: 60 });
    expect(withHeal.staminaFor[90]).toBeLessThan(base.staminaFor[90]);
  });

  it('sweeps the full-spurt rate over stamina values monotonically', () => {
    const runner: RunnerStats = { ...DEFAULT_RUNNER, runningStyle: 'pace_chaser' };
    const rows = staminaSweep({ setup: setupFor(course('Tokyo', 'turf', 2400)), runner, options, skills: [], samples: 40 }, [500, 700, 900, 1100, 1300], 40);
    for (let i = 1; i < rows.length; i += 1) expect(rows[i].fullSpurtRate).toBeGreaterThanOrEqual(rows[i - 1].fullSpurtRate);
  });
});
