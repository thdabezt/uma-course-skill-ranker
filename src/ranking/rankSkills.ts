import { RUNNING_STYLE_LABELS } from '@/simulation/config';
import type { RaceSetup, RunnerStats, Skill } from '@/simulation/types';
import { createBaseline, evaluateSkill, type BaselineContext, type SkillEvaluation } from './skillEvaluation';
import { EVALUATION } from '@/simulation/config';
import { HORSE_LENGTH_METHOD, METRES_PER_HORSE_LENGTH } from '@/simulation/horseLength';

/** Result for a skill that a static tag restriction rules out before any simulation. */
export function blockedEvaluation(
  skill: Skill,
  explanations: string[],
  baseline: BaselineContext,
): SkillEvaluation {
  return {
    skillId: skill.id,
    canActivate: false,
    explanations,
    isEstimate: false,
    notModelledEffects: [],
    activatedBashin: 0,
    activationProbability: 0,
    expectedBashin: 0,
    minActivatedBashin: 0,
    maxActivatedBashin: 0,
    sampleCount: 0,
    valueConfidence: 'deterministic',
    expectedHorseLengths: 0,
    minHorseLengths: 0,
    maxHorseLengths: 0,
    averageHorseLengths: 0,
    totalCost: skill.totalCost,
    efficiency: null,
    wastedDurationRatio: 0,
    usefulDurationRatio: 0,
    baselineFinishTimeSeconds: baseline.baseline.finishTimeSeconds,
    bestFinishTimeSeconds: null,
    debug: {
      horseLengthMethod: HORSE_LENGTH_METHOD,
      metresPerHorseLength: METRES_PER_HORSE_LENGTH,
      seed: EVALUATION.seed,
      runsPerSample: EVALUATION.monteCarloRuns,
      totalRuns: 0,
      stdDev: 0,
      ci95: [0, 0],
      baselineHpRemaining: baseline.baseline.hpRemainingFraction,
      baselineSpurtStart: baseline.baseline.spurtStartMeters,
      baselineFullSpurt: baseline.baseline.fullSpurt,
      procRateApplied: false,
      activationModel: 'guaranteed',
      selectedAlternative: -1,
      alternativeCount: skill.conditionGroups.length,
      rejectedAlternatives: skill.conditionGroups.map((_, i) => ({
        priority: i,
        reason: explanations[0] ?? 'blocked by a tag restriction',
      })),
      activations: 0,
      eligibleRuns: 0,
      opponentsSimulated: baseline.fields[0]?.opponents.length ?? 0,
      sampling: null,
    },
    groups: [],
  };
}

export interface RankedSkill {
  skill: Skill;
  evaluation: SkillEvaluation;
}

/**
 * Static gate before any simulation: a skill tagged for another running style,
 * surface or distance category can never help on this course.
 */
export function tagRestrictionBlockers(skill: Skill, setup: RaceSetup, runner: RunnerStats): string[] {
  const blockers: string[] = [];
  if (skill.runningStyleRestriction.length && !skill.runningStyleRestriction.includes(runner.runningStyle)) {
    blockers.push(
      `Restricted to ${skill.runningStyleRestriction
        .map((s) => RUNNING_STYLE_LABELS[s as keyof typeof RUNNING_STYLE_LABELS] ?? s)
        .join(' / ')}, not ${RUNNING_STYLE_LABELS[runner.runningStyle]}.`,
    );
  }
  if (skill.surfaceRestriction.length && !skill.surfaceRestriction.includes(setup.course.surface)) {
    blockers.push(`Restricted to ${skill.surfaceRestriction.join(' / ')}, this course is ${setup.course.surface}.`);
  }
  if (skill.distanceRestriction.length && !skill.distanceRestriction.includes(setup.course.distanceCategory)) {
    blockers.push(
      `Restricted to ${skill.distanceRestriction.join(' / ')} races, this course is ${setup.course.distanceCategory}.`,
    );
  }
  return blockers;
}

export function rankSkills(
  allSkills: Skill[],
  setup: RaceSetup,
  runner: RunnerStats,
  onProgress?: (done: number, total: number) => void,
): { ranked: RankedSkill[]; baseline: BaselineContext } {
  const baseline = createBaseline(setup, runner);
  const ranked: RankedSkill[] = [];

  for (let i = 0; i < allSkills.length; i += 1) {
    const skill = allSkills[i];
    const blockers = tagRestrictionBlockers(skill, setup, runner);
    if (blockers.length) {
      ranked.push({ skill, evaluation: blockedEvaluation(skill, blockers, baseline) });
    } else {
      ranked.push({ skill, evaluation: evaluateSkill(baseline, skill) });
    }
    if (onProgress && i % 25 === 0) onProgress(i, allSkills.length);
  }

  ranked.sort((a, b) => b.evaluation.expectedHorseLengths - a.evaluation.expectedHorseLengths);
  onProgress?.(allSkills.length, allSkills.length);
  return { ranked, baseline };
}
