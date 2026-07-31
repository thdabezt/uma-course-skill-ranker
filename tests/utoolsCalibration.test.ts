import { describe, expect, it } from 'vitest';

import { characters, courses, skills, skillsById } from '@/data';
import { rankCharacters } from '@/ranking/characterRanking';
import { tagRestrictionBlockers } from '@/ranking/rankSkills';
import { createBaseline, evaluateSkill } from '@/ranking/skillEvaluation';
import { DEFAULT_RUNNER } from '@/simulation/config';
import type { RaceSetup, RunnerStats } from '@/simulation/types';
import { RACES } from './utoolsCalibration.data';

/**
 * Calibration against umalator-global. This is NOT a correctness proof: umalator
 * runs a 500-sample Monte Carlo with wit variance and position keeping, this
 * engine is a deterministic solo simulation. The test only guards against a
 * regression that would move the local numbers into a completely different range,
 * and prints the comparison table used in the report.
 */

const pctDiff = (local: number, ref: number): number => {
  if (ref === 0 && local === 0) return 0;
  if (ref === 0) return Number.POSITIVE_INFINITY;
  return (Math.abs(local - ref) / Math.abs(ref)) * 100;
};

const verdict = (p: number) => (p <= 10 ? 'similar' : p <= 25 ? 'moderate' : 'significant');

interface Row {
  race: string;
  skill: string;
  kind: string;
  local: number | null;
  activated: number;
  probability: number;
  confidence: string;
  ci: [number, number];
  localMin: number;
  localMax: number;
  ref: number;
  refMin: number;
  refMax: number;
  note: string;
}

const rows: Row[] = [];
const localOrder: Record<string, string[]> = {};
const refOrder: Record<string, string[]> = {};

for (const r of RACES) {
  const course = courses.find(
    (c) => c.trackName === r.trackName && c.surface === r.surface && c.distance === r.distance,
  );
  if (!course) continue;

  const setup: RaceSetup = {
    course,
    runningStyle: 'pace_chaser',
    trackCondition: 'firm',
    weather: 'sunny',
    season: 'spring',
  };
  const runner: RunnerStats = { ...DEFAULT_RUNNER, runningStyle: 'pace_chaser' };
  const ctx = createBaseline(setup, runner);

  for (const [name, ref] of Object.entries(r.utools)) {
    const wantedRarity = r.rarities?.[name];
    const skill = skills.find((s) => s.name === name && (!wantedRarity || s.rarity === wantedRarity));
    if (!skill) {
      rows.push({
        race: r.race,
        skill: name,
        kind: r.kinds[name] ?? '',
        local: null,
        activated: 0,
        probability: 0,
        confidence: 'unsupported',
        ci: [0, 0],
        localMin: 0,
        localMax: 0,
        ref: ref.mean,
        refMin: ref.min,
        refMax: ref.max,
        note: 'not present in the Global data set',
      });
      continue;
    }
    const blockers = tagRestrictionBlockers(skill, setup, runner);
    const ev = blockers.length ? null : evaluateSkill(ctx, skill);
    rows.push({
      race: r.race,
      skill: name,
      kind: r.kinds[name] ?? '',
      local: ev ? ev.expectedHorseLengths : 0,
      activated: ev ? ev.activatedBashin : 0,
      probability: ev ? ev.activationProbability : 0,
      confidence: ev ? ev.valueConfidence : 'unsupported',
      ci: ev?.confidenceInterval ? [ev.confidenceInterval.lower, ev.confidenceInterval.upper] : [0, 0],
      localMin: ev ? ev.minHorseLengths : 0,
      localMax: ev ? ev.maxHorseLengths : 0,
      ref: ref.mean,
      refMin: ref.min,
      refMax: ref.max,
      note: blockers[0] ?? (ev && !ev.canActivate ? 'cannot activate locally' : ''),
    });
  }

  const inRace = rows.filter((x) => x.race === r.race && x.local != null);
  const cmpLocal = (x: Row) => (x.confidence === 'simulated' ? x.activated : (x.local as number));
  localOrder[r.race] = inRace
    .slice()
    .sort((a, b) => cmpLocal(b) - cmpLocal(a))
    .map((x) => x.skill);
  refOrder[r.race] = inRace
    .slice()
    .sort((a, b) => b.ref - a.ref)
    .map((x) => x.skill);
}

/** Spearman-style rank agreement between the two orderings. */
function rankAgreement(a: string[], b: string[]): number {
  const idxB = new Map(b.map((n, i) => [n, i]));
  let concordant = 0;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = i + 1; j < a.length; j += 1) {
      const bi = idxB.get(a[i]);
      const bj = idxB.get(a[j]);
      if (bi === undefined || bj === undefined) continue;
      total += 1;
      if (bi < bj) concordant += 1;
    }
  }
  return total === 0 ? 1 : concordant / total;
}

describe('umalator-global calibration', () => {
  it('prints the comparison table', () => {
    // umalator's skill table resolves an order/overtake condition as satisfied, so
    // for a conditional skill its number corresponds to our ACTIVATED value. The
    // expected value (activated x probability) is reported alongside, not instead.
    const comparableLocal = (r: Row) =>
      r.local == null ? null : r.confidence === 'simulated' ? r.activated : r.local;
    const lines = [
      '',
      'Race | Skill | Kind | Comparable | Activated | P(act) | Expected | U-tools | %Diff | Verdict | Confidence',
    ];
    for (const row of rows) {
      if (row.local == null) {
        lines.push(`${row.race} | ${row.skill} | ${row.kind} | - | ${row.ref.toFixed(2)} | - | n/a | ${row.note}`);
        continue;
      }
      const cl = comparableLocal(row)!;
      const p = pctDiff(cl, row.ref);
      lines.push(
        `${row.race} | ${row.skill} | ${row.kind} | ` +
          `${cl.toFixed(2)} | ${row.activated.toFixed(2)} | ${(row.probability * 100).toFixed(0)}% | ` +
          `${row.local.toFixed(2)} | ` +
          `${row.ref.toFixed(2)} (${row.refMin.toFixed(2)}-${row.refMax.toFixed(2)}) | ` +
          `${Number.isFinite(p) ? `${p.toFixed(0)}%` : 'n/a'} | ` +
          `${Number.isFinite(p) ? verdict(p) : 'n/a'} | ${row.confidence}`,
      );
    }
    for (const race of Object.keys(localOrder)) {
      lines.push(
        `ORDER ${race}: agreement ${(rankAgreement(localOrder[race], refOrder[race]) * 100).toFixed(0)}%`,
      );
    }
    const comparable = rows.filter(
      (r) => r.local != null && Number.isFinite(pctDiff(comparableLocal(r) as number, r.ref)),
    );
    const bucket = (lo: number, hi: number) =>
      comparable.filter((r) => {
        const p = pctDiff(comparableLocal(r) as number, r.ref);
        return p > lo && p <= hi;
      }).length;
    lines.push(
      `SUMMARY: ${comparable.length} comparable | <=5% ${bucket(-1, 5)} | <=10% ${bucket(-1, 10)} | <=25% ${bucket(-1, 25)} | significant ${comparable.length - bucket(-1, 25)}`,
    );
     
    console.log(lines.join('\n'));
    expect(rows.length).toBeGreaterThan(20);
  });

  it('keeps every comparable skill inside umalator\'s own min-max envelope, allowing for sampling spread', () => {
    for (const row of rows) {
      if (row.local == null) continue;
      // Local expected value must not exceed umalator's best case by more than 50 %.
      expect(`${row.race}/${row.skill}: ${row.local <= Math.max(row.refMax * 1.5, 0.5)}`).toBe(
        `${row.race}/${row.skill}: true`,
      );
    }
  });

  it('agrees with umalator on the broad ordering of skills in each race', () => {
    // Deliberately loose. umalator runs a 500-sample Monte Carlo with wit variance,
    // position keeping and a full opponent model; this engine is a deterministic
    // solo simulation that systematically values acceleration lower because its
    // runner spends much less of the race below its target speed. The threshold
    // guards against an ordering collapse, not against a small ranking difference.
    for (const race of Object.keys(localOrder)) {
      expect(`${race}: ${rankAgreement(localOrder[race], refOrder[race]) >= 0.4}`).toBe(`${race}: true`);
    }
  });

  it('never produces a non-finite or absurd value', () => {
    for (const row of rows) {
      if (row.local == null) continue;
      expect(Number.isFinite(row.local)).toBe(true);
      expect(Math.abs(row.local)).toBeLessThan(25);
    }
  });

  it('produces a character built-in skill total for every calibration race', () => {
    for (const r of RACES) {
      const course = courses.find(
        (c) => c.trackName === r.trackName && c.surface === r.surface && c.distance === r.distance,
      )!;
      const ctx = createBaseline(
        { course, runningStyle: 'pace_chaser', trackCondition: 'firm', weather: 'sunny', season: 'spring' },
        { ...DEFAULT_RUNNER, runningStyle: 'pace_chaser' },
      );
      const ranked = rankCharacters(characters, skillsById, ctx);
      expect(ranked.length).toBe(characters.length);
      expect(ranked[0].score).toBeGreaterThan(0);
       
      console.log(
        `CHARACTER ${r.race}: ${ranked
          .slice(0, 3)
          .map((x) => `${x.character.name} ${x.score.toFixed(2)}`)
          .join(' | ')}`,
      );
    }
  });
});
