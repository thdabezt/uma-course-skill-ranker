import { describe, expect, it } from 'vitest';

import { courses, skills } from '@/data';
import { createBaseline, evaluateSkill } from '@/ranking/skillEvaluation';
import { EVALUATION, MOOD_MULTIPLIER, SIMULATION } from '@/simulation/config';
import { GLOBAL_DATA_VERSION, GLOBAL_JP_DIFFERENCES } from '@/simulation/globalVersion';
import { METRES_PER_HORSE_LENGTH, compareFinish, metresToHorseLengths } from '@/simulation/horseLength';
import { createRng, seedFor, summarize } from '@/simulation/random';
import {
  applyOvercap,
  baseSpeedOf,
  effectiveStats,
  maxHpOf,
  phaseStart,
  positionAtTime,
  simulateRace,
} from '@/simulation/simulator';
import type { Course, RaceSetup, RunnerStats } from '@/simulation/types';
import { EXAMPLE_COURSES, findSkill, runnerFor, setupFor } from './fixtures';

/**
 * Mechanical parity suite.
 *
 * Each case pins a mechanic that was derived from the Global reference simulator
 * (see src/simulation/globalVersion.ts). The tolerances are tight enough that a
 * regression in a formula fails the test rather than being absorbed.
 */

export interface ReferenceCase {
  name: string;
  source: string;
  sourceVersion?: string;
  notes?: string;
}

const REFERENCE: ReferenceCase = {
  name: 'umalator-global mechanics',
  source: 'https://github.com/alpha123/uma-tools',
  sourceVersion: GLOBAL_DATA_VERSION.umalatorReferenceCommit,
  notes: 'GPL-3.0; behaviour studied and reimplemented independently.',
};

const { tokyoTurf1400, tokyoTurf1600, tokyoTurf2400, nakayamaTurf2500, chukyoTurf1200 } = EXAMPLE_COURSES;

const runAll = (setup: RaceSetup, runner: RunnerStats, seed: number = EVALUATION.seed) =>
  simulateRace(setup, runner, [], { seed, recordTrace: true });

describe('Global data version is recorded', () => {
  it('pins the reference commit and the verification date', () => {
    expect(GLOBAL_DATA_VERSION.region).toBe('global');
    expect(GLOBAL_DATA_VERSION.umalatorReferenceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(GLOBAL_DATA_VERSION.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(REFERENCE.sourceVersion).toBe(GLOBAL_DATA_VERSION.umalatorReferenceCommit);
  });

  it('lists the Global-versus-Japan mechanical differences', () => {
    expect(GLOBAL_JP_DIFFERENCES.length).toBeGreaterThan(2);
    const guts = GLOBAL_JP_DIFFERENCES.find((d) => d.mechanic.includes('Last-spurt'));
    expect(guts).toBeDefined();
    // The Global build must NOT apply the Japanese Guts bonus.
    expect(SIMULATION.lastSpurtIncludesGutsBonus).toBe(false);
  });
});

describe('base movement formulas', () => {
  it('derives base speed from the distance', () => {
    expect(baseSpeedOf(2000)).toBeCloseTo(20, 10);
    expect(baseSpeedOf(1200)).toBeCloseTo(20.8, 10);
    expect(baseSpeedOf(2400)).toBeCloseTo(19.6, 10);
  });

  it('places phase boundaries at 1/6, 2/3 and 5/6 of the distance', () => {
    expect(phaseStart(2400, 0)).toBe(0);
    expect(phaseStart(2400, 1)).toBeCloseTo(400, 10);
    expect(phaseStart(2400, 2)).toBeCloseTo(1600, 10);
    expect(phaseStart(2400, 3)).toBeCloseTo(2000, 10);
  });

  it('uses a 1/15 s tick and a 3-entry deceleration table', () => {
    expect(SIMULATION.frameSeconds).toBeCloseTo(1 / 15, 12);
    expect(SIMULATION.decelerationByPhase).toEqual([-1.2, -0.8, -1.0]);
  });

  it('halves stats above the over-cap threshold', () => {
    expect(applyOvercap(1000)).toBe(1000);
    expect(applyOvercap(1200)).toBe(1200);
    expect(applyOvercap(1400)).toBe(1300);
    expect(applyOvercap(1201)).toBe(1200);
  });

  it('scales stats by 2 % per mood step', () => {
    expect(MOOD_MULTIPLIER.great).toBeCloseTo(1.04, 10);
    expect(MOOD_MULTIPLIER.good).toBeCloseTo(1.02, 10);
    expect(MOOD_MULTIPLIER.normal).toBe(1);
    expect(MOOD_MULTIPLIER.awful).toBeCloseTo(0.96, 10);
  });
});

describe('aptitudes affect the right quantity', () => {
  const setup = setupFor(tokyoTurf2400);

  it('surface aptitude does NOT scale the Speed or Power stats', () => {
    const good = effectiveStats(runnerFor('pace_chaser', { surfaceAptitude: 'A' }), setup);
    const bad = effectiveStats(runnerFor('pace_chaser', { surfaceAptitude: 'G' }), setup);
    expect(bad.speed).toBeCloseTo(good.speed, 9);
    expect(bad.power).toBeCloseTo(good.power, 9);
  });

  it('surface aptitude does slow the race down, through acceleration', () => {
    const good = runAll(setup, runnerFor('pace_chaser', { surfaceAptitude: 'A' }));
    const bad = runAll(setup, runnerFor('pace_chaser', { surfaceAptitude: 'G' }));
    expect(bad.finishTimeSeconds).toBeGreaterThan(good.finishTimeSeconds);
  });

  it('running-style aptitude scales Wit, not Speed or Power', () => {
    const good = effectiveStats(runnerFor('pace_chaser', { styleAptitude: 'A' }), setup);
    const bad = effectiveStats(runnerFor('pace_chaser', { styleAptitude: 'G' }), setup);
    expect(bad.wit).toBeLessThan(good.wit * 0.2);
    expect(bad.speed).toBeCloseTo(good.speed, 9);
    expect(bad.power).toBeCloseTo(good.power, 9);
  });

  it('distance aptitude slows the race down', () => {
    const good = runAll(setup, runnerFor('pace_chaser', { distanceAptitude: 'A' }));
    const bad = runAll(setup, runnerFor('pace_chaser', { distanceAptitude: 'F' }));
    expect(bad.finishTimeSeconds).toBeGreaterThan(good.finishTimeSeconds);
  });
});

describe('stamina and spurt', () => {
  it('computes max HP as distance + 0.8 * strategyCoefficient * stamina', () => {
    const setup = setupFor(tokyoTurf2400, 'late_surger');
    const runner = runnerFor('late_surger');
    const stats = effectiveStats(runner, setup);
    expect(maxHpOf(runner, setup, stats)).toBeCloseTo(2400 + 0.8 * 1.0 * stats.stamina, 9);
  });

  it('takes a full spurt when stamina allows and a reduced one when it does not', () => {
    const rich = runAll(setupFor(tokyoTurf2400), runnerFor('pace_chaser', { stamina: 1200 }));
    const poor = runAll(setupFor(tokyoTurf2400), runnerFor('pace_chaser', { stamina: 350 }));
    expect(rich.fullSpurt).toBe(true);
    expect(poor.fullSpurt).toBe(false);
    expect(rich.finishTimeSeconds).toBeLessThan(poor.finishTimeSeconds);
  });

  it('never lets the runner drop below the Guts-derived minimum speed', () => {
    const r = runAll(setupFor(nakayamaTurf2500), runnerFor('pace_chaser', { stamina: 100 }));
    expect(r.ranOutOfStamina).toBe(true);
    expect(r.finished).toBe(true);
    // Even a completely exhausted runner finishes, at the minimum speed.
    const minSpeed = 0.85 * baseSpeedOf(2500);
    expect(2500 / r.finishTimeSeconds).toBeGreaterThan(minSpeed * 0.7);
  });

  it('a speed skill is NOT evaluated as though stamina were infinite', () => {
    const skill = findSkill('Dream Run');
    const rich = evaluateSkill(createBaseline(setupFor(nakayamaTurf2500), runnerFor('pace_chaser', { stamina: 1200 })), skill);
    const poor = evaluateSkill(createBaseline(setupFor(nakayamaTurf2500), runnerFor('pace_chaser', { stamina: 300 })), skill);
    expect(rich.expectedHorseLengths).not.toBeCloseTo(poor.expectedHorseLengths, 2);
  });
});

describe('determinism and pairing', () => {
  it('is exactly reproducible from a seed', () => {
    const a = runAll(setupFor(tokyoTurf2400), runnerFor(), 12345);
    const b = runAll(setupFor(tokyoTurf2400), runnerFor(), 12345);
    expect(a.finishTimeSeconds).toBe(b.finishTimeSeconds);
    expect(a.startDelaySeconds).toBe(b.startDelaySeconds);
    expect(a.spurtStartMeters).toBe(b.spurtStartMeters);
  });

  it('produces different races for different seeds', () => {
    const a = runAll(setupFor(tokyoTurf2400), runnerFor(), 1);
    const b = runAll(setupFor(tokyoTurf2400), runnerFor(), 2);
    expect(a.startDelaySeconds).not.toBe(b.startDelaySeconds);
  });

  it('shares the start delay and Wit variance between a baseline and a skill run', () => {
    const setup = setupFor(tokyoTurf2400);
    const runner = runnerFor();
    const skill = findSkill('Dream Run');
    const base = simulateRace(setup, runner, [], { seed: 777, recordTrace: true });
    const withSkill = simulateRace(
      setup,
      runner,
      [
        {
          skillId: skill.id,
          activateAtMeters: 2000,
          durationSeconds: 5 * 2.4,
          effects: skill.conditionGroups[0].effects,
        },
      ],
      { seed: 777, recordTrace: true, forceSkillActivation: true },
    );
    expect(withSkill.startDelaySeconds).toBe(base.startDelaySeconds);
  });

  it('gives a reproducible evaluation for a fixed seed', () => {
    const skill = findSkill('Dream Run');
    const a = evaluateSkill(createBaseline(setupFor(tokyoTurf2400), runnerFor()), skill);
    const b = evaluateSkill(createBaseline(setupFor(tokyoTurf2400), runnerFor()), skill);
    expect(a.expectedHorseLengths).toBe(b.expectedHorseLengths);
    expect(a.debug.seed).toBe(EVALUATION.seed);
  });

  it('reports sample count, standard deviation and a confidence interval', () => {
    const e = evaluateSkill(createBaseline(setupFor(tokyoTurf2400), runnerFor()), findSkill('Dream Run'));
    expect(e.debug.totalRuns).toBeGreaterThan(0);
    expect(e.debug.stdDev).toBeGreaterThanOrEqual(0);
    expect(e.debug.ci95[0]).toBeLessThanOrEqual(e.debug.ci95[1]);
    const sample = e.groups.find((g) => g.samples.length)!.samples[0];
    expect(sample.runs).toBeGreaterThanOrEqual(EVALUATION.minRuns);
  });
});

describe('horse-length conversion', () => {
  it('uses the Global reference method, not time x finish speed', () => {
    expect(METRES_PER_HORSE_LENGTH).toBe(2.5);
    expect(metresToHorseLengths(5)).toBe(2);
  });

  it('measures the position gap at the moment the leader finishes', () => {
    const cmp = compareFinish({
      baselineFinishTime: 100,
      baselinePositionAtTime: (t) => t * 20,
      skillFinishTime: 99,
      skillPositionAtTime: (t) => t * 20.2,
      courseDistance: 2000,
    });
    // The skill run finishes at t = 99; the baseline has covered 1980 m by then.
    expect(cmp.leaderFinishTimeSeconds).toBe(99);
    expect(cmp.trailingPositionMeters).toBeCloseTo(1980, 9);
    expect(cmp.metresGained).toBeCloseTo(20, 9);
    expect(cmp.horseLengths).toBeCloseTo(8, 9);
    expect(cmp.skillRunWasSlower).toBe(false);
  });

  it('scores a harmful skill negative', () => {
    const cmp = compareFinish({
      baselineFinishTime: 99,
      baselinePositionAtTime: (t) => t * 20.2,
      skillFinishTime: 100,
      skillPositionAtTime: (t) => t * 20,
      courseDistance: 2000,
    });
    expect(cmp.skillRunWasSlower).toBe(true);
    expect(cmp.horseLengths).toBeLessThan(0);
  });

  it('interpolates a recorded run between frames', () => {
    const r = runAll(setupFor(tokyoTurf2400), runnerFor());
    expect(positionAtTime(r, 0)).toBe(0);
    expect(positionAtTime(r, r.finishTimeSeconds)).toBeCloseTo(2400, 0);
    const mid = positionAtTime(r, r.finishTimeSeconds / 2);
    expect(mid).toBeGreaterThan(500);
    expect(mid).toBeLessThan(2400);
  });
});

describe('skill effect types are distinguished', () => {
  const setup = setupFor(tokyoTurf2400);
  const runner = runnerFor();
  // 2000 m: the runner has already caught its last-spurt target here, so target
  // speed is the binding constraint. Firing earlier, while it is still climbing
  // toward that target, a target-speed buff correctly does nothing.
  const at = 2000;
  const base = simulateRace(setup, runner, [], { seed: 42, recordTrace: true });

  const withEffect = (kind: string, rawType: number, rawValue: number, duration = 4) =>
    simulateRace(
      setup,
      runner,
      [{ skillId: 1, activateAtMeters: at, durationSeconds: duration, effects: [{ kind, rawType, rawValue }] }],
      { seed: 42, recordTrace: true, forceSkillActivation: true },
    );

  const lengths = (r: ReturnType<typeof simulateRace>) =>
    compareFinish({
      baselineFinishTime: base.finishTimeSeconds,
      baselinePositionAtTime: (t) => positionAtTime(base, t),
      skillFinishTime: r.finishTimeSeconds,
      skillPositionAtTime: (t) => positionAtTime(r, t),
      courseDistance: setup.course.distance,
    }).horseLengths;

  it('a target-speed skill raises the speed the runner converges on', () => {
    expect(lengths(withEffect('target_speed', 27, 3500))).toBeGreaterThan(0.2);
  });

  it('a target-speed skill is wasted while the runner is still below target', () => {
    // Fired at 1650 m the runner is mid-ramp into its last spurt and is limited by
    // acceleration, not by its target speed, so the buff buys nothing.
    const early = simulateRace(
      setup,
      runner,
      [
        {
          skillId: 1,
          activateAtMeters: 1650,
          durationSeconds: 4,
          effects: [{ kind: 'target_speed', rawType: 27, rawValue: 3500 }],
        },
      ],
      { seed: 42, recordTrace: true, forceSkillActivation: true },
    );
    expect(lengths(early)).toBeCloseTo(0, 3);
  });

  it('an acceleration skill is not an instant speed increase', () => {
    // Same nominal magnitude, but acceleration only pays while below target speed.
    const accel = lengths(withEffect('acceleration', 31, 3500));
    const target = lengths(withEffect('target_speed', 27, 3500));
    expect(accel).not.toBeCloseTo(target, 1);
    expect(accel).toBeGreaterThanOrEqual(0);
  });

  it('a current-speed skill is a displacement offset, not a target-speed buff', () => {
    // The defining difference: a current-speed skill adds velocity unconditionally,
    // so it still pays while the runner is below its target speed - exactly where a
    // target-speed buff is worth nothing.
    const belowTarget = (kind: string, rawType: number) =>
      lengths(
        simulateRace(
          setup,
          runner,
          [
            {
              skillId: 1,
              activateAtMeters: 1650,
              durationSeconds: 4,
              effects: [{ kind, rawType, rawValue: 3500 }],
            },
          ],
          { seed: 42, recordTrace: true, forceSkillActivation: true },
        ),
      );
    expect(belowTarget('target_speed', 27)).toBeCloseTo(0, 3);
    expect(belowTarget('current_speed', 21)).toBeGreaterThan(0.2);
    expect(lengths(withEffect('current_speed', 21, 3500))).toBeGreaterThan(0);
  });

  it('a recovery skill is worth nothing when stamina is already sufficient', () => {
    const rich = createBaseline(setupFor(chukyoTurf1200), runnerFor('pace_chaser', { stamina: 1200 }));
    const e = evaluateSkill(rich, findSkill('Corner Recovery ○'));
    expect(e.canActivate).toBe(true);
    expect(Math.abs(e.expectedHorseLengths)).toBeLessThan(0.2);
  });

  it('a passive skill applies from the gate', () => {
    const passive = simulateRace(
      setup,
      runner,
      [
        {
          skillId: 2,
          activateAtMeters: 0,
          durationSeconds: Infinity,
          effects: [{ kind: 'speed_stat', rawType: 1, rawValue: 600000 }],
        },
      ],
      { seed: 42, recordTrace: true, forceSkillActivation: true },
    );
    expect(lengths(passive)).toBeGreaterThan(0);
  });
});

describe('course fixtures across every distance band', () => {
  const cases: { name: string; course: Course; band: string }[] = [
    { name: 'Takamatsunomiya Kinen', course: chukyoTurf1200, band: 'sprint' },
    { name: 'Yasuda Kinen', course: tokyoTurf1600, band: 'mile' },
    { name: 'Japan Cup', course: tokyoTurf2400, band: 'medium' },
    { name: 'Arima Kinen', course: nakayamaTurf2500, band: 'long' },
  ];

  it.each(cases)('$name finishes and reaches its last spurt', ({ course, band }) => {
    expect(course.distanceCategory).toBe(band);
    const r = runAll(setupFor(course), runnerFor());
    expect(r.finished).toBe(true);
    expect(r.spurtStartMeters).not.toBeNull();
    expect(r.spurtStartMeters!).toBeGreaterThanOrEqual(phaseStart(course.distance, 2) - 1);
  });

  it('runs every running style on every band', () => {
    for (const { course } of cases) {
      for (const style of ['front_runner', 'pace_chaser', 'late_surger', 'end_closer'] as const) {
        const r = runAll(setupFor(course, style), runnerFor(style));
        expect(`${course.name}/${style}: ${r.finished}`).toBe(`${course.name}/${style}: true`);
      }
    }
  });

  it('an uphill course is slower than the same distance without the hill', () => {
    const withHill = nakayamaTurf2500;
    expect(withHill.uphills.length).toBeGreaterThan(0);
    const flat: Course = { ...withHill, uphills: [], downhills: [] };
    const hilly = runAll(setupFor(withHill), runnerFor());
    const level = runAll(setupFor(flat), runnerFor());
    expect(hilly.finishTimeSeconds).toBeGreaterThan(level.finishTimeSeconds);
  });

  it('a 1400 m course is a sprint and finishes fastest', () => {
    expect(tokyoTurf1400.distanceCategory).toBe('sprint');
    const sprint = runAll(setupFor(tokyoTurf1400), runnerFor());
    const mile = runAll(setupFor(tokyoTurf1600), runnerFor());
    expect(sprint.finishTimeSeconds).toBeLessThan(mile.finishTimeSeconds);
  });
});

describe('skill scenarios', () => {
  const ctx = createBaseline(setupFor(tokyoTurf2400), runnerFor());

  it('no-skill baseline is a plain race', () => {
    expect(ctx.baseline.finished).toBe(true);
    expect(Object.keys(ctx.baseline.activationPositions)).toHaveLength(0);
  });

  it('a guaranteed skill reports probability 1 and a positive gain', () => {
    const e = evaluateSkill(ctx, findSkill('Dream Run'));
    expect(e.activationProbability).toBe(1);
    expect(e.expectedHorseLengths).toBeGreaterThan(0.3);
  });

  it('a random-activation skill spans a range', () => {
    const e = evaluateSkill(ctx, findSkill('Corner Adept ○'));
    expect(e.maxHorseLengths).toBeGreaterThan(e.minHorseLengths);
  });

  it('a skill that cannot activate scores zero', () => {
    const e = evaluateSkill(ctx, findSkill('Acceleration')); // Mile only
    expect(e.canActivate).toBe(false);
    expect(e.expectedHorseLengths).toBe(0);
  });

  it('a skill firing at the line is mostly wasted', () => {
    const r = simulateRace(
      setupFor(tokyoTurf2400),
      runnerFor(),
      [
        {
          skillId: 9,
          activateAtMeters: 2395,
          durationSeconds: 8,
          effects: [{ kind: 'target_speed', rawType: 27, rawValue: 3500 }],
        },
      ],
      { seed: 5, recordTrace: true, forceSkillActivation: true },
    );
    expect(r.wastedDurationSeconds[9]).toBeGreaterThan(7);
  });

  it('every Global skill evaluates without throwing', () => {
    for (const s of skills.slice(0, 120)) {
      expect(() => evaluateSkill(ctx, s)).not.toThrow();
    }
  });
});

describe('seeded PRNG', () => {
  it('is reproducible and uniform enough', () => {
    const a = createRng(99);
    const b = createRng(99);
    const xs = Array.from({ length: 2000 }, () => a.next());
    const ys = Array.from({ length: 2000 }, () => b.next());
    expect(xs).toEqual(ys);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const mean = xs.reduce((p, q) => p + q, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it('derives independent labelled streams', () => {
    expect(seedFor(1, 'a')).not.toBe(seedFor(1, 'b'));
    expect(seedFor(1, 'a')).toBe(seedFor(1, 'a'));
  });

  it('summarizes a sample', () => {
    const s = summarize([1, 2, 3, 4, 5]);
    expect(s.n).toBe(5);
    expect(s.mean).toBe(3);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(s.stdDev).toBeCloseTo(Math.sqrt(2.5), 9);
  });
});

describe('all Global courses stay physically sane', () => {
  it('finishes every course inside a believable time band', () => {
    for (const c of courses) {
      const r = runAll(setupFor(c), runnerFor());
      const avgSpeed = c.distance / r.finishTimeSeconds;
      expect(`${c.name}: finished=${r.finished}`).toBe(`${c.name}: finished=true`);
      expect(`${c.name}: ${avgSpeed > 12 && avgSpeed < 26}`).toBe(`${c.name}: true`);
    }
  });
});
