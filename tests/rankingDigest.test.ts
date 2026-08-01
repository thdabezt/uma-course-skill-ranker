import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { courses, skills } from '@/data';
import { blockedEvaluation, rankSkills, tagRestrictionBlockers } from '@/ranking/rankSkills';
import { createBaseline, evaluateSkill } from '@/ranking/skillEvaluation';
import { clearOpponentFieldCache } from '@/simulation/opponents';
import type { Course } from '@/simulation/types';
import { runnerFor, setupFor } from './fixtures';

/**
 * The gate for every performance change.
 *
 * Making the app fast must not move a single published number. This suite pins the
 * full 653-skill output on two courses that exercise different code paths, so any
 * refactor - caching, worker sharding, simulator micro-optimization - either
 * reproduces them exactly or fails here.
 *
 * Regenerate deliberately, never casually:
 *   UPDATE_RANKING_DIGEST=1 npx vitest run tests/rankingDigest.test.ts
 * and then explain in the commit message why the numbers were allowed to move.
 */
const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'ranking-digest.json',
);

const UPDATE = process.env.UPDATE_RANKING_DIGEST === '1';

/** One row per skill: the values the UI actually shows, at full double precision. */
type DigestRow = [
  skillId: number,
  expectedHorseLengths: number,
  activationProbability: number,
  averageHorseLengths: number,
  totalRuns: number,
  activations: number,
];

interface CourseDigest {
  baselineFinishTimeSeconds: number;
  /** Ranked order is part of the output, so pin the leaderboard separately. */
  topSkillIds: number[];
  /** Sorted by skill id so the fixture does not churn when the ranking order shifts. */
  rows: DigestRow[];
}

function findCourse(track: string, surface: 'turf' | 'dirt', distance: number): Course {
  const c = courses.find(
    (x) => x.trackName === track && x.surface === surface && x.distance === distance,
  );
  if (!c) throw new Error(`digest course not found: ${track} ${surface} ${distance}`);
  return c;
}

const CASES = {
  // Mile on turf: the most common shape, and the one the UI opens closest to.
  tokyoTurf1600: findCourse('Tokyo', 'turf', 1600),
  // Long on turf: longest spurt planning and the heaviest HP path.
  kyotoTurf3200: findCourse('Kyoto', 'turf', 3200),
};

function digestFor(course: Course): CourseDigest {
  clearOpponentFieldCache();
  const { ranked, baseline } = rankSkills(skills, setupFor(course), runnerFor());
  const rows: DigestRow[] = ranked
    .map(
      (r): DigestRow => [
        r.skill.id,
        r.evaluation.expectedHorseLengths,
        r.evaluation.activationProbability,
        r.evaluation.averageHorseLengths,
        r.evaluation.debug.totalRuns,
        r.evaluation.debug.activations,
      ],
    )
    .sort((a, b) => a[0] - b[0]);
  return {
    baselineFinishTimeSeconds: baseline.baseline.finishTimeSeconds,
    topSkillIds: ranked.slice(0, 25).map((r) => r.skill.id),
    rows,
  };
}

const FIELD_NAMES = [
  'skillId',
  'expectedHorseLengths',
  'activationProbability',
  'averageHorseLengths',
  'totalRuns',
  'activations',
];

/** Human-readable diff: a bare deep-equal on 653 rows is unreadable when it fails. */
function describeDifferences(actual: CourseDigest, expected: CourseDigest): string[] {
  const out: string[] = [];
  if (actual.baselineFinishTimeSeconds !== expected.baselineFinishTimeSeconds) {
    out.push(
      `baselineFinishTimeSeconds ${expected.baselineFinishTimeSeconds} -> ${actual.baselineFinishTimeSeconds}`,
    );
  }
  const byId = new Map(expected.rows.map((r) => [r[0], r]));
  const nameById = new Map(skills.map((s) => [s.id, s.name]));
  for (const row of actual.rows) {
    const want = byId.get(row[0]);
    if (!want) {
      out.push(`skill ${row[0]} (${nameById.get(row[0]) ?? '?'}) is new`);
      continue;
    }
    for (let i = 1; i < row.length; i += 1) {
      if (row[i] !== want[i]) {
        out.push(
          `${nameById.get(row[0]) ?? row[0]} [${FIELD_NAMES[i]}] ${want[i]} -> ${row[i]}`,
        );
      }
    }
    if (out.length > 12) return out.slice(0, 12).concat('... (truncated)');
  }
  if (actual.rows.length !== expected.rows.length) {
    out.push(`row count ${expected.rows.length} -> ${actual.rows.length}`);
  }
  if (actual.topSkillIds.join(',') !== expected.topSkillIds.join(',')) {
    out.push('ranked order changed in the top 25');
  }
  return out;
}

describe('ranking digest', () => {
  const produced: Record<string, CourseDigest> = {};

  for (const [name, course] of Object.entries(CASES)) {
    it(`is unchanged on ${name}`, () => {
      const actual = digestFor(course);
      produced[name] = actual;
      expect(actual.rows).toHaveLength(skills.length);

      if (UPDATE) return;

      const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, CourseDigest>;
      const expectedDigest = fixture[name];
      expect(expectedDigest, `no fixture entry for ${name}`).toBeDefined();

      const diffs = describeDifferences(actual, expectedDigest);
      expect(diffs, `simulated numbers moved on ${name}:\n${diffs.join('\n')}`).toEqual([]);
    });
  }

  it('writes the fixture when asked', () => {
    if (!UPDATE) {
      expect(UPDATE).toBe(false);
      return;
    }
    writeFileSync(FIXTURE, `${JSON.stringify(produced, null, 0)}\n`, 'utf8');
    expect(Object.keys(produced).sort()).toEqual(Object.keys(CASES).sort());
  });
});

describe('worker sharding safety', () => {
  /**
   * Moving the ranking into workers means each worker evaluates a subset of the
   * skills against its own freshly built baseline. That is only sound if a skill's
   * result does not depend on which other skills were evaluated first - i.e. if the
   * shared baseline, seeds and opponent field are reproduced exactly per shard.
   *
   * This asserts it directly, so a future change to seeding or to the opponent-field
   * cache cannot silently make the worker path disagree with the single-threaded one.
   */
  it('gives identical results whether skills are ranked together or in 8 shards', () => {
    const course = CASES.tokyoTurf1600;
    const setup = setupFor(course);
    const runner = runnerFor();

    clearOpponentFieldCache();
    const whole = new Map(
      rankSkills(skills, setup, runner).ranked.map((r) => [r.skill.id, r.evaluation]),
    );

    const SHARDS = 8;
    const sharded = new Map<number, ReturnType<typeof evaluateSkill>>();
    for (let shard = 0; shard < SHARDS; shard += 1) {
      // A worker starts cold: fresh baseline, nothing carried over from a sibling.
      clearOpponentFieldCache();
      const ctx = createBaseline(setup, runner);
      for (let i = shard; i < skills.length; i += SHARDS) {
        const skill = skills[i];
        const blockers = tagRestrictionBlockers(skill, setup, runner);
        sharded.set(
          skill.id,
          blockers.length ? blockedEvaluation(skill, blockers, ctx) : evaluateSkill(ctx, skill),
        );
      }
    }

    expect(sharded.size).toBe(whole.size);
    const mismatches: string[] = [];
    for (const [id, evaluation] of whole) {
      const other = sharded.get(id);
      if (!other) {
        mismatches.push(`skill ${id} missing from the sharded run`);
        continue;
      }
      if (
        other.expectedHorseLengths !== evaluation.expectedHorseLengths ||
        other.activationProbability !== evaluation.activationProbability ||
        other.debug.totalRuns !== evaluation.debug.totalRuns
      ) {
        mismatches.push(
          `${id}: ${evaluation.expectedHorseLengths}/${evaluation.activationProbability} -> ${other.expectedHorseLengths}/${other.activationProbability}`,
        );
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
  });
});
