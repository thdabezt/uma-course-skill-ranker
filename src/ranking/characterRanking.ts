/**
 * Ranks characters by the value of the skills they bring with them.
 *
 * Score = unique skill expected value
 *       + evolution skill 1 expected value
 *       + evolution skill 2 expected value
 *
 * This is deliberately NOT a PvP tier list: support-card skills, stat totals,
 * inherited factors and the rest of the field are all out of scope.
 *
 * Note: no evolution skill is released on the Global server yet, so on Global the
 * score currently equals the unique skill's expected value. The evolution terms
 * are still computed so the score is correct the moment they ship.
 */

import type { Aptitude, RunningStyle } from '@/simulation/config';
import type { CharacterCard, RaceSetup, RunnerStats, Skill } from '@/simulation/types';
import { evaluateSkill, type BaselineContext, type SkillEvaluation } from './skillEvaluation';
import { blockedEvaluation, tagRestrictionBlockers } from './rankSkills';

export interface SkillContribution {
  skill: Skill;
  role: 'unique' | 'evolution' | 'innate' | 'awakening';
  countedInScore: boolean;
  expectedHorseLengths: number;
  evaluation: SkillEvaluation;
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

function evaluateOrCached(
  ctx: BaselineContext,
  skill: Skill,
  runner: RunnerStats,
  setup: RaceSetup,
  cache: Map<number, SkillEvaluation>,
): SkillEvaluation {
  const hit = cache.get(skill.id);
  if (hit) return hit;
  const blockers = tagRestrictionBlockers(skill, setup, runner);
  const evaluation = blockers.length ? blockedEvaluation(skill, blockers, ctx) : evaluateSkill(ctx, skill);
  cache.set(skill.id, evaluation);
  return evaluation;
}

export function rankCharacters(
  characters: CharacterCard[],
  skillsById: Map<number, Skill>,
  ctx: BaselineContext,
  evaluationCache: Map<number, SkillEvaluation> = new Map(),
  onProgress?: (done: number, total: number) => void,
): RankedCharacter[] {
  const { setup, runner } = ctx;
  const out: RankedCharacter[] = [];

  characters.forEach((character, index) => {
    const contributions: SkillContribution[] = [];
    const inactive: { skill: Skill; reason: string }[] = [];
    const notes: string[] = [];

    const addSkill = (id: number, role: SkillContribution['role'], counted: boolean) => {
      const skill = skillsById.get(id);
      if (!skill) return;
      const evaluation = evaluateOrCached(ctx, skill, runner, setup, evaluationCache);
      contributions.push({
        skill,
        role,
        countedInScore: counted,
        expectedHorseLengths: evaluation.expectedHorseLengths,
        evaluation,
      });
      if (!evaluation.canActivate) {
        inactive.push({ skill, reason: evaluation.explanations[0] ?? 'Cannot activate on this course.' });
      }
    };

    // The upgraded unique (when the character has one) is what a maxed build runs.
    addSkill(character.primaryUniqueSkillId, 'unique', true);
    for (const id of character.uniqueSkillIds) {
      if (id !== character.primaryUniqueSkillId) addSkill(id, 'unique', false);
    }

    // Evolution skills: the first two are what the score formula uses.
    character.evolutionSkillIds.forEach((id, i) => addSkill(id, 'evolution', i < 2));

    // Innate / awakening skills are shown for context but are not part of the score.
    for (const id of character.innateSkillIds) addSkill(id, 'innate', false);
    for (const id of character.awakeningSkillIds) addSkill(id, 'awakening', false);

    if (!character.evolutionSkillIds.length) {
      notes.push('No Global-released evolution skill, so the score is the unique skill only.');
    }

    const score = contributions
      .filter((c) => c.countedInScore)
      .reduce((a, c) => a + c.expectedHorseLengths, 0);

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

    if (onProgress && index % 10 === 0) onProgress(index, characters.length);
  });

  out.sort((a, b) => b.score - a.score);
  onProgress?.(characters.length, characters.length);
  return out;
}
