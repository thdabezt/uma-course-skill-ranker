import { describe, expect, it } from 'vitest';

import { characters, skills, skillsById } from '@/data';
import { createBaseline } from '@/ranking/skillEvaluation';
import { aptitudeOk, rankCharacters } from '@/ranking/characterRanking';
import { rankSkills } from '@/ranking/rankSkills';
import { EXAMPLE_COURSES, runnerFor, setupFor } from './fixtures';

const { tokyoTurf2400, chukyoTurf1200 } = EXAMPLE_COURSES;

describe('character total calculation', () => {
  const ctx = createBaseline(setupFor(tokyoTurf2400), runnerFor());
  const ranked = rankCharacters(characters, skillsById, ctx);

  it('ranks every Global character', () => {
    expect(ranked).toHaveLength(characters.length);
    expect(ranked.length).toBeGreaterThan(50);
  });

  it('scores exactly the sum of the counted contributions', () => {
    for (const r of ranked) {
      const sum = r.contributions
        .filter((c) => c.countedInScore)
        .reduce((a, c) => a + c.expectedHorseLengths, 0);
      expect(r.score).toBeCloseTo(sum, 9);
    }
  });

  it('counts the unique skill plus at most two evolution skills', () => {
    for (const r of ranked) {
      const counted = r.contributions.filter((c) => c.countedInScore);
      expect(counted.filter((c) => c.role === 'unique')).toHaveLength(1);
      expect(counted.filter((c) => c.role === 'evolution').length).toBeLessThanOrEqual(2);
      expect(counted.every((c) => c.role === 'unique' || c.role === 'evolution')).toBe(true);
    }
  });

  it('shows every built-in skill separately, including the ones that cannot fire', () => {
    const withInactive = ranked.find((r) => r.inactiveSkills.length > 0);
    expect(withInactive).toBeDefined();
    for (const s of withInactive!.inactiveSkills) {
      expect(s.reason.length).toBeGreaterThan(0);
      const contribution = withInactive!.contributions.find((c) => c.skill.id === s.skill.id);
      expect(contribution?.expectedHorseLengths).toBe(0);
    }
  });

  it('is sorted by score, descending', () => {
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  it('reports surface, distance and running-style compatibility', () => {
    const r = ranked[0];
    expect(r.aptitude.surface).toBe(r.character.aptitude.turf);
    expect(r.aptitude.distance).toBe(r.character.aptitude.medium);
    expect(r.aptitude.style).toBe(r.character.aptitude.pace_chaser);
    expect(r.aptitude.surfaceOk).toBe(aptitudeOk(r.aptitude.surface));
  });

  it('produces a different order on a different course', () => {
    const sprintCtx = createBaseline(setupFor(chukyoTurf1200), runnerFor());
    const sprint = rankCharacters(characters, skillsById, sprintCtx);
    const a = ranked.slice(0, 10).map((r) => r.character.cardId);
    const b = sprint.slice(0, 10).map((r) => r.character.cardId);
    expect(a).not.toEqual(b);
  });

  it('only uses skills that exist in the Global data set', () => {
    for (const r of ranked) {
      for (const c of r.contributions) expect(skillsById.has(c.skill.id)).toBe(true);
    }
  });
});

describe('skill ranking pipeline', () => {
  it('ranks every Global skill and sorts by expected horse lengths', () => {
    const { ranked } = rankSkills(skills, setupFor(tokyoTurf2400), runnerFor());
    expect(ranked).toHaveLength(skills.length);
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].evaluation.expectedHorseLengths).toBeGreaterThanOrEqual(
        ranked[i].evaluation.expectedHorseLengths,
      );
    }
  });

  // One case per style rather than one loop over all four. Ranking the full skill
  // list takes ~13 s, and four of them back-to-back block the vitest worker's event
  // loop long enough for its progress RPC to the main thread to time out - which
  // fails the run even though every assertion passed. Separate cases also name the
  // offending style directly when one breaks.
  it.each(['front_runner', 'pace_chaser', 'late_surger', 'end_closer'] as const)(
    'reports progress and finishes for the %s style',
    (style) => {
      const seen: number[] = [];
      const { ranked } = rankSkills(skills, setupFor(tokyoTurf2400, style), runnerFor(style), (done) =>
        seen.push(done),
      );
      expect(ranked.length).toBe(skills.length);
      expect(seen[seen.length - 1]).toBe(skills.length);
      expect(ranked.some((r) => r.evaluation.canActivate)).toBe(true);
    },
  );

  it('blocks skills restricted to another running style', () => {
    const { ranked } = rankSkills(skills, setupFor(tokyoTurf2400, 'front_runner'), runnerFor('front_runner'));
    const lateSurgerOnly = ranked.filter((r) => r.skill.runningStyleRestriction.includes('late_surger'));
    expect(lateSurgerOnly.length).toBeGreaterThan(0);
    for (const r of lateSurgerOnly) expect(r.evaluation.canActivate).toBe(false);
  });
});
