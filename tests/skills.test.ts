import { describe, expect, it } from 'vitest';

import { skills } from '@/data';
import { EFFICIENCY_SP_BASIS, SIMULATION } from '@/simulation/config';
import { simulateRace } from '@/simulation/simulator';
import { createBaseline, evaluateSkill, sampleActivationPoints } from '@/ranking/skillEvaluation';
import { analyseCondition } from '@/skills/activation';
import { parseCondition } from '@/skills/conditionParser';
import { durationSeconds } from '@/skills/effects';
import type { ScheduledEffect } from '@/simulation/types';
import { EXAMPLE_COURSES, findSkill, runnerFor, setupFor } from './fixtures';

const { tokyoTurf2400, chukyoTurf1200 } = EXAMPLE_COURSES;

describe('condition parser', () => {
  it('splits OR alternatives on @ and AND terms on &', () => {
    const expr = parseCondition('distance_rate>=50&order==1@is_overtake==1');
    expect(expr).toHaveLength(2);
    expect(expr[0].terms.map((t) => t.name)).toEqual(['distance_rate', 'order']);
    expect(expr[0].terms[0].operator).toBe('>=');
    expect(expr[0].terms[0].value).toBe(50);
    expect(expr[1].terms[0].name).toBe('is_overtake');
  });

  it('ignores malformed terms instead of throwing', () => {
    expect(parseCondition('garbage')).toEqual([]);
    expect(parseCondition(null)).toEqual([]);
  });
});

describe('activation windows', () => {
  it('maps a final-straight condition onto the home straight', () => {
    const a = analyseCondition('is_last_straight==1', setupFor(tokyoTurf2400), runnerFor());
    expect(a.possible).toBe(true);
    expect(a.windows).toHaveLength(1);
    expect(a.windows[0].start).toBe(tokyoTurf2400.finalStraightStart);
    expect(a.windows[0].end).toBe(tokyoTurf2400.distance);
    expect(a.probability).toBe(1);
  });

  it('maps a random-corner condition onto every corner and marks it random', () => {
    const a = analyseCondition('all_corner_random==1', setupFor(tokyoTurf2400), runnerFor());
    expect(a.randomWithinWindow).toBe(true);
    expect(a.windows.length).toBeGreaterThan(0);
  });

  it('blocks a condition that no position satisfies', () => {
    const flat = { ...tokyoTurf2400, uphills: [], downhills: [] };
    const a = analyseCondition('up_slope_random==1', setupFor(flat), runnerFor());
    expect(a.possible).toBe(false);
    expect(a.blockers.join(' ')).toContain('uphill');
  });

  it('samples a single deterministic point but many random points', () => {
    const windows = [{ start: 100, end: 500 }];
    expect(sampleActivationPoints(windows, false)).toEqual([100]);
    expect(sampleActivationPoints(windows, true).length).toBeGreaterThan(1);
  });
});

describe('guaranteed speed skill', () => {
  const skill = findSkill('Dream Run'); // final straight, target speed +0.35 m/s

  it('activates with certainty and produces a positive, bounded gain', () => {
    const ctx = createBaseline(setupFor(tokyoTurf2400), runnerFor());
    const e = evaluateSkill(ctx, skill);

    expect(e.canActivate).toBe(true);
    expect(e.activationProbability).toBe(1);
    expect(e.isEstimate).toBe(false);
    expect(e.expectedHorseLengths).toBeGreaterThan(0.5);
    expect(e.expectedHorseLengths).toBeLessThan(6);
    expect(e.minHorseLengths).toBeLessThanOrEqual(e.maxHorseLengths);
    expect(e.expectedHorseLengths).toBeGreaterThanOrEqual(e.minHorseLengths - 1e-9);
  });

  it('gains more on a course where the effect lasts longer', () => {
    const long = evaluateSkill(createBaseline(setupFor(tokyoTurf2400), runnerFor()), skill);
    const short = evaluateSkill(createBaseline(setupFor(chukyoTurf1200), runnerFor()), skill);
    expect(long.expectedHorseLengths).toBeGreaterThan(short.expectedHorseLengths);
  });

  it('scales its duration with the course distance', () => {
    const group = skill.conditionGroups[0];
    expect(durationSeconds(group, 2400)).toBeCloseTo(group.baseDurationSeconds * 2.4, 9);
    expect(durationSeconds(group, 1000)).toBeCloseTo(group.baseDurationSeconds, 9);
  });
});

describe('guaranteed acceleration skill', () => {
  const skill = findSkill('Highlander'); // acceleration only, deterministic trigger

  it('activates with certainty and is worth less than a comparable speed skill', () => {
    const ctx = createBaseline(setupFor(tokyoTurf2400), runnerFor());
    const accel = evaluateSkill(ctx, skill);
    const speed = evaluateSkill(ctx, findSkill('Dream Run'));

    expect(accel.canActivate).toBe(true);
    expect(accel.activationProbability).toBe(1);
    expect(accel.expectedHorseLengths).toBeGreaterThanOrEqual(0);
    // A runner already at target speed cannot use extra acceleration.
    expect(accel.expectedHorseLengths).toBeLessThan(speed.expectedHorseLengths);
  });

  it('only contains acceleration effects', () => {
    expect(skill.effectKinds).toContain('acceleration');
    expect(skill.effectKinds).not.toContain('target_speed');
  });
});

describe('random activation skill', () => {
  const skill = findSkill('Corner Adept ○'); // random point on a random corner

  it('reports a spread between the best and the worst activation point', () => {
    const ctx = createBaseline(setupFor(tokyoTurf2400), runnerFor());
    const e = evaluateSkill(ctx, skill);

    expect(e.canActivate).toBe(true);
    const group = e.groups.find((g) => g.samples.length > 0)!;
    expect(group.activation.randomWithinWindow).toBe(true);
    expect(group.samples.length).toBeGreaterThan(1);
    expect(e.maxHorseLengths).toBeGreaterThan(e.minHorseLengths);
    expect(e.averageHorseLengths).toBeGreaterThanOrEqual(e.minHorseLengths);
    expect(e.averageHorseLengths).toBeLessThanOrEqual(e.maxHorseLengths);
    expect(e.explanations.join(' ')).toMatch(/random point/i);
  });
});

describe('skill that cannot activate', () => {
  it('rejects a Mile-only skill on a 2400 m course', () => {
    const skill = findSkill('Acceleration'); // distance_type == 2 (Mile)
    const ctx = createBaseline(setupFor(tokyoTurf2400), runnerFor());
    const e = evaluateSkill(ctx, skill);

    expect(e.canActivate).toBe(false);
    expect(e.expectedHorseLengths).toBe(0);
    expect(e.efficiency).toBeNull();
    expect(e.explanations.join(' ')).toMatch(/Mile/i);
  });

  it('rejects a Late Surger skill for a Front Runner', () => {
    const skill = findSkill('A Small Breather'); // running_style == 3
    const ctx = createBaseline(setupFor(tokyoTurf2400, 'front_runner'), runnerFor('front_runner'));
    const e = evaluateSkill(ctx, skill);

    expect(e.canActivate).toBe(false);
    expect(e.expectedHorseLengths).toBe(0);
  });

  it('rejects an uphill skill on a flat course', () => {
    const flat = { ...tokyoTurf2400, uphills: [] };
    const skill = skills.find((s) =>
      s.conditionGroups.some((g) => g.condition.includes('up_slope_random')),
    )!;
    const ctx = createBaseline(setupFor(flat), runnerFor());
    expect(evaluateSkill(ctx, skill).canActivate).toBe(false);
  });
});

describe('skill partly wasted near the finish', () => {
  it('counts the duration the finish line cuts off', () => {
    const setup = setupFor(tokyoTurf2400);
    const runner = runnerFor();
    const planned: ScheduledEffect[] = [
      {
        skillId: 1,
        // Fires 10 m from the line, so almost the whole effect is thrown away.
        activateAtMeters: tokyoTurf2400.distance - 10,
        durationSeconds: 8,
        effects: [{ kind: 'target_speed', rawType: 27, rawValue: 3500 }],
      },
    ];
    const run = simulateRace(setup, runner, planned);
    expect(run.wastedDurationSeconds[1]).toBeGreaterThan(7);
    expect(run.effectiveDurationSeconds[1]).toBeLessThan(1);
  });

  it('reports a non-zero waste ratio for a real late-race skill', () => {
    const ctx = createBaseline(setupFor(tokyoTurf2400), runnerFor());
    const e = evaluateSkill(ctx, findSkill('Beeline Burst'));
    expect(e.canActivate).toBe(true);
    expect(e.wastedDurationRatio).toBeGreaterThan(0);
    expect(e.usefulDurationRatio).toBeCloseTo(1 - e.wastedDurationRatio, 9);
    expect(e.explanations.join(' ')).toMatch(/cut off by the finish line/i);
  });
});

describe('prerequisite skill point cost', () => {
  it('adds the white skill cost to its gold upgrade', () => {
    const white = findSkill('Corner Adept ○');
    const gold = findSkill('Professor of Curvature');

    expect(gold.rarity).toBe('gold');
    expect(gold.prerequisiteIds).toContain(white.id);
    expect(gold.totalCost).toBe((gold.baseCost ?? 0) + (white.baseCost ?? 0));
    expect(gold.totalCost).toBe(360);
  });

  it('uses the total cost for the efficiency metric', () => {
    const ctx = createBaseline(setupFor(tokyoTurf2400), runnerFor());
    const gold = findSkill('Professor of Curvature');
    const e = evaluateSkill(ctx, gold);
    expect(e.efficiency).toBeCloseTo(
      (e.expectedHorseLengths * EFFICIENCY_SP_BASIS) / (gold.totalCost as number),
      9,
    );
  });

  it('never reports a total cost below the base cost', () => {
    for (const s of skills) {
      if (s.baseCost == null || s.totalCost == null) continue;
      expect(s.totalCost).toBeGreaterThanOrEqual(s.baseCost);
    }
  });
});

describe('horse-length conversion', () => {
  it('uses the configured metres per horse length', () => {
    expect(SIMULATION.horseLengthMeters).toBe(2.5);
    const ctx = createBaseline(setupFor(tokyoTurf2400), runnerFor());
    const e = evaluateSkill(ctx, findSkill('Dream Run'));
    const sample = e.groups.find((g) => g.samples.length)!.samples[0];
    expect(sample.horseLengths).toBeCloseTo(sample.metersGained / SIMULATION.horseLengthMeters, 9);
    expect(sample.metersGained).toBeCloseTo(sample.timeSavedSeconds * (sample.metersGained / sample.timeSavedSeconds), 6);
  });
});
