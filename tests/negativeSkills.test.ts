import { describe, expect, it } from 'vitest';

import { characters, loadExcludedContent, skills, skillsById } from '@/data';
import { rankCharacters } from '@/analysis/characterRanking';
import { selectAllAnalyzed } from '@/analysis/rankSkills';
import {
  classifySkill,
  isNegativeEffect,
  isNegativeSkill,
  skillFilterBuckets,
} from '@/skills/classification';
import { EXAMPLE_COURSES, runnerFor, setupFor } from './fixtures';

const { tokyoTurf2400 } = EXAMPLE_COURSES;

/** Names taken from the live Global data set. */
const PURPLE_NEGATIVE = 'Blatant Fear';
const NEGATIVE_CONDITIONS = [
  'Wallflower',
  'Paddock Fright',
  'Defeatist',
  'Reckless',
  'Packphobia',
  'Ramp Revulsion',
  'Gatekept',
  'Creeping Anxiety',
];
const NEGATIVE_APTITUDES = ['Right-Handed ×', 'Tokyo Racecourse ×', 'Firm Conditions ×'];
const OPPONENT_DEBUFFS = ['Intimidate', 'Smoke Screen', 'Hesitant Front Runners', 'Tether'];

describe('isNegativeEffect', () => {
  it('treats a negative value as bad for most effect types', () => {
    expect(isNegativeEffect(27, -1500)).toBe(true); // target speed down
    expect(isNegativeEffect(27, 1500)).toBe(false);
    expect(isNegativeEffect(31, -2000)).toBe(true); // acceleration down
    expect(isNegativeEffect(9, -200)).toBe(true); // stamina drain
  });

  it('inverts the sign for the start-delay and start-reaction effects', () => {
    // reduce_start_delay: a non-negative value ADDS delay.
    expect(isNegativeEffect(14, 850)).toBe(true);
    expect(isNegativeEffect(14, -850)).toBe(false);
    // better_start_reaction: >= 10000 makes the reaction worse.
    expect(isNegativeEffect(10, 15000)).toBe(true);
    expect(isNegativeEffect(10, 4000)).toBe(false);
  });

  it('never flags the effect types that have no bad direction', () => {
    for (const t of [6, 35, 37, 38, 48, 49]) {
      expect(isNegativeEffect(t, -99999)).toBe(false);
    }
  });
});

describe('isNegativeSkill', () => {
  const negative = {
    tags: ['nac'],
    effects: [{ rawType: 27, rawValue: -1500 }],
    isPassive: false,
    effectKinds: ['target_speed'],
  };
  const debuff = {
    tags: ['dbf'],
    effects: [{ rawType: 27, rawValue: -1500 }],
    isPassive: false,
    effectKinds: ['target_speed'],
  };
  const mixed = {
    tags: ['nac'],
    effects: [
      { rawType: 31, rawValue: 2000 },
      { rawType: 9, rawValue: -200 },
    ],
    isPassive: false,
    effectKinds: ['acceleration', 'stamina_recovery'],
  };

  it('flags an all-negative non-debuff skill', () => {
    expect(isNegativeSkill(negative)).toBe(true);
    expect(classifySkill(negative)).toBe('negative');
    expect(skillFilterBuckets(negative)).toEqual(['negative']);
  });

  it('does NOT flag an opponent debuff', () => {
    expect(isNegativeSkill(debuff)).toBe(false);
    expect(classifySkill(debuff)).toBe('debuff');
    expect(skillFilterBuckets(debuff)).toContain('debuff');
  });

  it('does NOT flag a skill that has a downside and an upside', () => {
    expect(isNegativeSkill(mixed)).toBe(false);
    expect(classifySkill(mixed)).toBe('acceleration');
  });
});

describe('negative skills are excluded from the shipped data', () => {
  it('ships no negative skill at all', () => {
    expect(skills.length).toBeGreaterThan(400);
    expect(skills.every((s) => s.isNegativeSkill === false)).toBe(true);
    expect(skills.some((s) => s.category === ('negative' as never))).toBe(false);
    expect(skills.some((s) => s.filterBuckets.includes('negative'))).toBe(false);
  });

  it('excludes the purple negative skill', () => {
    expect(skills.some((s) => s.name === PURPLE_NEGATIVE)).toBe(false);
  });

  it('excludes every negative-condition skill', () => {
    for (const name of NEGATIVE_CONDITIONS) {
      expect(`${name}: ${skills.some((s) => s.name === name)}`).toBe(`${name}: false`);
    }
  });

  it('excludes every negative aptitude skill', () => {
    for (const name of NEGATIVE_APTITUDES) {
      expect(`${name}: ${skills.some((s) => s.name === name)}`).toBe(`${name}: false`);
    }
    expect(skills.some((s) => s.name.endsWith('×'))).toBe(false);
  });

  it('keeps ordinary opponent debuffs, classified separately', () => {
    for (const name of OPPONENT_DEBUFFS) {
      const s = skills.find((x) => x.name === name);
      expect(`${name} present: ${Boolean(s)}`).toBe(`${name} present: true`);
      expect(s!.category).toBe('debuff');
      expect(s!.isDebuff).toBe(true);
      expect(s!.isNegativeSkill).toBe(false);
    }
    expect(skills.filter((s) => s.category === 'debuff').length).toBeGreaterThan(20);
  });

  it('records the excluded negative skills in the developer-only file', async () => {
    const excluded = await loadExcludedContent();
    const negatives = excluded.skills.filter((s) => s.reason.startsWith('negative skill'));
    expect(negatives.length).toBeGreaterThan(30);
    expect(negatives.some((s) => s.name === PURPLE_NEGATIVE)).toBe(true);
    const shipped = new Set(skills.map((s) => s.id));
    for (const s of negatives) expect(shipped.has(s.id)).toBe(false);
  });
});

describe('negative skills cannot reach the rankings or a character score', () => {
  const setup = setupFor(tokyoTurf2400);
  const runner = runnerFor();

  it('never appears in the analysed skill sets', () => {
    const analysed = selectAllAnalyzed(skills);
    expect(analysed.some((s) => s.isNegativeSkill)).toBe(false);
    expect(analysed.some((s) => s.name === PURPLE_NEGATIVE)).toBe(false);
    for (const name of [...NEGATIVE_CONDITIONS, ...NEGATIVE_APTITUDES]) {
      expect(analysed.some((s) => s.name === name)).toBe(false);
    }
  });

  it('never contributes to a character score', () => {
    const ranked = rankCharacters(characters, skillsById, setup, runner, () => null);
    for (const r of ranked) {
      for (const c of r.contributions) {
        expect(c.skill.isNegativeSkill).toBe(false);
        expect(skillsById.has(c.skill.id)).toBe(true);
      }
    }
  });

  it('is not referenced by any character skill list', () => {
    const shipped = new Set(skills.map((s) => s.id));
    for (const c of characters) {
      for (const id of [
        ...c.uniqueSkillIds,
        ...c.evolutionSkillIds,
        ...c.innateSkillIds,
        ...c.awakeningSkillIds,
      ]) {
        expect(shipped.has(id)).toBe(true);
      }
    }
  });

  it('is not offered by any UI filter bucket', () => {
    const buckets = new Set(skills.flatMap((s) => s.filterBuckets));
    expect(buckets.has('negative')).toBe(false);
    expect([...buckets].sort()).toEqual(
      ['acceleration', 'current_speed', 'debuff', 'passive', 'recovery', 'speed'].filter((b) =>
        buckets.has(b),
      ),
    );
  });
});
