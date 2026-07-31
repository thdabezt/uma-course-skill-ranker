/**
 * Evaluates one skill on one course + running style, using **paired simulation**.
 *
 * For every activation position the runner is simulated twice with the *same seed*:
 * once without the skill and once with it. Common random numbers mean both runs
 * share the start delay, the per-section Wit variance and the last-spurt planning
 * rolls, so the difference between them is the skill's contribution rather than
 * noise. Each pair is repeated `EVALUATION.monteCarloRuns` times with different
 * seeds and the results are averaged.
 *
 * Horse lengths come from `src/simulation/horseLength.ts`: the two runs are
 * compared at the same elapsed time and the position gap is divided by 2.5 m.
 * Everything is reproducible from `EVALUATION.seed`.
 */

import {
  EFFICIENCY_SP_BASIS,
  EVALUATION,
  RUNNING_STYLE_LABELS,
  SAMPLING,
  SIMULATION,
} from '@/simulation/config';
import { sectionLength } from '@/courses/sections';
import { HORSE_LENGTH_METHOD, METRES_PER_HORSE_LENGTH, compareFinish } from '@/simulation/horseLength';
import { seedFor, summarize } from '@/simulation/random';
import { getOpponentField, type OpponentField } from '@/simulation/opponents';
import { positionAtTime, simulateRace } from '@/simulation/simulator';
import { RACE_FIELD } from '@/simulation/config';
import type { ValueConfidence } from '@/skills/activationModel';
import type {
  ConditionContext,
  RaceSetup,
  RunnerStats,
  ScheduledEffect,
  Section,
  SimulationResult,
  Skill,
  SkillConditionGroup,
} from '@/simulation/types';
import { analyseConditionGroup, type ActivationAnalysis } from '@/skills/activation';
import { durationSeconds, hasModelledEffect, unmodelledKinds } from '@/skills/effects';

export interface SamplingResult {
  count: number;
  mean: number;
  standardDeviation: number;
  standardError: number;
  confidenceLevel: 0.95;
  confidenceIntervalLower: number;
  confidenceIntervalUpper: number;
  stoppedBecause: 'deterministic' | 'precision_reached' | 'maximum_samples';
}

export interface SampleBreakdown {
  activationMeters: number;
  baselineFinishTimeSeconds: number;
  skillFinishTimeSeconds: number;
  timeSavedSeconds: number;
  finishSpeed: number;
  metersGained: number;
  horseLengths: number;
  effectiveDurationSeconds: number;
  wastedDurationSeconds: number;
  hpRemainingFraction: number;
  spurtStartMeters: number | null;
  seed: number;
  runs: number;
  stdDev: number;
  ci95: [number, number];
  /** Runs in which the trigger predicate actually fired. */
  activations: number;
  sampling: SamplingResult;
}

export interface GroupEvaluation {
  /** Declaration index. Lower wins: the game places the first eligible trigger. */
  priority: number;
  selected: boolean;
  /** Why this alternative was not the one used. */
  rejectionReason: string | null;
  condition: string;
  precondition: string | null;
  durationSeconds: number;
  activation: ActivationAnalysis;
  samples: SampleBreakdown[];
  best: SampleBreakdown | null;
  worst: SampleBreakdown | null;
  averageHorseLengths: number;
  expectedHorseLengths: number;
  usefulDurationRatio: number;
  wastedDurationRatio: number;
  /** Total paired simulations behind this group. */
  totalRuns: number;
  stdDev: number;
  ci95: [number, number];
  /** Paired runs in which the skill actually activated. */
  activations: number;
  eligibleRuns: number;
  sampling: SamplingResult | null;
}

export interface SkillEvaluation {
  skillId: number;
  canActivate: boolean;
  explanations: string[];
  isEstimate: boolean;
  notModelledEffects: string[];

  /** Value the skill is worth ON THE RUNS WHERE IT FIRED. */
  activatedBashin: number;
  activationProbability: number;
  /** activatedBashin * activationProbability. This is what the ranking sorts by. */
  expectedBashin: number;
  minActivatedBashin: number;
  maxActivatedBashin: number;
  sampleCount: number;
  standardDeviation?: number;
  confidenceInterval?: { lower: number; upper: number };
  valueConfidence: ValueConfidence;

  /** Back-compatible aliases used across the UI and tests. */
  expectedHorseLengths: number;
  minHorseLengths: number;
  maxHorseLengths: number;
  averageHorseLengths: number;

  totalCost: number | null;
  efficiency: number | null;

  wastedDurationRatio: number;
  usefulDurationRatio: number;

  baselineFinishTimeSeconds: number;
  bestFinishTimeSeconds: number | null;

  /** Developer debug block. */
  debug: {
    horseLengthMethod: string;
    metresPerHorseLength: number;
    seed: number;
    runsPerSample: number;
    totalRuns: number;
    stdDev: number;
    ci95: [number, number];
    baselineHpRemaining: number;
    baselineSpurtStart: number | null;
    baselineFullSpurt: boolean;
    procRateApplied: boolean;
    activationModel: string;
    /** Declaration index of the alternative that fired, or -1 when none did. */
    selectedAlternative: number;
    alternativeCount: number;
    rejectedAlternatives: { priority: number; reason: string }[];
    activations: number;
    eligibleRuns: number;
    opponentsSimulated: number;
    sampling: SamplingResult | null;
  };

  groups: GroupEvaluation[];
}

export interface BaselineContext {
  setup: RaceSetup;
  runner: RunnerStats;
  /** Representative baseline (first seed), used for display. */
  baseline: SimulationResult;
  /** Baselines keyed by run index, shared by every skill on this course. */
  baselines: SimulationResult[];
  seeds: number[];
  /** One opponent field per run index, shared by every skill on this course. */
  fields: OpponentField[];
  /** Baselines are created lazily beyond the first few, so counters stay honest. */
  stats: { baselineRuns: number; baselineReuses: number };
}

const seedForRun = (i: number) => seedFor(EVALUATION.seed, `run:${i}`);

/**
 * Baseline runs and the opponent field are computed once per
 * (course, conditions, runner) and reused by every skill.
 */
export function createBaseline(setup: RaceSetup, runner: RunnerStats): BaselineContext {
  const seeds: number[] = [];
  const baselines: SimulationResult[] = [];
  const fields: OpponentField[] = [];
  const useOpponents = RACE_FIELD.opponentSimulationEnabled;

  for (let i = 0; i < EVALUATION.monteCarloRuns; i += 1) {
    const seed = seedForRun(i);
    seeds.push(seed);
    const field = useOpponents ? getOpponentField(setup, runner, seed) : null;
    if (field) fields.push(field);
    baselines.push(
      simulateRace(setup, runner, [], {
        seed,
        recordTrace: true,
        opponentPositionsAtFrame: field ? field.positionsAtFrame : undefined,
      }),
    );
  }
  return {
    setup,
    runner,
    baseline: baselines[0],
    baselines,
    seeds,
    fields,
    stats: { baselineRuns: EVALUATION.monteCarloRuns, baselineReuses: 0 },
  };
}

/** Extends the shared baseline pool on demand, for adaptive sampling. */
function ensureRun(ctx: BaselineContext, index: number): { seed: number; baseline: SimulationResult } {
  while (ctx.seeds.length <= index) {
    const i = ctx.seeds.length;
    const seed = seedForRun(i);
    ctx.seeds.push(seed);
    const field = RACE_FIELD.opponentSimulationEnabled
      ? getOpponentField(ctx.setup, ctx.runner, seed)
      : null;
    if (field) ctx.fields.push(field);
    ctx.baselines.push(
      simulateRace(ctx.setup, ctx.runner, [], {
        seed,
        recordTrace: true,
        opponentPositionsAtFrame: field ? field.positionsAtFrame : undefined,
      }),
    );
    ctx.stats.baselineRuns += 1;
  }
  ctx.stats.baselineReuses += 1;
  return { seed: ctx.seeds[index], baseline: ctx.baselines[index] };
}

/** Evenly spaced sample positions inside a set of windows. */
export function sampleActivationPoints(windows: Section[], random: boolean): number[] {
  if (!windows.length) return [];
  if (!random) return windows.map((w) => w.start);
  const total = windows.reduce((a, w) => a + sectionLength(w), 0);
  if (total <= SAMPLING.minWindowMeters) return windows.map((w) => w.start + sectionLength(w) / 2);
  const points: number[] = [];
  for (const w of windows) {
    const share = sectionLength(w) / total;
    const n = Math.max(1, Math.round(SAMPLING.samplesPerWindow * share));
    for (let i = 0; i < n; i += 1) points.push(w.start + (sectionLength(w) * (i + 0.5)) / n);
  }
  return points.slice(0, SAMPLING.maxSamplesPerSkill);
}

/** One activation position (or one event trigger), sampled adaptively. */
function evaluateAtPosition(
  ctx: BaselineContext,
  skill: Skill,
  group: SkillConditionGroup,
  meters: number,
  duration: number,
  activation: ActivationAnalysis,
): SampleBreakdown {
  const { setup, runner } = ctx;
  const lengths: number[] = [];
  let timeSaved = 0;
  let skillFinish = 0;
  let finishSpeed = 0;
  let effective = 0;
  let wasted = 0;
  let hpRemaining = 0;
  let spurtStart: number | null = null;
  let activations = 0;
  let activationMetersSum = 0;

  // Event-driven skills need many more paired runs, because whether the event
  // happens at all varies from race to race. Position-sampled skills converge fast.
  const eventDriven = activation.eventTerms.length + activation.preconditionEventTerms.length > 0;
  const minRuns = eventDriven ? EVALUATION.eventMinRuns : EVALUATION.minRuns;
  const maxRuns = eventDriven
    ? Math.min(EVALUATION.maxRuns, EVALUATION.scenarioCount)
    : EVALUATION.monteCarloRuns;

  const windows = activation.windows;
  const windowEnd = windows.length ? Math.max(...windows.map((w) => w.end)) : setup.course.distance;
  // When the clause also has a genuine random-region term, the game picks the point
  // first and only then tests the event, so the trigger window opens at the sampled
  // position. Otherwise it opens at the start of the eligible region.
  const windowStart = activation.randomWithinWindow
    ? meters
    : windows.length
      ? Math.min(...windows.map((w) => w.start))
      : 0;

  const inWindow = (pos: number) => windows.some((w) => pos >= w.start && pos < w.end);

  /**
   * Fresh predicate per run. Precondition terms LATCH: a precondition only has to
   * have been satisfied at some earlier moment, not at the instant the skill fires.
   */
  const makePredicate = (): ((c: ConditionContext) => boolean) | undefined => {
    if (!eventDriven) return undefined;
    const latched = activation.preconditionEventTerms.map(() => false);
    return (c: ConditionContext) => {
      for (let i = 0; i < activation.preconditionEventTerms.length; i += 1) {
        if (!latched[i] && activation.preconditionEventTerms[i].predicate(c)) latched[i] = true;
      }
      if (!latched.every(Boolean)) return false;
      if (!inWindow(c.position)) return false;
      return activation.eventTerms.every((t) => t.predicate(c));
    };
  };

  let stoppedBecause: SamplingResult['stoppedBecause'] = 'deterministic';
  let used = 0;

  for (let i = 0; i < maxRuns; i += 1) {
    const { seed, baseline } = ensureRun(ctx, i);
    const field = ctx.fields[i];
    const runPredicate = makePredicate();

    const planned: ScheduledEffect[] = [
      {
        skillId: skill.id,
        activateAtMeters: duration === Infinity ? 0 : meters,
        durationSeconds: duration,
        effects: group.effects,
        ...(runPredicate ? { trigger: { windowStart, windowEnd, predicate: runPredicate } } : {}),
      },
    ];

    const withSkill = simulateRace(setup, runner, planned, {
      seed,
      recordTrace: true,
      forceSkillActivation: true,
      opponentPositionsAtFrame: field ? field.positionsAtFrame : undefined,
    });

    const firedAt = withSkill.activationPositions[skill.id];
    const fired = firedAt !== undefined;
    if (fired) {
      activations += 1;
      activationMetersSum += firedAt;
    }

    // Only runs where the skill actually fired contribute to the ACTIVATED value.
    // Runs where the event never happened feed the activation probability instead.
    if (fired || !eventDriven) {
      const cmp = compareFinish({
        baselineFinishTime: baseline.finishTimeSeconds,
        baselinePositionAtTime: (t) => positionAtTime(baseline, t),
        skillFinishTime: withSkill.finishTimeSeconds,
        skillPositionAtTime: (t) => positionAtTime(withSkill, t),
        courseDistance: setup.course.distance,
      });
      lengths.push(cmp.horseLengths);
      timeSaved += baseline.finishTimeSeconds - withSkill.finishTimeSeconds;
      skillFinish += withSkill.finishTimeSeconds;
      finishSpeed += withSkill.finishSpeed;
      effective += withSkill.effectiveDurationSeconds[skill.id] ?? 0;
      wasted += withSkill.wastedDurationSeconds[skill.id] ?? 0;
      hpRemaining += withSkill.hpRemainingFraction;
      if (spurtStart === null) spurtStart = withSkill.spurtStartMeters;
    }
    used += 1;

    if (used < minRuns) continue;

    const stats = summarize(lengths);
    const halfWidth = lengths.length > 1 ? (1.96 * stats.stdDev) / Math.sqrt(lengths.length) : 0;
    const target = Math.max(
      EVALUATION.precisionAbsoluteTarget,
      Math.abs(stats.mean) * EVALUATION.precisionRelativeTarget,
    );
    if (halfWidth <= target) {
      stoppedBecause = lengths.length > 1 && stats.stdDev > 0 ? 'precision_reached' : 'deterministic';
      break;
    }
    if (used >= maxRuns) stoppedBecause = 'maximum_samples';
  }

  const measured = Math.max(1, lengths.length);
  const stats = summarize(lengths);
  return {
    activationMeters: activations > 0 ? Math.round(activationMetersSum / activations) : Math.round(meters),
    baselineFinishTimeSeconds:
      ctx.baselines.slice(0, used).reduce((a, b) => a + b.finishTimeSeconds, 0) / Math.max(1, used),
    skillFinishTimeSeconds: skillFinish / measured,
    timeSavedSeconds: timeSaved / measured,
    finishSpeed: finishSpeed / measured,
    metersGained: stats.mean * METRES_PER_HORSE_LENGTH,
    horseLengths: stats.mean,
    effectiveDurationSeconds: effective / measured,
    wastedDurationSeconds: wasted / measured,
    hpRemainingFraction: hpRemaining / measured,
    spurtStartMeters: spurtStart,
    seed: ctx.seeds[0],
    runs: used,
    activations,
    stdDev: stats.stdDev,
    ci95: stats.ci95,
    sampling: {
      count: lengths.length,
      mean: stats.mean,
      standardDeviation: stats.stdDev,
      standardError: lengths.length > 1 ? stats.stdDev / Math.sqrt(lengths.length) : 0,
      confidenceLevel: 0.95,
      confidenceIntervalLower: stats.ci95[0],
      confidenceIntervalUpper: stats.ci95[1],
      stoppedBecause,
    },
  } as SampleBreakdown & { sampling: SamplingResult };
}

function evaluateGroup(
  ctx: BaselineContext,
  skill: Skill,
  group: SkillConditionGroup,
  priority: number,
): GroupEvaluation {
  const { setup, runner } = ctx;
  const activation = analyseConditionGroup(group.condition, group.precondition, setup, runner);
  const duration = durationSeconds(group, setup.course.distance);

  const empty: GroupEvaluation = {
    priority,
    selected: false,
    rejectionReason: null,
    condition: group.condition,
    precondition: group.precondition,
    durationSeconds: duration,
    activation,
    samples: [],
    best: null,
    worst: null,
    averageHorseLengths: 0,
    expectedHorseLengths: 0,
    usefulDurationRatio: 0,
    wastedDurationRatio: 0,
    totalRuns: 0,
    stdDev: 0,
    ci95: [0, 0],
    activations: 0,
    eligibleRuns: 0,
    sampling: null,
  };

  if (!activation.possible || !hasModelledEffect(group.effects)) return empty;

  const points = sampleActivationPoints(activation.windows, activation.randomWithinWindow);
  if (!points.length) return empty;

  const samples = points.map((m) => evaluateAtPosition(ctx, skill, group, m, duration, activation));
  const sorted = samples.slice().sort((a, b) => a.horseLengths - b.horseLengths);
  const across = summarize(samples.map((s) => s.horseLengths));

  const totalDuration = samples.reduce((a, s) => a + s.effectiveDurationSeconds + s.wastedDurationSeconds, 0);
  const totalWasted = samples.reduce((a, s) => a + s.wastedDurationSeconds, 0);
  const wastedRatio = totalDuration > 0 ? totalWasted / totalDuration : 0;

  return {
    priority,
    selected: false,
    rejectionReason: null,
    condition: group.condition,
    precondition: group.precondition,
    durationSeconds: duration,
    activation,
    samples,
    best: sorted[sorted.length - 1],
    worst: sorted[0],
    averageHorseLengths: across.mean,
    expectedHorseLengths:
      across.mean *
      (activation.eventTerms.length + activation.preconditionEventTerms.length > 0
        ? // Measured: how often the event actually happened across paired races.
          samples.reduce((a, s) => a + s.activations, 0) /
          Math.max(1, samples.reduce((a, s) => a + s.runs, 0))
        : activation.probability),
    usefulDurationRatio: 1 - wastedRatio,
    wastedDurationRatio: wastedRatio,
    totalRuns: samples.reduce((a, s) => a + s.runs, 0),
    stdDev: across.stdDev,
    ci95: across.ci95,
    activations: samples.reduce((a, s) => a + s.activations, 0),
    eligibleRuns: samples.reduce((a, s) => a + s.runs, 0),
    sampling: samples[0]?.sampling ?? null,
  };
}

export function evaluateSkill(ctx: BaselineContext, skill: Skill): SkillEvaluation {
  const { runner, baseline } = ctx;
  const groups = skill.conditionGroups.map((g, i) => evaluateGroup(ctx, skill, g, i));
  const usable = groups.filter((g) => g.activation.possible && g.samples.length > 0);
  const notModelled = [...new Set(skill.conditionGroups.flatMap((g) => unmodelledKinds(g.effects)))];

  const debugBase = {
    horseLengthMethod: HORSE_LENGTH_METHOD,
    metresPerHorseLength: METRES_PER_HORSE_LENGTH,
    seed: EVALUATION.seed,
    runsPerSample: EVALUATION.monteCarloRuns,
    baselineHpRemaining: baseline.hpRemainingFraction,
    baselineSpurtStart: baseline.spurtStartMeters,
    baselineFullSpurt: baseline.fullSpurt,
    procRateApplied: runner.skillActivationRate !== 1,
    opponentsSimulated: ctx.fields[0]?.opponents.length ?? 0,
  };

  const explanations: string[] = [];

  if (!usable.length) {
    const blockers = [...new Set(groups.flatMap((g) => g.activation.blockers))];
    if (blockers.length) {
      explanations.push(...blockers);
    } else if (!skill.conditionGroups.some((g) => hasModelledEffect(g.effects))) {
      explanations.push(
        `This skill only has effects the solo simulation cannot measure (${notModelled.join(', ')}). ` +
          'Its value depends on the rest of the field.',
      );
    } else {
      explanations.push('No valid activation point exists on this course.');
    }
    return {
      skillId: skill.id,
      canActivate: false,
      explanations,
      isEstimate: groups.some((g) => g.activation.isEstimate),
      notModelledEffects: notModelled,
      activatedBashin: 0,
      activationProbability: 0,
      expectedBashin: 0,
      minActivatedBashin: 0,
      maxActivatedBashin: 0,
      sampleCount: 0,
      valueConfidence: groups.some((g) => g.activation.model === 'unsupported')
        ? 'unsupported'
        : 'deterministic',
      expectedHorseLengths: 0,
      minHorseLengths: 0,
      maxHorseLengths: 0,
      averageHorseLengths: 0,
      totalCost: skill.totalCost,
      efficiency: null,
      wastedDurationRatio: 0,
      usefulDurationRatio: 0,
      baselineFinishTimeSeconds: baseline.finishTimeSeconds,
      bestFinishTimeSeconds: null,
      debug: {
        ...debugBase,
        totalRuns: 0,
        stdDev: 0,
        ci95: [0, 0],
        activationModel: groups[0]?.activation.model ?? 'unsupported',
      selectedAlternative: -1,
      alternativeCount: groups.length,
      rejectedAlternatives: groups.map((g, i) => ({
        priority: i,
        reason: g.activation.blockers[0] ?? 'not eligible on this course',
      })),
        activations: 0,
        eligibleRuns: 0,
        sampling: null,
      },
      groups,
    };
  }

  // Alternative selection, matching the Global reference: the alternatives are
  // walked in DECLARATION ORDER and the FIRST one whose precondition and condition
  // are both satisfiable on this course places the trigger. A stronger later branch
  // is never preferred just because it is stronger, and branches are never summed.
  const primary = usable.reduce((a, b) => (b.priority < a.priority ? b : a));
  primary.selected = true;
  for (const g of groups) {
    if (g === primary) continue;
    if (!g.activation.possible) {
      g.rejectionReason =
        g.activation.blockers[0] ?? 'condition cannot be satisfied anywhere on this course';
    } else if (g.samples.length === 0) {
      g.rejectionReason = 'no measurable effect on this course';
    } else if (g.priority > primary.priority) {
      g.rejectionReason = `alternative ${primary.priority + 1} is declared earlier and is eligible here`;
    } else {
      g.rejectionReason = 'not selected';
    }
  }

  // Activated value and activation probability are kept apart.
  //   expectedBashin = activatedBashin * activationProbability
  const eventDriven =
    primary.activation.eventTerms.length + primary.activation.preconditionEventTerms.length > 0;
  const measuredProbability = eventDriven
    ? primary.activations / Math.max(1, primary.eligibleRuns)
    : primary.activation.probability;
  const activatedBashin = primary.averageHorseLengths;
  const expected = activatedBashin * measuredProbability;

  const valueConfidence: ValueConfidence = eventDriven
    ? 'simulated'
    : primary.activation.model === 'unsupported'
      ? 'unsupported'
      : primary.activation.isEstimate
        ? 'estimated'
        : 'deterministic';
  const efficiency =
    skill.totalCost && skill.totalCost > 0 ? (expected * EFFICIENCY_SP_BASIS) / skill.totalCost : null;

  const styleLabel = RUNNING_STYLE_LABELS[runner.runningStyle];

  if (measuredProbability >= 0.999) {
    explanations.push('Activation is guaranteed on this course and running style.');
  } else if (eventDriven) {
    explanations.push(
      `Activated in ${primary.activations} of ${primary.eligibleRuns} simulated races ` +
        `(${(measuredProbability * 100).toFixed(0)}%) against a field of ${debugBase.opponentsSimulated} opponents.`,
    );
    explanations.push(
      `Worth ${activatedBashin.toFixed(2)} lengths when it does fire, so the expected value is ${expected.toFixed(2)}.`,
    );
  } else {
    explanations.push(
      `Estimated activation probability ${(measuredProbability * 100).toFixed(0)}% for a ${styleLabel}.`,
    );
  }

  if (primary.activation.randomWithinWindow) {
    const span = primary.activation.windows.reduce((a, w) => a + sectionLength(w), 0);
    explanations.push(
      `Fires at a random point across ${Math.round(span)} m, so the result varies between ` +
        `${primary.worst?.horseLengths.toFixed(2)} and ${primary.best?.horseLengths.toFixed(2)} lengths.`,
    );
  }

  if (primary.wastedDurationRatio > 0.01) {
    explanations.push(
      `${(primary.wastedDurationRatio * 100).toFixed(0)}% of the effect duration is cut off by the finish line.`,
    );
  }

  if (primary.durationSeconds === Infinity) {
    explanations.push('Passive effect: applies from the gate for the whole race.');
  }

  const clampedDrain = skill.conditionGroups.some((g) =>
    g.effects.some(
      (e) =>
        e.kind === 'stamina_recovery' &&
        e.rawValue / SIMULATION.recoveryValueScale < -SIMULATION.staminaDrainClampFraction,
    ),
  );
  if (clampedDrain) {
    explanations.push(
      `This skill stores an extreme stamina penalty (${(SIMULATION.staminaDrainClampFraction * 100).toFixed(0)}% cap applied). ` +
        'The in-game text says the fatigue only happens sometimes, so treat the result as an estimate.',
    );
  }

  if (notModelled.length) {
    explanations.push(
      `Part of this skill (${notModelled.join(', ')}) needs opponents to matter and is not included in the number.`,
    );
  }

  if (Math.abs(expected) <= 0.005) {
    const onlyTargetSpeed =
      skill.effectKinds.length > 0 && skill.effectKinds.every((k) => k === 'target_speed');
    const spurtStart = baseline.spurtStartMeters;
    if (onlyTargetSpeed && spurtStart != null && primary.best) {
      explanations.push(
        'Measured gain is essentially zero: the skill fires while the runner is still ' +
          `accelerating into its last spurt (from ${Math.round(spurtStart)} m), and it expires before the ` +
          'runner catches its target speed. A target-speed bonus only pays once the runner is actually ' +
          'held at its target, so raising the ceiling earlier buys nothing.',
      );
    } else if (skill.effectKinds.includes('stamina_recovery') && baseline.fullSpurt) {
      explanations.push(
        'Measured gain is essentially zero: this build already completes a full-speed last spurt on this ' +
          'course, so recovering more stamina cannot buy any extra speed. Lower the Stamina stat to see ' +
          'what this skill is worth to a leaner build.',
      );
    } else {
      explanations.push(
        "Measured gain is essentially zero here - the effect lands where it cannot change the runner speed.",
      );
    }
  }

  explanations.push(...primary.activation.notes);

  return {
    skillId: skill.id,
    canActivate: true,
    explanations,
    isEstimate: primary.activation.isEstimate || clampedDrain,
    notModelledEffects: notModelled,
    activatedBashin,
    activationProbability: measuredProbability,
    expectedBashin: expected,
    minActivatedBashin: primary.worst?.horseLengths ?? 0,
    maxActivatedBashin: primary.best?.horseLengths ?? 0,
    sampleCount: primary.eligibleRuns,
    standardDeviation: primary.stdDev,
    confidenceInterval: { lower: primary.ci95[0], upper: primary.ci95[1] },
    valueConfidence,
    expectedHorseLengths: expected,
    minHorseLengths: primary.worst?.horseLengths ?? 0,
    maxHorseLengths: primary.best?.horseLengths ?? 0,
    averageHorseLengths: primary.averageHorseLengths,
    totalCost: skill.totalCost,
    efficiency,
    wastedDurationRatio: primary.wastedDurationRatio,
    usefulDurationRatio: primary.usefulDurationRatio,
    baselineFinishTimeSeconds: baseline.finishTimeSeconds,
    bestFinishTimeSeconds: primary.best?.skillFinishTimeSeconds ?? null,
    debug: {
      ...debugBase,
      totalRuns: primary.totalRuns,
      stdDev: primary.stdDev,
      ci95: primary.ci95,
      activationModel: primary.activation.model,
      selectedAlternative: primary.priority,
      alternativeCount: groups.length,
      rejectedAlternatives: groups
        .filter((g) => g !== primary)
        .map((g) => ({ priority: g.priority, reason: g.rejectionReason ?? 'not selected' })),
      activations: primary.activations,
      eligibleRuns: primary.eligibleRuns,
      sampling: primary.sampling,
    },
    groups,
  };
}
