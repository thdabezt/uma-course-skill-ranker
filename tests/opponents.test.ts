import { describe, expect, it } from 'vitest';

import { characters, skills } from '@/data';
import { createBaseline, evaluateSkill } from '@/ranking/skillEvaluation';
import { EVALUATION, RACE_FIELD } from '@/simulation/config';
import { clearOpponentFieldCache, getOpponentField } from '@/simulation/opponents';
import { createEventHistory, updateRelativeState } from '@/simulation/raceEvents';
import { simulateRace } from '@/simulation/simulator';
import { buildEventPredicate, isEventTerm } from '@/skills/activationModel';
import { analyseConditionGroup } from '@/skills/activation';
import { parseConditionTerm } from '@/skills/conditionParser';
import { EXAMPLE_COURSES, findSkill, runnerFor, setupFor } from './fixtures';

const { tokyoTurf2400, chukyoTurf1200, nakayamaTurf2500, tokyoTurf1600 } = EXAMPLE_COURSES;

describe('opponent field', () => {
  it('generates a reproducible field from a seed', () => {
    clearOpponentFieldCache();
    const a = getOpponentField(setupFor(tokyoTurf2400), runnerFor(), 1234);
    clearOpponentFieldCache();
    const b = getOpponentField(setupFor(tokyoTurf2400), runnerFor(), 1234);
    expect(a.opponents.length).toBe(RACE_FIELD.opponentCount);
    expect(a.opponents.map((o) => o.result.finishTimeSeconds)).toEqual(
      b.opponents.map((o) => o.result.finishTimeSeconds),
    );
    expect(a.opponents.map((o) => o.gate)).toEqual(b.opponents.map((o) => o.gate));
  });

  it('gives every opponent a distinct gate and a plausible race', () => {
    const f = getOpponentField(setupFor(tokyoTurf2400), runnerFor(), 7);
    expect(new Set(f.opponents.map((o) => o.gate)).size).toBe(f.opponents.length);
    for (const o of f.opponents) {
      expect(o.result.finished).toBe(true);
      expect(o.result.finishTimeSeconds).toBeGreaterThan(60);
    }
  });

  it('covers several running styles across the field', () => {
    const f = getOpponentField(setupFor(tokyoTurf2400), runnerFor(), 7);
    expect(new Set(f.opponents.map((o) => o.runningStyle)).size).toBeGreaterThanOrEqual(3);
  });

  it('caches a field instead of rebuilding it per skill', () => {
    clearOpponentFieldCache();
    const first = getOpponentField(setupFor(tokyoTurf2400), runnerFor(), 99);
    expect(getOpponentField(setupFor(tokyoTurf2400), runnerFor(), 99)).toBe(first);
  });

  // The paired-comparison guarantee the whole evaluation depends on.
  it('produces identical opponent trajectories with and without the tested skill', () => {
    const setup = setupFor(tokyoTurf2400);
    const runner = runnerFor();
    const field = getOpponentField(setup, runner, 4321);
    const before = field.opponents.map((o) => o.result.trace.map((p) => p.pos));

    const skill = findSkill('Dream Run');
    simulateRace(
      setup,
      runner,
      [
        {
          skillId: skill.id,
          activateAtMeters: 2000,
          durationSeconds: 12,
          effects: skill.conditionGroups[0].effects,
        },
      ],
      {
        seed: 4321,
        recordTrace: true,
        forceSkillActivation: true,
        opponentPositionsAtFrame: field.positionsAtFrame,
      },
    );

    expect(field.opponents.map((o) => o.result.trace.map((p) => p.pos))).toEqual(before);
    expect(getOpponentField(setup, runner, 4321)).toBe(field);
  });
});

describe('race events', () => {
  const history = () => createEventHistory(3);

  it('detects an overtake only on a real position crossing', () => {
    const h = history();
    const s = updateRelativeState({
      playerPosition: 105,
      previousPlayerPosition: 95,
      opponentPositions: [100, 200],
      previousOpponentPositions: [100, 200],
      previousRank: 3,
      history: h,
      phase: 1,
      pastFinalCorner: false,
      dt: 1 / 15,
    });
    expect(s.isOvertaking).toBe(true);
    expect(h.overtakeCount).toBe(1);
    expect(s.rank).toBe(2);
  });

  it('does not report an overtake merely for being faster', () => {
    const h = history();
    const s = updateRelativeState({
      playerPosition: 90,
      previousPlayerPosition: 80,
      opponentPositions: [100, 200],
      previousOpponentPositions: [98, 199],
      previousRank: 3,
      history: h,
      phase: 1,
      pastFinalCorner: false,
      dt: 1 / 15,
    });
    expect(s.isOvertaking).toBe(false);
    expect(h.overtakeCount).toBe(0);
  });

  it('detects being overtaken', () => {
    const h = history();
    const s = updateRelativeState({
      playerPosition: 100,
      previousPlayerPosition: 99,
      opponentPositions: [105, 50],
      previousOpponentPositions: [98, 49],
      previousRank: 1,
      history: h,
      phase: 1,
      pastFinalCorner: false,
      dt: 1 / 15,
    });
    expect(s.isBeingOvertaken).toBe(true);
    expect(h.overtakenCount).toBe(1);
  });

  it('counts nearby runners and lead distance', () => {
    const h = history();
    const s = updateRelativeState({
      playerPosition: 100,
      previousPlayerPosition: 99,
      opponentPositions: [103, 60],
      previousOpponentPositions: [103, 60],
      previousRank: 2,
      history: h,
      phase: 1,
      pastFinalCorner: false,
      dt: 1 / 15,
    });
    expect(s.runnersAheadNearby).toBe(1);
    expect(s.runnersBehindNearby).toBe(0);
    expect(s.leadDistance).toBeCloseTo(3, 6);
    expect(s.distanceToRunnerAhead).toBeCloseTo(3, 6);
    expect(s.orderRate).toBeCloseTo((2 / 3) * 100, 6);
  });

  it('records the first overtake position and a rank change', () => {
    const h = history();
    updateRelativeState({
      playerPosition: 105,
      previousPlayerPosition: 95,
      opponentPositions: [100],
      previousOpponentPositions: [100],
      previousRank: 2,
      history: h,
      phase: 1,
      pastFinalCorner: false,
      dt: 1 / 15,
    });
    expect(h.orderChangeCount).toBe(1);
    expect(h.firstOvertakeMeters).toBe(105);
  });
});

describe('activation classification', () => {
  const term = (raw: string) => parseConditionTerm(raw)!;

  it('treats order and overtake terms as events, not uniform samples', () => {
    for (const name of ['order', 'order_rate', 'is_overtake', 'near_count', 'bashin_diff_infront']) {
      expect(`${name}: ${isEventTerm(name)}`).toBe(`${name}: true`);
    }
    expect(isEventTerm('phase_random')).toBe(false);
    expect(isEventTerm('all_corner_random')).toBe(false);
  });

  it('builds working predicates for rank terms', () => {
    const rank = buildEventPredicate(term('order<=3'))!;
    expect(rank.model).toBe('rank_event');
    const ctx = (r: number) =>
      ({
        position: 0,
        timeSeconds: 0,
        phase: 1,
        hpFraction: 1,
        isLastSpurt: false,
        relative: { rank: r, orderRate: (r / 12) * 100 },
        events: {},
      }) as never;
    expect(rank.predicate(ctx(2))).toBe(true);
    expect(rank.predicate(ctx(7))).toBe(false);
  });

  it('classifies a mixed random + rank clause as an event but keeps position sampling', () => {
    const a = analyseConditionGroup(
      'phase_firsthalf_random==2&order_rate<=50',
      null,
      setupFor(tokyoTurf2400),
      runnerFor(),
    );
    expect(a.model).toBe('rank_event');
    expect(a.eventTerms.length).toBe(1);
    expect(a.randomWithinWindow).toBe(true);
  });

  it('keeps precondition event terms separate so they can latch', () => {
    const a = analyseConditionGroup(
      'is_last_straight==1',
      'is_finalcorner==1&is_overtake==1&order<=5',
      setupFor(tokyoTurf2400),
      runnerFor(),
    );
    expect(a.preconditionEventTerms.length).toBeGreaterThan(0);
    expect(a.eventTerms.length).toBe(0);
  });
});

describe('activated value versus expected value', () => {
  const ctx = createBaseline(setupFor(tokyoTurf2400), runnerFor());

  it('keeps the two apart and multiplies them consistently', () => {
    for (const name of ['Neck and Neck', 'Dream Run', 'Corner Adept ○']) {
      const e = evaluateSkill(ctx, findSkill(name));
      expect(
        `${name}: ${Math.abs(e.expectedBashin - e.activatedBashin * e.activationProbability) < 1e-9}`,
      ).toBe(`${name}: true`);
      expect(e.expectedHorseLengths).toBe(e.expectedBashin);
    }
  });

  it('labels an opponent-dependent skill as simulated with a real sample count', () => {
    const e = evaluateSkill(ctx, findSkill('Neck and Neck'));
    expect(e.valueConfidence).toBe('simulated');
    expect(e.sampleCount).toBeGreaterThanOrEqual(EVALUATION.eventMinRuns);
    expect(e.debug.activations).toBeGreaterThan(0);
    expect(e.debug.activations).toBeLessThanOrEqual(e.debug.eligibleRuns);
    expect(e.activationProbability).toBeGreaterThan(0);
    expect(e.activationProbability).toBeLessThanOrEqual(1);
  });

  it('labels a fully positional skill deterministic with probability 1', () => {
    const e = evaluateSkill(ctx, findSkill('Dream Run'));
    expect(e.valueConfidence).toBe('deterministic');
    expect(e.activationProbability).toBe(1);
    expect(e.expectedBashin).toBeCloseTo(e.activatedBashin, 9);
  });

  it('reports a confidence interval that brackets the activated value', () => {
    const e = evaluateSkill(ctx, findSkill('Neck and Neck'));
    expect(e.confidenceInterval!.lower).toBeLessThanOrEqual(e.activatedBashin + 1e-9);
    expect(e.confidenceInterval!.upper).toBeGreaterThanOrEqual(e.activatedBashin - 1e-9);
  });

  it('is reproducible for a fixed seed', () => {
    const a = evaluateSkill(createBaseline(setupFor(chukyoTurf1200), runnerFor()), findSkill('Neck and Neck'));
    const b = evaluateSkill(createBaseline(setupFor(chukyoTurf1200), runnerFor()), findSkill('Neck and Neck'));
    expect(a.activatedBashin).toBe(b.activatedBashin);
    expect(a.activationProbability).toBe(b.activationProbability);
  });
});

describe('adaptive sampling', () => {
  it('stops early for a deterministic skill and samples more for an event skill', () => {
    const ctx = createBaseline(setupFor(tokyoTurf2400), runnerFor());
    const det = evaluateSkill(ctx, findSkill('Dream Run'));
    const evt = evaluateSkill(ctx, findSkill('Neck and Neck'));
    expect(det.debug.eligibleRuns).toBeLessThan(evt.debug.eligibleRuns);
    expect(det.debug.sampling?.stoppedBecause).toBeDefined();
  });

  it('records why sampling stopped', () => {
    const ctx = createBaseline(setupFor(nakayamaTurf2500), runnerFor());
    const e = evaluateSkill(ctx, findSkill('Beeline Burst'));
    expect(['deterministic', 'precision_reached', 'maximum_samples']).toContain(
      e.debug.sampling!.stoppedBecause,
    );
    expect(e.debug.sampling!.confidenceLevel).toBe(0.95);
    expect(e.debug.sampling!.count).toBeGreaterThan(0);
  });
});

describe('running styles, Wit and field coverage', () => {
  it('evaluates a rank-conditional skill for every running style', () => {
    for (const style of ['front_runner', 'pace_chaser', 'late_surger', 'end_closer'] as const) {
      const ctx = createBaseline(setupFor(tokyoTurf1600, style), runnerFor(style));
      const e = evaluateSkill(ctx, findSkill('Speed Star'));
      expect(`${style}: ${Number.isFinite(e.expectedBashin)}`).toBe(`${style}: true`);
      expect(`${style}: ${e.activationProbability >= 0 && e.activationProbability <= 1}`).toBe(
        `${style}: true`,
      );
    }
  });

  it('handles low and high Wit', () => {
    const low = createBaseline(setupFor(tokyoTurf2400), runnerFor('pace_chaser', { wit: 200 }));
    const high = createBaseline(setupFor(tokyoTurf2400), runnerFor('pace_chaser', { wit: 1200 }));
    expect(Number.isFinite(evaluateSkill(low, findSkill('Dream Run')).expectedBashin)).toBe(true);
    expect(Number.isFinite(evaluateSkill(high, findSkill('Dream Run')).expectedBashin)).toBe(true);
  });

  it('never returns a probability outside [0, 1] for any Global skill', () => {
    const ctx = createBaseline(setupFor(tokyoTurf2400), runnerFor());
    for (const s of skills.slice(0, 80)) {
      const e = evaluateSkill(ctx, s);
      expect(`${s.name}: ${e.activationProbability >= 0 && e.activationProbability <= 1}`).toBe(
        `${s.name}: true`,
      );
    }
  });
});

describe('inherited unique skills', () => {
  it('ships one inheritable copy per unique skill that has one', () => {
    const inherited = skills.filter((s) => s.isInheritedUnique);
    expect(inherited.length).toBeGreaterThan(90);
    for (const s of inherited) {
      expect(s.rarity).toBe('inherited_unique');
      expect(s.totalCost).toBe(200);
      expect(s.inheritedFromSkillId).not.toBeNull();
    }
  });

  it('gives every skill a unique id, including the inheritable copies', () => {
    // A character with the unique-skill upgrade owns two uniques that share ONE
    // inheritable copy, so it must only be emitted once.
    expect(new Set(skills.map((s) => s.id)).size).toBe(skills.length);
  });

  it('links every inheritable copy back to a real unique skill', () => {
    const byId = new Map(skills.map((s) => [s.id, s]));
    for (const s of skills.filter((x) => x.isInheritedUnique)) {
      const parent = byId.get(s.inheritedFromSkillId!);
      expect(`${s.name}: ${parent !== undefined}`).toBe(`${s.name}: true`);
      expect(['unique', 'unique_upgraded']).toContain(parent!.rarity);
      expect(parent!.isInheritedUnique).toBe(false);
    }
  });

  it('is weaker than the unique skill it comes from', () => {
    const byId = new Map(skills.map((s) => [s.id, s]));
    let compared = 0;
    for (const s of skills.filter((x) => x.isInheritedUnique)) {
      const parent = byId.get(s.inheritedFromSkillId!)!;
      const peak = (sk: typeof s) =>
        Math.max(0, ...sk.conditionGroups.flatMap((g) => g.effects.map((e) => Math.abs(e.rawValue))));
      const dur = (sk: typeof s) => Math.max(0, ...sk.conditionGroups.map((g) => g.baseDurationSeconds));
      if (peak(parent) > 0 && peak(s) > 0) {
        expect(`${s.name}: ${peak(s) <= peak(parent) && dur(s) <= dur(parent)}`).toBe(`${s.name}: true`);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(40);
  });

  it('gives the inheritable copy its own id and a GameTora link', () => {
    const cv = skills.filter((s) => s.name === 'Certain Victory');
    expect(cv).toHaveLength(2);
    const unique = cv.find((s) => !s.isInheritedUnique)!;
    const inherited = cv.find((s) => s.isInheritedUnique)!;
    expect(inherited.id).not.toBe(unique.id);
    expect(inherited.totalCost).toBe(200);
    expect(unique.totalCost).toBeNull();
    expect(inherited.gameToraUrl).toBeTruthy();
  });

  it('never counts an inheritable copy toward a character score', () => {
    for (const c of characters) {
      for (const id of c.uniqueSkillIds) {
        const s = skills.find((x) => x.id === id)!;
        expect(`${c.name}: ${s.isInheritedUnique}`).toBe(`${c.name}: false`);
      }
    }
  });

  it('evaluates an inheritable copy as a normal purchasable skill', () => {
    const ctx = createBaseline(setupFor(tokyoTurf2400), runnerFor());
    const inherited = skills.find((s) => s.isInheritedUnique && s.name === 'Shooting Star')!;
    const e = evaluateSkill(ctx, inherited);
    expect(Number.isFinite(e.expectedBashin)).toBe(true);
    expect(e.efficiency).not.toBeNull();
  });
});

describe('Global-specific skill values', () => {
  it('uses the Global condition where Japan has been rebalanced', () => {
    // Certain Victory was buffed in Japan to trigger on the final straight; Global
    // still triggers past the final corner. The Global form must be what we ship.
    const cv = skills.find((s) => s.name === 'Certain Victory' && !s.isInheritedUnique)!;
    expect(cv.usesGlobalOverride).toBe(true);
    expect(cv.conditionGroups[0].condition).toContain('is_finalcorner');
    expect(cv.conditionGroups[0].condition).not.toBe('is_last_straight==1');
  });

  it('applies Global overrides to durations and thresholds too', () => {
    const ss = skills.find((s) => s.name === 'Shooting Star' && !s.isInheritedUnique)!;
    expect(ss.usesGlobalOverride).toBe(true);
    // Global: 5.0 s base and order_rate <= 50 (Japan: 6.0 s and <= 70).
    expect(ss.conditionGroups[0].baseDurationSeconds).toBe(5);
    expect(ss.conditionGroups[0].condition).toContain('order_rate<=50');
  });

  it('marks a meaningful number of skills as carrying Global-specific values', () => {
    expect(skills.filter((s) => s.usesGlobalOverride).length).toBeGreaterThan(50);
  });
});
