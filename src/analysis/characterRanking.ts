/**
 * Ranks characters by the value of the skills they bring with them on the
 * selected course: the innate unique skill (upgraded when the card has one) plus
 * evolution skills once they exist on Global.
 *
 * Deliberately NOT a PvP tier list: support-card skills, stat totals, inherited
 * factors and the rest of the field are all out of scope.
 */
import type { Aptitude, RunningStyle } from '@/simulation/config';
import type { CharacterCard, RaceSetup, RunnerStats, Skill } from '@/simulation/types';
import type { SkillAnalysis } from './skillAnalysis';

export interface SkillContribution {
  skill: Skill;
  role: 'unique' | 'evolution' | 'innate' | 'awakening';
  countedInScore: boolean;
  analysis: SkillAnalysis | null;
}

export interface RankedCharacter {
  character: CharacterCard;
  score: number;
  contributions: SkillContribution[];
  aptitude: {
    surface: Aptitude;
    distance: Aptitude;
    style: Aptitude;
    surfaceOk: boolean;
    distanceOk: boolean;
    styleOk: boolean;
  };
  /** Built-in skills that cannot fire on this course, with the reason. */
  inactiveSkills: { skill: Skill; reason: string }[];
  notes: string[];
}

const APTITUDE_RANK: Record<Aptitude, number> = { S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1, G: 0 };

/** Aptitudes below B are treated as "not suited" in the compatibility columns. */
export const APTITUDE_OK_THRESHOLD: Aptitude = 'B';

export function aptitudeOk(a: Aptitude): boolean {
  return APTITUDE_RANK[a] >= APTITUDE_RANK[APTITUDE_OK_THRESHOLD];
}

export function rankCharacters(
  characters: CharacterCard[],
  skillsById: Map<number, Skill>,
  setup: RaceSetup,
  runner: RunnerStats,
  lookup: (skillId: number) => SkillAnalysis | null,
): RankedCharacter[] {
  const out: RankedCharacter[] = [];

  for (const character of characters) {
    const contributions: SkillContribution[] = [];
    const inactive: { skill: Skill; reason: string }[] = [];
    const notes: string[] = [];

    const add = (id: number, role: SkillContribution['role'], counted: boolean) => {
      const skill = skillsById.get(id);
      if (!skill) return;
      const analysis = lookup(id);
      contributions.push({ skill, role, countedInScore: counted && analysis != null, analysis });
      if (analysis && analysis.reliability === 'never') {
        inactive.push({ skill, reason: 'Its conditions cannot be met on this course with this runner.' });
      }
    };

    // The upgraded unique (when the character has one) is what a maxed build runs.
    add(character.primaryUniqueSkillId, 'unique', true);
    for (const id of character.uniqueSkillIds) {
      if (id !== character.primaryUniqueSkillId) add(id, 'unique', false);
    }
    character.evolutionSkillIds.forEach((id, i) => add(id, 'evolution', i < 2));
    for (const id of character.innateSkillIds) add(id, 'innate', false);
    for (const id of character.awakeningSkillIds) add(id, 'awakening', false);

    if (!character.evolutionSkillIds.length) {
      notes.push('No Global-released evolution skill, so the score is the unique skill only.');
    }

    const score = contributions
      .filter((c) => c.countedInScore && c.analysis)
      .reduce((a, c) => a + c.analysis!.gain.mean, 0);

    const surface = character.aptitude[setup.course.surface];
    const distance = character.aptitude[setup.course.distanceCategory];
    const style = character.aptitude[runner.runningStyle as RunningStyle];

    out.push({
      character,
      score,
      contributions,
      aptitude: {
        surface,
        distance,
        style,
        surfaceOk: aptitudeOk(surface),
        distanceOk: aptitudeOk(distance),
        styleOk: aptitudeOk(style),
      },
      inactiveSkills: inactive,
      notes,
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}
