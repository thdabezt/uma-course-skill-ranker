import { describe, expect, it } from 'vitest';

import { courses, skills } from '@/data';
import { createBaseline, evaluateSkill } from '@/ranking/skillEvaluation';
import { GLOBAL_TRACK_IDS, TRACK_NAME_BY_ID } from '@/courses/trackIds';
import { analyseConditionGroup } from '@/skills/activation';
import { conditionNames } from '@/skills/conditionParser';
import { conditionDocByName } from '@/data';
import type { Course, Skill } from '@/simulation/types';
import { runnerFor, setupFor } from './fixtures';

/** Canonical id of All Charged! It's Go Time! - looked up by id, never by name. */
const ALL_CHARGED_ID = 100311;
const ALL_CHARGED_INHERITED_ID = 900311;

const courseOf = (track: string, surface: 'turf' | 'dirt', distance: number): Course => {
  const c = courses.find((x) => x.trackName === track && x.surface === surface && x.distance === distance);
  if (!c) throw new Error(`missing course ${track} ${surface} ${distance}`);
  return c;
};

const evalOn = (skill: Skill, course: Course) =>
  evaluateSkill(createBaseline(setupFor(course), runnerFor()), skill);

describe('canonical track ids', () => {
  it('matches every normalized course to a canonical id', () => {
    for (const c of courses) {
      expect(`${c.trackName}: ${TRACK_NAME_BY_ID[c.trackId]}`).toBe(`${c.trackName}: ${c.trackName}`);
    }
  });

  it('maps Tokyo to 10006', () => {
    expect(GLOBAL_TRACK_IDS.TOKYO).toBe(10006);
    expect(courseOf('Tokyo', 'turf', 2400).trackId).toBe(GLOBAL_TRACK_IDS.TOKYO);
    expect(courseOf('Chukyo', 'turf', 1200).trackId).toBe(GLOBAL_TRACK_IDS.CHUKYO);
  });

  it('covers every Global racecourse present in the data', () => {
    const ids = new Set(courses.map((c) => c.trackId));
    for (const [name, id] of Object.entries(GLOBAL_TRACK_IDS)) {
      expect(`${name} present: ${ids.has(id)}`).toBe(`${name} present: true`);
    }
    // The 14 domestic racecourses plus Longchamp.
    expect(Object.keys(GLOBAL_TRACK_IDS)).toHaveLength(15);
  });
});

describe("All Charged! It's Go Time!", () => {
  const skill = skills.find((s) => s.id === ALL_CHARGED_ID)!;

  it('is found by canonical id and keeps both alternatives', () => {
    expect(skill).toBeDefined();
    expect(skill.rarity).toBe('unique');
    expect(skill.conditionGroups).toHaveLength(2);
  });

  it('declares the enhanced branch first, gated on slope geometry - not on track_id', () => {
    const enhanced = skill.conditionGroups[0];
    const fallback = skill.conditionGroups[1];
    // Enhanced: uphill at 300-305 m remaining, then flat or downhill at 295-299 m.
    expect(enhanced.precondition).toContain('slope==1');
    expect(enhanced.condition).toContain('slope==0');
    expect(enhanced.effects[0].rawValue).toBe(4500);
    // Fallback: same position band, no slope requirement, weaker.
    expect(fallback.precondition).toBeNull();
    expect(fallback.condition).not.toContain('slope');
    expect(fallback.effects[0].rawValue).toBe(2500);
    // The data has no track_id term; the Tokyo behaviour is emergent geometry.
    expect(skill.conditionGroups.some((g) => g.condition.includes('track_id'))).toBe(false);
  });

  it('selects the enhanced branch at Tokyo', () => {
    for (const distance of [1400, 2400]) {
      const e = evalOn(skill, courseOf('Tokyo', 'turf', distance));
      expect(`Tokyo ${distance} alt`).toBe(`Tokyo ${distance} alt`);
      expect(e.debug.selectedAlternative).toBe(0);
      expect(e.debug.alternativeCount).toBe(2);
    }
  });

  it('rejects the enhanced branch outside Tokyo and falls back', () => {
    for (const [track, distance] of [
      ['Chukyo', 1200],
      ['Nakayama', 2500],
      ['Kyoto', 2000],
      ['Hanshin', 2000],
    ] as const) {
      const e = evalOn(skill, courseOf(track, 'turf', distance));
      expect(`${track}: alt=${e.debug.selectedAlternative}`).toBe(`${track}: alt=1`);
      expect(e.debug.rejectedAlternatives.some((r) => r.priority === 0)).toBe(true);
    }
  });

  it('is worth more at Tokyo than at a course of the same distance elsewhere', () => {
    const tokyo = evalOn(skill, courseOf('Tokyo', 'turf', 2400));
    const kyoto = evalOn(skill, courseOf('Kyoto', 'turf', 2400));
    expect(tokyo.debug.selectedAlternative).toBe(0);
    expect(kyoto.debug.selectedAlternative).toBe(1);
    expect(tokyo.activatedBashin).toBeGreaterThan(kyoto.activatedBashin);
  });

  it('applies the same branch rule to the inheritable copy', () => {
    const inherited = skills.find((s) => s.id === ALL_CHARGED_INHERITED_ID)!;
    expect(inherited.isInheritedUnique).toBe(true);
    expect(evalOn(inherited, courseOf('Tokyo', 'turf', 2400)).debug.selectedAlternative).toBe(0);
    expect(evalOn(inherited, courseOf('Kyoto', 'turf', 2400)).debug.selectedAlternative).toBe(1);
  });

  it('never sums the two alternatives', () => {
    const e = evalOn(skill, courseOf('Tokyo', 'turf', 2400));
    const selected = e.groups.find((g) => g.selected)!;
    expect(e.activatedBashin).toBeCloseTo(selected.averageHorseLengths, 9);
    expect(e.groups.filter((g) => g.selected)).toHaveLength(1);
  });
});

describe('alternative selection rule', () => {
  it('always picks the earliest eligible alternative, never the strongest', () => {
    const course = courseOf('Tokyo', 'turf', 2400);
    const ctx = createBaseline(setupFor(course), runnerFor());
    let multi = 0;
    for (const s of skills.filter((x) => x.conditionGroups.length > 1).slice(0, 60)) {
      const e = evaluateSkill(ctx, s);
      if (e.debug.selectedAlternative < 0) continue;
      multi += 1;
      const eligible = e.groups.filter((g) => g.activation.possible && g.samples.length > 0);
      const earliest = Math.min(...eligible.map((g) => g.priority));
      expect(`${s.name}: ${e.debug.selectedAlternative}`).toBe(`${s.name}: ${earliest}`);
    }
    expect(multi).toBeGreaterThan(10);
  });

  it('records a rejection reason for every unselected alternative', () => {
    const e = evalOn(skills.find((s) => s.id === ALL_CHARGED_ID)!, courseOf('Kyoto', 'turf', 2400));
    for (const g of e.groups.filter((x) => !x.selected)) {
      expect(typeof g.rejectionReason).toBe('string');
      expect(g.rejectionReason!.length).toBeGreaterThan(0);
    }
  });
});

describe('slope conditions respect course geometry', () => {
  it('treats slope==0 as flat, not as unconstrained', () => {
    const nakayama = courseOf('Nakayama', 'turf', 2500);
    const a = analyseConditionGroup('slope==0', null, setupFor(nakayama), runnerFor());
    expect(a.possible).toBe(true);
    // Flat windows must exclude every uphill and downhill.
    for (const w of a.windows) {
      for (const up of nakayama.uphills) {
        expect(`${w.start}-${w.end} vs up ${up.start}-${up.end}`).toBe(
          w.start < up.end && up.start < w.end ? 'OVERLAP' : `${w.start}-${w.end} vs up ${up.start}-${up.end}`,
        );
      }
    }
  });

  it('blocks an uphill condition on a course with no uphill', () => {
    const flat: Course = { ...courseOf('Tokyo', 'turf', 2400), uphills: [], downhills: [] };
    const a = analyseConditionGroup('slope==1', null, setupFor(flat), runnerFor());
    expect(a.possible).toBe(false);
  });
});

describe('course-conditional skill audit', () => {
  const COURSE_CONDITION_KEYS = [
    'track_id',
    'course_distance',
    'distance_type',
    'ground_type',
    'rotation',
    'is_basis_distance',
    'is_dirtgrade',
    'is_tight_track',
    'slope',
    'up_slope_random',
    'down_slope_random',
    'corner',
    'all_corner_random',
    'is_finalcorner',
    'is_finalcorner_random',
    'is_finalcorner_laterhalf',
    'straight_random',
    'straight_front_type',
    'is_last_straight',
    'last_straight_random',
    'remain_distance',
    'distance_rate',
  ];

  interface Audit {
    skillId: number;
    skillName: string;
    condition: string;
    alternativeCount: number;
    hasFallback: boolean;
    importedCorrectly: boolean;
  }

  const audited: Audit[] = skills
    .filter((s) =>
      s.conditionGroups.some((g) =>
        [...conditionNames(g.condition), ...conditionNames(g.precondition)].some((n) =>
          COURSE_CONDITION_KEYS.includes(n),
        ),
      ),
    )
    .map((s) => ({
      skillId: s.id,
      skillName: s.name,
      condition: s.conditionGroups.map((g) => g.condition).join(' || '),
      alternativeCount: s.conditionGroups.length,
      hasFallback: s.conditionGroups.some((g) => !g.precondition),
      importedCorrectly: s.conditionGroups.every((g) => g.condition.length > 0 && g.effects.length > 0),
    }));

  it('finds a substantial number of course-conditional skills', () => {
     
    console.log(
      `COURSE-CONDITIONAL AUDIT: ${audited.length} skills, ` +
        `${audited.filter((a) => a.alternativeCount > 1).length} with multiple alternatives, ` +
        `${audited.filter((a) => !a.hasFallback).length} without an unconditional fallback`,
    );
    expect(audited.length).toBeGreaterThan(100);
  });

  it('imported every course-conditional skill with usable alternatives', () => {
    for (const a of audited) {
      expect(`${a.skillName}: ${a.importedCorrectly}`).toBe(`${a.skillName}: true`);
    }
  });

  it('never treats an unknown condition key as guaranteed true', () => {
    const known = new Set(conditionDocByName.keys());
    const used = new Set(
      skills.flatMap((s) =>
        s.conditionGroups.flatMap((g) => [
          ...conditionNames(g.condition),
          ...conditionNames(g.precondition),
        ]),
      ),
    );
    const unknown = [...used].filter((n) => !known.has(n));
     
    console.log('UNSUPPORTED CONDITION KEYS:', unknown.length ? unknown.join(', ') : '(none)');
    // Anything not decidable must come back as an estimate, never as certainty.
    const course = courseOf('Tokyo', 'turf', 2400);
    for (const name of unknown) {
      const a = analyseConditionGroup(`${name}==1`, null, setupFor(course), runnerFor());
      expect(`${name}: ${a.probability < 1 || a.isEstimate}`).toBe(`${name}: true`);
    }
  });
});

describe('course changes are not cached across courses', () => {
  it('gives a slope-gated skill different results per course', () => {
    const skill = skills.find((s) => s.id === ALL_CHARGED_ID)!;
    const tokyo = evalOn(skill, courseOf('Tokyo', 'turf', 2400));
    const kyoto = evalOn(skill, courseOf('Kyoto', 'turf', 2400));
    const tokyoAgain = evalOn(skill, courseOf('Tokyo', 'turf', 2400));
    expect(tokyo.debug.selectedAlternative).toBe(0);
    expect(kyoto.debug.selectedAlternative).toBe(1);
    // Re-evaluating Tokyo after Kyoto must not return the Kyoto branch.
    expect(tokyoAgain.debug.selectedAlternative).toBe(0);
    expect(tokyoAgain.activatedBashin).toBeCloseTo(tokyo.activatedBashin, 9);
  });
});

describe('results are always finite', () => {
  it('returns no NaN or Infinity for any Global skill on a sprint, mile, medium and long course', () => {
    for (const c of [
      courseOf('Tokyo', 'turf', 1400),
      courseOf('Tokyo', 'turf', 1600),
      courseOf('Tokyo', 'turf', 2400),
      courseOf('Nakayama', 'turf', 2500),
    ]) {
      const ctx = createBaseline(setupFor(c), runnerFor());
      for (const s of skills.slice(0, 60)) {
        const e = evaluateSkill(ctx, s);
        for (const [label, v] of [
          ['activated', e.activatedBashin],
          ['probability', e.activationProbability],
          ['expected', e.expectedBashin],
        ] as const) {
          expect(`${c.name}/${s.name}/${label}: ${Number.isFinite(v)}`).toBe(
            `${c.name}/${s.name}/${label}: true`,
          );
        }
      }
    }
  });
});
