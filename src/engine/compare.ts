/**
 * Paired race comparison, ported from umalator's compare.ts (uma-tools, GPL-3.0).
 *
 * Two builds run the same seeded race side by side; the result is the gap, in
 * horse lengths (2.5 m), between them at the moment the faster one finishes.
 * Positive numbers mean the second build finished ahead.
 *
 * On top of umalator's output this version records, per sample and per build,
 * where every skill fired and ended, where the last spurt began and where the
 * runner reached its final-leg target speed - the raw material for the
 * activation-timing analysis.
 */
import type { CourseData } from './vendor/CourseData';
import { CourseHelpers } from './vendor/CourseData';
import { Region, RegionList } from './vendor/Region';
import type { RaceSolver } from './vendor/RaceSolver';
import { Perspective, SkillRarity, SkillTarget, SkillType } from './vendor/RaceSolver';
import { RaceSolverBuilder, type HorseDesc, type SkillData } from './vendor/RaceSolverBuilder';
import type { GameHpPolicy } from './vendor/HpPolicy';
import { Rule30CARng, type PRNG } from './vendor/Random';
import {
  AllCornerRandomPolicy,
  ErlangRandomPolicy,
  ImmediatePolicy,
  LogNormalRandomPolicy,
  RandomPolicy,
  StraightRandomPolicy,
  type ActivationSamplePolicy,
} from './vendor/ActivationSamplePolicy';
import type { RaceDefinition } from './runner';
import { assumedParser } from './requirements';

export const HORSE_LENGTH_METERS = 2.5;
export const FRAME_SECONDS = 1 / 15;

/** Serializable description of a sample policy override (mirrors umalator's SamplePolicyDesc). */
export type SamplePolicyDesc =
  | { policy: 'immediate' }
  | { policy: 'fixed'; pos: number }
  | { policy: 'random' }
  | { policy: 'straight-random' }
  | { policy: 'all-corner-random' }
  | { policy: 'log-normal'; mu: number; sigma: number }
  | { policy: 'erlang'; k: number; lambda: number };

export class FixedDistancePolicy implements ActivationSamplePolicy {
  constructor(readonly pos: number) {}
  sample(_0: RegionList, nsamples: number, _1: PRNG) {
    return Array.from({ length: nsamples }, () => new Region(this.pos, this.pos + 10));
  }
  // Only ever used as an override, never reconciled with another policy.
  reconcile(other: ActivationSamplePolicy) { return other; }
  reconcileImmediate(other: ActivationSamplePolicy) { return other; }
  reconcileDistributionRandom(other: ActivationSamplePolicy) { return other; }
  reconcileRandom(other: ActivationSamplePolicy) { return other; }
  reconcileStraightRandom(other: ActivationSamplePolicy) { return other; }
  reconcileAllCornerRandom(other: ActivationSamplePolicy) { return other; }
}

export function instantiateSamplePolicy(desc: SamplePolicyDesc | undefined): ActivationSamplePolicy | undefined {
  if (desc == null) return undefined;
  switch (desc.policy) {
    case 'immediate': return ImmediatePolicy;
    case 'random': return RandomPolicy;
    case 'straight-random': return StraightRandomPolicy;
    case 'all-corner-random': return AllCornerRandomPolicy;
    case 'log-normal': return new LogNormalRandomPolicy(desc.mu, desc.sigma);
    case 'erlang': return new ErlangRandomPolicy(desc.k, desc.lambda);
    case 'fixed': return new FixedDistancePolicy(desc.pos);
  }
}

export interface SkillEntry {
  id: string;
  /** Unique skill level 1-10 (only meaningful for the character's own unique). */
  uniqueLv?: number;
  samplePolicy?: SamplePolicyDesc;
}

/** A skill that exists only for the analysis: fixed effects at a fixed position. */
export interface SyntheticSkill {
  id: string;
  /** Activates when the runner reaches this position. */
  position: number;
  effects: { type: SkillType; modifier: number; baseDurationSeconds: number }[];
}

export interface BuildDef {
  horse: HorseDesc;
  skills: SkillEntry[];
  synthetic?: SyntheticSkill[];
}

export interface SimulationOptions {
  /** Pace down behind a synthetic front runner during the opening sections. */
  usePosKeep: boolean;
  /** Spot struggle for front runners. */
  useCompeteTop: boolean;
  /** Roll the Wit activation check for every skill that has one. */
  useIntChecks: boolean;
  /**
   * Evaluate order / order_rate conditions against the running position assumed
   * for the style (front runner 1st, pace chaser 2nd-4th, others 5th-9th of 9),
   * as umalator's skill table does. Off (the default) = a position condition is
   * treated as satisfiable anywhere, since any style can hold any position.
   */
  assumePosition?: boolean;
  /**
   * Treat conditions a single-runner race cannot produce (skill-activation counters,
   * "another skill just fired", popularity, gate, a named rival in the field) as
   * satisfied, so the skill is valued on the assumption that its requirement is met.
   * On by default; the analysis lists the assumed requirements next to the number.
   */
  assumeRequirements?: boolean;
  /** Record per-frame traces for the extreme / representative runs. */
  collectTraces?: boolean;
}

/** [activation position, deactivation position] pairs per skill id. */
export type ActivationRecord = Map<string, [number, number][]>;

export interface RunProfile {
  /** Where the last spurt began; -1 = full spurt from the 2/3 mark. */
  spurtTransition: number;
  fullSpurt: boolean;
  /** Where the runner first reached its target speed after the final leg began; -1 if never. */
  reachTargetPos: number;
  hpAtFinish: number;
  finishTime: number;
  startDelay: number;
}

export interface RunTrace {
  t: number[][];
  p: number[][];
  v: number[][];
  hp: number[][];
  sk: (ActivationRecord | null)[];
  sdly: number[];
  dh: number[];
}

export interface ComparisonResult {
  /** Horse-length gaps in sample order (positive = second build ahead). */
  results: number[];
  runData: {
    /** Runs that finished with a full-speed spurt, per build. */
    nspurt: [number, number];
    minrun: RunTrace | null;
    maxrun: RunTrace | null;
    meanrun: RunTrace | null;
    medianrun: RunTrace | null;
  };
  /** Activation records of every sample, per build (index 0 = first build). */
  activations: [ActivationRecord[], ActivationRecord[]];
  /** Run profiles of every sample, per build. */
  profiles: [RunProfile[], RunProfile[]];
}

type DownhillRecord = Map<string, number>;

function makeActivator(selfSet: ActivationRecord, downhill: DownhillRecord) {
  return function (s: RaceSolver, id: string, persp: Perspective) {
    if (persp !== Perspective.Self) return;
    if (id === 'downhill') {
      downhill.set('downhill', (downhill.get('downhill') ?? 0) - s.accumulatetime.t);
    } else if (id !== 'asitame' && id !== 'staminasyoubu') {
      if (!selfSet.has(id)) selfSet.set(id, []);
      selfSet.get(id)!.push([s.pos, -1]);
    }
  };
}

function makeDeactivator(selfSet: ActivationRecord, downhill: DownhillRecord, course: CourseData) {
  return function (s: RaceSolver, id: string, persp: Perspective) {
    if (persp !== Perspective.Self) return;
    if (id === 'downhill') {
      downhill.set('downhill', (downhill.get('downhill') ?? 0) + s.accumulatetime.t);
    } else if (id !== 'asitame' && id !== 'staminasyoubu') {
      const ar = selfSet.get(id);
      // Several copies of a debuff share one id and can overlap, so fill the first
      // record that has no end yet.
      const r = ar?.find((x) => x[1] === -1);
      // A skill with both a speed and an accel part deactivates twice.
      if (r != null) r[1] = Math.min(s.pos, course.distance);
    }
  };
}

function syntheticSkillData(def: SyntheticSkill, course: CourseData): SkillData {
  const regions = new RegionList();
  const pos = Math.min(Math.max(def.position, 0), course.distance - 11);
  regions.push(new Region(pos, pos + 10));
  return {
    skillId: def.id,
    perspective: Perspective.Self,
    rarity: SkillRarity.Gold,
    wisdomCheck: false,
    samplePolicy: ImmediatePolicy,
    regions,
    extraCondition: () => true,
    effects: def.effects.map((e) => ({
      type: e.type,
      target: SkillTarget.Self,
      baseDuration: e.baseDurationSeconds,
      durationScaling: 1,
      modifier: e.modifier,
      modifierScaling: 1,
    })),
    // Untagged: does not feed the activation counters (like the engine's own hooks).
    tags: [],
    alternative: 0,
  };
}

export function configureBuilder(builder: RaceSolverBuilder, racedef: RaceDefinition) {
  builder
    .ground(racedef.groundCondition)
    .weather(racedef.weather)
    .season(racedef.season)
    .time(racedef.time)
    .grade(racedef.grade)
    .mood(racedef.mood)
    .popularity(racedef.popularity);
  if (racedef.orderRange != null) {
    builder.order(racedef.orderRange[0], racedef.orderRange[1]).numUmas(racedef.numUmas ?? 9);
  }
}

export function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return mid > 0 && sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Same skills on both builds are added in the same order so their RNG streams stay
 * in sync (the whole point of a paired comparison).
 */
function orderedSkills(a: SkillEntry[], b: SkillEntry[]): [SkillEntry[], SkillEntry[]] {
  const common = new Set(a.map((s) => s.id).filter((id) => b.some((s) => s.id === id)));
  const commonList = [...common].sort((x, y) => +x - +y);
  const rank = (id: string) => {
    const i = commonList.indexOf(id);
    return i > -1 ? i : commonList.length;
  };
  const sort = (x: SkillEntry, y: SkillEntry) => rank(x.id) - rank(y.id) || +x.id - +y.id;
  return [a.slice().sort(sort), b.slice().sort(sort)];
}

export function runComparison(
  nsamples: number,
  course: CourseData,
  racedef: RaceDefinition,
  uma1: BuildDef,
  uma2: BuildDef,
  seed: [number, number],
  options: SimulationOptions,
): ComparisonResult {
  const standard = new RaceSolverBuilder(nsamples).seed(seed[0], seed[1]).course(course);
  configureBuilder(standard, racedef);
  if (options.assumeRequirements !== false) standard.withParser(assumedParser);
  const compare = standard.fork();
  standard.horse(uma1.horse).otherHorse(uma2.horse);
  compare.horse(uma2.horse).otherHorse(uma1.horse);

  const wisdomSeeds = new Map<string, [number, number]>();
  const wisdomRng = new Rule30CARng(seed[0], seed[1]);
  for (let i = 0; i < 20; ++i) wisdomRng.pair(); // only the low bits were seeded

  const [skills1, skills2] = orderedSkills(uma1.skills, uma2.skills);
  for (const s of skills1) {
    wisdomSeeds.set(s.id, wisdomRng.pair());
    standard.addSkill(s.id, Perspective.Self, s.uniqueLv ?? 1, instantiateSamplePolicy(s.samplePolicy));
  }
  for (const s of skills2) {
    wisdomSeeds.set(s.id, wisdomRng.pair());
    compare.addSkill(s.id, Perspective.Self, s.uniqueLv ?? 1, instantiateSamplePolicy(s.samplePolicy));
  }
  // Each build also sees the other's skills from the "other" perspective (debuffs).
  for (const s of uma1.skills) compare.addSkill(s.id, Perspective.Other, s.uniqueLv ?? 1, instantiateSamplePolicy(s.samplePolicy));
  for (const s of uma2.skills) standard.addSkill(s.id, Perspective.Other, s.uniqueLv ?? 1, instantiateSamplePolicy(s.samplePolicy));
  for (const def of uma1.synthetic ?? []) standard.addSyntheticSkill((_h, c) => syntheticSkillData(def, c));
  for (const def of uma2.synthetic ?? []) compare.addSyntheticSkill((_h, c) => syntheticSkillData(def, c));

  standard.withAsiwotameru();
  compare.withAsiwotameru();
  if (options.usePosKeep) {
    standard.useDefaultPacer();
    compare.useDefaultPacer();
  }
  if (options.useCompeteTop) {
    standard.withItidoriarasoi();
    compare.withItidoriarasoi();
  }
  if (options.useIntChecks) {
    standard.withWisdomChecks(wisdomSeeds);
    compare.withWisdomChecks(wisdomSeeds);
  }

  const skillPos1: ActivationRecord = new Map();
  const skillPos2: ActivationRecord = new Map();
  const downhill1: DownhillRecord = new Map();
  const downhill2: DownhillRecord = new Map();
  standard.onSkillActivate(makeActivator(skillPos1, downhill1));
  standard.onSkillDeactivate(makeDeactivator(skillPos1, downhill1, course));
  compare.onSkillActivate(makeActivator(skillPos2, downhill2));
  compare.onSkillDeactivate(makeDeactivator(skillPos2, downhill2, course));

  const phase2 = CourseHelpers.phaseStart(course.distance, 2);

  let a = standard.build();
  let b = compare.build();
  // `standard` is the first build. After a swap, generator `a` yields the second build.
  let aIsFirst = true;
  let ai = 1;
  let bi = 0;
  let sign = 1;
  const diff: number[] = [];
  const activations: [ActivationRecord[], ActivationRecord[]] = [[], []];
  const profiles: [RunProfile[], RunProfile[]] = [[], []];
  let min = Infinity;
  let max = -Infinity;
  let estMean = 0;
  let estMedian = 0;
  let bestMeanDiff = Infinity;
  let bestMedianDiff = Infinity;
  let minrun: RunTrace | null = null;
  let maxrun: RunTrace | null = null;
  let meanrun: RunTrace | null = null;
  let medianrun: RunTrace | null = null;
  const nspurt: [number, number] = [0, 0];
  const sampleCutoff = Math.max(Math.floor(nsamples * 0.8), nsamples - 200);
  const traces = options.collectTraces ?? false;
  let retry = false;

  for (let i = 0; i < nsamples; ++i) {
    const s1 = a.next(retry).value as RaceSolver;
    const s2 = b.next(retry).value as RaceSolver;
    const data: RunTrace = { t: [[], []], p: [[], []], v: [[], []], hp: [[], []], sk: [null, null], sdly: [0, 0], dh: [0, 0] };
    const reach = [-1, -1];

    const advance = (s: RaceSolver, idx: number) => {
      s.step(FRAME_SECONDS);
      if (reach[idx] < 0 && s.pos >= phase2 && s.currentSpeed >= s.targetSpeed - 1e-6) reach[idx] = s.pos;
      if (!traces) return;
      data.t[idx].push(s.accumulatetime.t);
      data.p[idx].push(s.pos);
      data.v[idx].push(s.currentSpeed + (s.modifiers.currentSpeed.acc + s.modifiers.currentSpeed.err));
      data.hp[idx].push((s.hp as GameHpPolicy).hp);
    };

    while (s2.pos < course.distance) advance(s2, ai);
    data.sdly[ai] = s2.startDelay;

    while (s1.accumulatetime.t < s2.accumulatetime.t) advance(s1, bi);
    // Run the rest of the way so a trace / profile covers the whole race.
    const pos1 = s1.pos;
    while (s1.pos < course.distance) advance(s1, bi);
    data.sdly[bi] = s1.startDelay;

    s2.cleanup();
    s1.cleanup();

    data.dh[1] = downhill2.get('downhill') ?? 0;
    downhill2.delete('downhill');
    data.dh[0] = downhill1.get('downhill') ?? 0;
    downhill1.delete('downhill');
    const rec2 = new Map(skillPos2);
    skillPos2.clear();
    const rec1 = new Map(skillPos1);
    skillPos1.clear();
    data.sk[1] = rec2;
    data.sk[0] = rec1;

    // If `standard` is faster than `compare` the former runs past the finish line,
    // which would overstate a skill that continues past the end. Swap and redo.
    if (s2.pos < pos1 || Number.isNaN(pos1)) {
      [b, a] = [a, b];
      [bi, ai] = [ai, bi];
      sign *= -1;
      aIsFirst = !aIsFirst;
      --i;
      retry = true;
    } else {
      retry = false;
      const profile = (s: RaceSolver, idx: number): RunProfile => ({
        spurtTransition: s.lastSpurtTransition,
        fullSpurt: s.isLastSpurt && s.lastSpurtTransition === -1,
        reachTargetPos: reach[idx],
        hpAtFinish: s.hp.remainingHp(),
        finishTime: s.accumulatetime.t,
        startDelay: s.startDelay,
      });
      const p1 = profile(s1, bi);
      const p2 = profile(s2, ai);
      nspurt[bi] += +p1.fullSpurt;
      nspurt[ai] += +p2.fullSpurt;
      const basinn = (sign * (s2.pos - pos1)) / HORSE_LENGTH_METERS;
      diff.push(basinn);
      // s1 came from generator `a`; rec1 / p1 belong to whichever build `a` currently is.
      activations[aIsFirst ? 0 : 1].push(rec1);
      activations[aIsFirst ? 1 : 0].push(rec2);
      profiles[aIsFirst ? 0 : 1].push(p1);
      profiles[aIsFirst ? 1 : 0].push(p2);
      if (basinn < min) {
        min = basinn;
        minrun = data;
      }
      if (basinn > max) {
        max = basinn;
        maxrun = data;
      }
      if (i === sampleCutoff) {
        const sorted = diff.slice().sort((x, y) => x - y);
        estMean = sorted.reduce((x, y) => x + y, 0) / sorted.length;
        estMedian = median(sorted);
      }
      if (i >= sampleCutoff) {
        const meanDiff = Math.abs(basinn - estMean);
        const medianDiff = Math.abs(basinn - estMedian);
        if (meanDiff < bestMeanDiff) {
          bestMeanDiff = meanDiff;
          meanrun = data;
        }
        if (medianDiff < bestMedianDiff) {
          bestMedianDiff = medianDiff;
          medianrun = data;
        }
      }
    }
  }
  // nspurt was indexed by generator side; translate to build order.
  const spurts: [number, number] = [profiles[0].filter((p) => p.fullSpurt).length, profiles[1].filter((p) => p.fullSpurt).length];
  return { results: diff, runData: { nspurt: spurts, minrun, maxrun, meanrun, medianrun }, activations, profiles };
}

export interface Summary {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  /** Sample standard deviation. */
  stdDev: number;
}

export function summarize(results: number[]): Summary {
  if (!results.length) return { n: 0, min: 0, max: 0, mean: 0, median: 0, stdDev: 0 };
  const sorted = results.slice().sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const variance = sorted.length > 1 ? sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / (sorted.length - 1) : 0;
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median: median(sorted),
    stdDev: Math.sqrt(variance),
  };
}
