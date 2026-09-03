/**
 * Per-skill analysis on one racecourse: how many horse lengths a skill is worth,
 * where it fires, and - for acceleration and speed skills - why.
 *
 * Every number comes from paired simulations with the vendored uma-tools engine
 * (see src/engine/compare.ts). The classification rules on top are this
 * project's own and are documented next to the code.
 */
import '@/engine';
import { toEngineCourse } from '@/engine/adapters';
import {
  runComparison,
  summarize,
  type ActivationRecord,
  type ComparisonResult,
  type RunProfile,
  type SimulationOptions,
  type Summary,
  type SyntheticSkill,
} from '@/engine/compare';
import { toHorseDesc, toRaceDefinition, type RaceDefinition } from '@/engine/runner';
import { phaseStart } from '@/courses/trackInfo';
import type { CourseData } from '@/engine/vendor/CourseData';
import { Region, RegionList } from '@/engine/vendor/Region';
import { Perspective, SkillType, isTarget } from '@/engine/vendor/RaceSolver';
import { buildBaseStats, buildSkillData, type HorseDesc, type SkillData } from '@/engine/vendor/RaceSolverBuilder';
import { getParser } from '@/engine/vendor/ConditionParser';
import { AllCornerRandomPolicy, DistributionRandomPolicy, ImmediatePolicy, RandomPolicy, StraightRandomPolicy } from '@/engine/vendor/ActivationSamplePolicy';
import type { RaceSetup, RunnerStats, Skill } from '@/simulation/types';
import { hasAccelEffect as skillHasAccel, hasSpeedEffect as skillHasSpeed } from './rankSkills';

export type Reliability =
  /** Fires at a fixed point (the start of its condition region). */
  | 'immediate'
  /** Fires at a random point inside its region. */
  | 'random'
  /** Depends on other runners; modelled by a probability distribution. */
  | 'field'
  /** Permanent effect applied from the gate. */
  | 'passive'
  /** Its conditions can never hold on this course / for this runner. */
  | 'never';

export type AccelVerdict =
  /** Fires at (or within a few metres of) the final-leg speed jump: full value. */
  | 'perfect'
  /** Fires close enough to the jump to keep most of its value. */
  | 'near-perfect'
  /** Fires after the jump; only part of the acceleration is left to help. */
  | 'delayed'
  /** Fires before the final leg; only the tail of the effect reaches the jump. */
  | 'early-partial'
  /** Fires at a random point or depends on the field; some runs land well, most do not (see usefulShare). */
  | 'lottery'
  /** The acceleration effect belongs to an alternative that cannot trigger here; only other effects fire. */
  | 'accel-not-applicable'
  /** Never fires here, or fires where acceleration is worthless. */
  | 'does-not-work';

export type SpeedTier = 'S' | 'A' | 'B' | 'C' | 'D';

export interface ActivationStats {
  /** Share of samples in which the skill fired. */
  rate: number;
  meanStart: number;
  minStart: number;
  maxStart: number;
  meanEnd: number;
  /** Sampled activation positions (for the course diagram). */
  starts: number[];
}

export interface TimingStats {
  /** 2/3 of the distance: where the final-leg speed jump happens. */
  phase2Start: number;
  /** Mean activation position minus the 2/3 mark; null when it never fired. */
  offsetFromPhase2: number | null;
  /** Share of fired runs whose effect window still covers the final-leg or spurt transition. */
  carryoverShare: number;
  /** Share of fired runs that started while the runner was still accelerating towards its final-leg speed. */
  shadowShare: number;
  /** Share of fired runs whose effect was cut short by the finish line. */
  cutByFinishShare: number;
  /** Share of runs (with the skill) that could afford a full spurt. */
  fullSpurtRate: number;
  /** Mean HP difference at the finish caused by the skill (positive = costs HP). */
  hpCost: number;
}

export interface AccelAssessment {
  /** Lengths the same effect would be worth if it fired exactly at the 2/3 mark. */
  referenceGain: number;
  /** gain.mean / referenceGain. */
  ratio: number;
  /** Share of fired runs that gained at least half of the reference. */
  usefulShare: number;
  verdict: AccelVerdict;
  explanation: string;
}

export interface SpeedAssessment {
  tier: SpeedTier;
  explanation: string;
}

export interface SkillAnalysis {
  skillId: number;
  samples: number;
  gain: Summary;
  reliability: Reliability;
  /** Static activation region (first start, last end) or null when it never fires. */
  region: { start: number; end: number } | null;
  activation: ActivationStats | null;
  timing: TimingStats;
  accel: AccelAssessment | null;
  speed: SpeedAssessment | null;
  /** Something the analysis could not model (error text), or null. */
  error: string | null;
}

export interface AnalysisContext {
  setup: RaceSetup;
  runner: RunnerStats;
  options: SimulationOptions;
  seed: [number, number];
  course: CourseData;
  horse: HorseDesc;
  racedef: RaceDefinition;
  phase2: number;
  /** Reference accel gains keyed by effect signature. */
  referenceCache: Map<string, number>;
}

export const DEFAULT_SIMULATION_OPTIONS: SimulationOptions = {
  usePosKeep: true,
  useCompeteTop: true,
  useIntChecks: false,
};

export const DEFAULT_SEED: [number, number] = [2615953739, 0];

export function createAnalysisContext(
  setup: RaceSetup,
  runner: RunnerStats,
  options: SimulationOptions = DEFAULT_SIMULATION_OPTIONS,
  seed: [number, number] = DEFAULT_SEED,
): AnalysisContext {
  return {
    setup,
    runner,
    options,
    seed,
    course: toEngineCourse(setup.course),
    horse: toHorseDesc(runner),
    racedef: toRaceDefinition(setup, runner),
    phase2: phaseStart(setup.course.distance, 2),
    referenceCache: new Map(),
  };
}

const parser = getParser();

/** Static view of where a skill can fire, straight from the condition parser. */
export function staticSkillData(ctx: AnalysisContext, skill: Skill): SkillData[] {
  const horse = buildBaseStats(ctx.horse, ctx.racedef.mood);
  const wholeCourse = new RegionList();
  wholeCourse.push(new Region(0, ctx.course.distance));
  try {
    return buildSkillData(horse, horse, ctx.racedef, ctx.course, wholeCourse, parser, String(skill.id), Perspective.Self, 1);
  } catch {
    return [];
  }
}

export function reliabilityOf(skill: Skill, data: SkillData[]): Reliability {
  if (!data.length) return 'never';
  const first = data[0];
  if (!first.regions.length || first.regions[0].start >= 9999) return 'never';
  if (skill.isPassive) return 'passive';
  const p = first.samplePolicy;
  if (p === ImmediatePolicy) return 'immediate';
  if (p === RandomPolicy || p === StraightRandomPolicy || p === AllCornerRandomPolicy) return 'random';
  if (p instanceof DistributionRandomPolicy) return 'field';
  return 'immediate';
}

function regionOf(data: SkillData[]): { start: number; end: number } | null {
  const regions = data.flatMap((d) => Array.from(d.regions));
  if (!regions.length || regions[0].start >= 9999) return null;
  return { start: Math.min(...regions.map((r) => r.start)), end: Math.max(...regions.map((r) => r.end)) };
}

function hasAccelEffect(data: SkillData[]): boolean {
  return data.some((d) => d.effects.some((e) => e.type === SkillType.Accel && e.modifier > 0 && isTarget(Perspective.Self, e.target)));
}

function effectSignature(data: SkillData): string {
  return data.effects
    .filter((e) => e.type !== SkillType.Noop)
    .map((e) => `${e.type}:${e.modifier.toFixed(4)}:${e.baseDuration.toFixed(3)}`)
    .join(',');
}

/**
 * Lengths the skill's own effects are worth when they fire exactly at the 2/3
 * mark - the yardstick every acceleration skill is measured against.
 */
export function referenceGain(ctx: AnalysisContext, data: SkillData, samples = 24): number {
  const key = effectSignature(data);
  const cached = ctx.referenceCache.get(key);
  if (cached != null) return cached;
  const synthetic: SyntheticSkill = {
    id: 'reference',
    position: ctx.phase2,
    effects: data.effects
      .filter((e) => e.type !== SkillType.Noop)
      .map((e) => ({ type: e.type, modifier: e.modifier, baseDurationSeconds: e.baseDuration })),
  };
  const res = runComparison(
    samples,
    ctx.course,
    ctx.racedef,
    { horse: ctx.horse, skills: [] },
    { horse: ctx.horse, skills: [], synthetic: [synthetic] },
    ctx.seed,
    ctx.options,
  );
  const gain = Math.max(0, summarize(res.results).mean);
  ctx.referenceCache.set(key, gain);
  return gain;
}

function activationStats(records: ActivationRecord[], id: string): ActivationStats | null {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const rec of records) {
    const list = rec.get(id);
    if (!list || !list.length) continue;
    starts.push(list[0][0]);
    ends.push(list[0][1] < 0 ? list[0][0] : list[0][1]);
  }
  if (!starts.length) return null;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return {
    rate: starts.length / records.length,
    meanStart: mean(starts),
    minStart: Math.min(...starts),
    maxStart: Math.max(...starts),
    meanEnd: mean(ends),
    starts,
  };
}

function timingStats(ctx: AnalysisContext, res: ComparisonResult, id: string): TimingStats {
  const distance = ctx.course.distance;
  const p2 = ctx.phase2;
  let fired = 0;
  let carry = 0;
  let shadow = 0;
  let cut = 0;
  for (let i = 0; i < res.results.length; i += 1) {
    const rec = res.activations[1][i].get(id);
    if (!rec || !rec.length) continue;
    fired += 1;
    const [start, rawEnd] = rec[0];
    const end = rawEnd < 0 ? distance : rawEnd;
    const withSkill: RunProfile = res.profiles[1][i];
    const baseline: RunProfile = res.profiles[0][i];
    const transition = withSkill.spurtTransition >= 0 ? Math.max(p2, withSkill.spurtTransition) : p2;
    if (start < transition && end >= transition) carry += 1;
    const reach = baseline.reachTargetPos >= 0 ? baseline.reachTargetPos : distance;
    if (start >= p2 && start <= reach) shadow += 1;
    if (end >= distance - 0.5) cut += 1;
  }
  const n = res.results.length;
  const meanHp = (idx: 0 | 1) => res.profiles[idx].reduce((a, p) => a + p.hpAtFinish, 0) / Math.max(1, res.profiles[idx].length);
  const act = activationStats(res.activations[1], id);
  return {
    phase2Start: p2,
    offsetFromPhase2: act ? act.meanStart - p2 : null,
    carryoverShare: fired ? carry / fired : 0,
    shadowShare: fired ? shadow / fired : 0,
    cutByFinishShare: fired ? cut / fired : 0,
    fullSpurtRate: n ? res.runData.nspurt[1] / n : 0,
    hpCost: meanHp(0) - meanHp(1),
  };
}

const fmt = (m: number) => `${Math.round(Math.abs(m))} m`;

/**
 * Acceleration only helps while the runner is below its target speed, which on a
 * full-spurt build happens right after the 2/3 mark (the final-leg speed jump).
 * The ratio against a reference proc at exactly that point tells how much of the
 * skill's potential survives its real activation position.
 */
export function assessAccel(
  ctx: AnalysisContext,
  reliability: Reliability,
  gain: Summary,
  results: number[],
  activation: ActivationStats | null,
  timing: TimingStats,
  reference: number,
): AccelAssessment {
  const ratio = reference > 0.02 ? Math.min(1.5, gain.mean / reference) : 0;
  const usefulShare = reference > 0.02 && results.length ? results.filter((g) => g >= 0.5 * reference).length / results.length : 0;
  const offset = timing.offsetFromPhase2;
  let verdict: AccelVerdict;
  let explanation: string;

  if (reliability === 'never' || !activation || activation.rate < 0.02) {
    verdict = 'does-not-work';
    explanation = 'Its conditions cannot be met on this course with this runner, so it never fires.';
  } else if (reliability === 'random' || reliability === 'field') {
    const where = reliability === 'field' ? 'when the field allows it' : 'at a random point of its zone';
    const zone = `${fmt(activation.minStart)} to ${fmt(activation.maxStart)}`;
    // A random zone only earns a timing verdict when it is narrow enough to behave
    // like a fixed point; a wide zone is a lottery however good its average is.
    const tight = activation.maxStart - activation.minStart <= 120;
    if (tight && ratio >= 0.85) {
      verdict = 'perfect';
      explanation = `Fires ${where} (${zone}), and that zone sits right on the final-leg speed jump at ${fmt(timing.phase2Start)}: nearly every run gets the full effect.`;
    } else if (tight && ratio >= 0.55) {
      verdict = 'near-perfect';
      explanation = `Fires ${where} (${zone}), close to the speed jump at ${fmt(timing.phase2Start)}; on average ${Math.round(ratio * 100)}% of a perfectly timed proc.`;
    } else if (usefulShare >= 0.15) {
      verdict = 'lottery';
      explanation = `Fires ${where} (${zone}); ${Math.round(usefulShare * 100)}% of runs landed close enough to the speed jump at ${fmt(timing.phase2Start)} to keep at least half of the ${reference.toFixed(2)}-length reference, the rest gained little.`;
    } else {
      verdict = 'does-not-work';
      explanation = `Fires ${where} (${zone}), almost never near the speed jump at ${fmt(timing.phase2Start)}; only ${Math.round(usefulShare * 100)}% of runs got a useful proc.`;
    }
  } else if (ratio >= 0.85) {
    verdict = 'perfect';
    explanation = `Fires ${offset != null && Math.abs(offset) > 1 ? `${fmt(offset)} ${offset > 0 ? 'after' : 'before'}` : 'right at'} the final-leg speed jump at ${fmt(timing.phase2Start)}: the whole effect goes into the acceleration that matters.`;
  } else if (ratio >= 0.55) {
    verdict = 'near-perfect';
    explanation = `Fires ${fmt(offset ?? 0)} ${(offset ?? 0) > 0 ? 'after' : 'before'} the speed jump at ${fmt(timing.phase2Start)}; keeps ${Math.round(ratio * 100)}% of a perfectly timed proc.`;
  } else if (ratio >= 0.15) {
    if ((offset ?? 0) < 0) {
      verdict = 'early-partial';
      explanation = `Fires ${fmt(offset ?? 0)} before the final leg begins; only the tail of the effect overlaps the speed jump (${Math.round(ratio * 100)}% of a perfect proc).`;
    } else {
      verdict = 'delayed';
      explanation = `Fires ${fmt(offset ?? 0)} after the speed jump, when most of the acceleration is already done (${Math.round(ratio * 100)}% of a perfect proc).`;
    }
  } else {
    verdict = 'does-not-work';
    explanation =
      (offset ?? 0) < 0
        ? `Fires ${fmt(offset ?? 0)} before the final leg and has worn off before the speed jump; acceleration while already at cruising speed gains nothing.`
        : `Fires ${fmt(offset ?? 0)} after the speed jump, after the runner has reached its final-leg speed; nothing left to accelerate into.`;
  }
  return { referenceGain: reference, ratio, usefulShare, verdict, explanation };
}

/**
 * Speed skills are worth roughly modifier x duration, more when the effect still
 * runs into the final-leg / spurt transition (carryover), much less when they
 * fire while the runner is already accelerating (shadowed), and nothing past the
 * finish line.
 */
export function assessSpeed(
  reliability: Reliability,
  gain: Summary,
  activation: ActivationStats | null,
  timing: TimingStats,
): SpeedAssessment {
  let tier: SpeedTier;
  if (gain.mean >= 1.5) tier = 'S';
  else if (gain.mean >= 1.0) tier = 'A';
  else if (gain.mean >= 0.5) tier = 'B';
  else if (gain.mean >= 0.15) tier = 'C';
  else tier = 'D';

  const parts: string[] = [];
  if (reliability === 'never' || !activation) {
    parts.push('Never fires here.');
  } else {
    parts.push(
      reliability === 'immediate'
        ? `Fires at ${fmt(activation.meanStart)}.`
        : `Fires ${reliability === 'field' ? 'when the field allows' : 'randomly'} between ${fmt(activation.minStart)} and ${fmt(activation.maxStart)}.`,
    );
    if (timing.carryoverShare > 0) parts.push(`${Math.round(timing.carryoverShare * 100)}% of runs carry the speed into the final-leg acceleration.`);
    if (timing.shadowShare > 0.5) parts.push('Mostly fires while still accelerating to final-leg speed, so much of the boost is shadowed.');
    if (timing.cutByFinishShare > 0.3) parts.push(`${Math.round(timing.cutByFinishShare * 100)}% of runs lose part of the effect to the finish line.`);
    if (timing.hpCost > 5) parts.push(`Costs about ${Math.round(timing.hpCost)} HP.`);
    if (reliability === 'field') parts.push('Needs other runners (passing, being blocked, a rival nearby); the activation point is drawn from a probability distribution, as umalator does.');
  }
  return { tier, explanation: parts.join(' ') };
}

export function analyzeSkill(ctx: AnalysisContext, skill: Skill, samples: number): SkillAnalysis {
  const id = String(skill.id);
  const data = staticSkillData(ctx, skill);
  const reliability = reliabilityOf(skill, data);
  const region = regionOf(data);
  const emptyTiming: TimingStats = {
    phase2Start: ctx.phase2,
    offsetFromPhase2: null,
    carryoverShare: 0,
    shadowShare: 0,
    cutByFinishShare: 0,
    fullSpurtRate: 0,
    hpCost: 0,
  };
  const wantsAccel = hasAccelEffect(data) || skillHasAccel(skill);
  const wantsSpeed = skillHasSpeed(skill);

  if (reliability === 'never') {
    return {
      skillId: skill.id,
      samples: 0,
      gain: summarize([]),
      reliability,
      region,
      activation: null,
      timing: emptyTiming,
      accel: wantsAccel ? assessAccel(ctx, reliability, summarize([]), [], null, emptyTiming, 0) : null,
      speed: wantsSpeed ? assessSpeed(reliability, summarize([]), null, emptyTiming) : null,
      error: null,
    };
  }

  let res: ComparisonResult;
  try {
    res = runComparison(
      samples,
      ctx.course,
      ctx.racedef,
      { horse: ctx.horse, skills: [] },
      { horse: ctx.horse, skills: [{ id }] },
      ctx.seed,
      ctx.options,
    );
  } catch (e) {
    return {
      skillId: skill.id,
      samples: 0,
      gain: summarize([]),
      reliability,
      region,
      activation: null,
      timing: emptyTiming,
      accel: null,
      speed: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const gain = summarize(res.results);
  const activation = activationStats(res.activations[1], id);
  const timing = timingStats(ctx, res, id);
  let accel: AccelAssessment | null = null;
  if (wantsAccel && data.length) {
    if (hasAccelEffect([data[0]])) {
      accel = assessAccel(ctx, reliability, gain, res.results, activation, timing, referenceGain(ctx, data[0]));
    } else {
      accel = {
        referenceGain: 0,
        ratio: 0,
        usefulShare: 0,
        verdict: 'accel-not-applicable',
        explanation: 'The acceleration effect belongs to a variant of this skill whose conditions never hold here; only its other effects can fire on this course.',
      };
    }
  }
  const speed = wantsSpeed ? assessSpeed(reliability, gain, activation, timing) : null;
  return { skillId: skill.id, samples, gain, reliability, region, activation, timing, accel, speed, error: null };
}
