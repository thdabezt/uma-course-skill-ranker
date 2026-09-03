/**
 * Stamina calculator, ported from umalator's hpcalc.ts (uma-tools, GPL-3.0).
 *
 * Runs the race many times and answers two questions:
 *   1. how much HP is left at the finish (and whether the runner could afford a
 *      full-speed last spurt), and
 *   2. how much HP the race actually required, from which the stamina needed for
 *      a given full-spurt rate is derived.
 */
import type { CourseData } from './vendor/CourseData';
import { CourseHelpers, type Phase } from './vendor/CourseData';
import type { HorseParameters } from './vendor/HorseTypes';
import { GameHpPolicy, type HpPolicy, type HpStatus } from './vendor/HpPolicy';
import type { GroundCondition } from './vendor/RaceParameters';
import type { RaceSolver, RaceState } from './vendor/RaceSolver';
import { Perspective } from './vendor/RaceSolver';
import { RaceSolverBuilder } from './vendor/RaceSolverBuilder';
import { Rule30CARng, type PRNG } from './vendor/Random';
import type { RaceDefinition } from './runner';
import {
  FRAME_SECONDS,
  configureBuilder,
  instantiateSamplePolicy,
  median,
  type ActivationRecord,
  type BuildDef,
  type SimulationOptions,
} from './compare';

const LAST_LEG: HpStatus = { phase: 2 as Phase, isPaceDown: false, isDownhillMode: false, isItidoriarasoi: false, isKakari: false };

/**
 * Real HP accounting, optionally forcing the full-speed spurt. Records the HP
 * balance the game's own full-spurt check computed at the 2/3 mark.
 */
class ForceFullSpurtHpPolicy implements HpPolicy {
  wrapped: GameHpPolicy;
  balance = NaN;
  wasFullSpurt = false;
  downhillSave = 0;

  constructor(readonly forceSpurt: boolean, course: CourseData, ground: GroundCondition, rng: PRNG) {
    this.wrapped = new GameHpPolicy(course, ground, rng);
  }

  get hp() {
    return this.wrapped.hp;
  }
  /** Remaining HP; with the forced spurt, the shortfall of the full-spurt check counts against it. */
  get finalHp() {
    return this.forceSpurt ? Math.min(this.balance, this.wrapped.hp) : this.wrapped.hp;
  }

  init(horse: HorseParameters) {
    this.wrapped.init(horse);
  }
  tick(state: RaceState, dt: number) {
    if (state.isDownhillMode) {
      this.downhillSave +=
        this.wrapped.hpPerSecond({ ...state, isDownhillMode: false }, state.currentSpeed) * dt -
        this.wrapped.hpPerSecond(state, state.currentSpeed) * dt;
    }
    this.wrapped.tick(state, dt);
  }
  remainingHp() {
    return this.wrapped.remainingHp();
  }
  hpRatioRemaining() {
    return this.wrapped.hpRatioRemaining();
  }
  recover(modifier: number) {
    this.wrapped.recover(modifier);
  }
  getLastSpurtPair(state: RaceState, maxSpeed: number, bts2: number): [number, number] {
    const maxDist = this.wrapped.distance - CourseHelpers.phaseStart(this.wrapped.distance, 2);
    const s = (maxDist - 60) / maxSpeed;
    this.balance = this.wrapped.hp - this.wrapped.hpPerSecond(LAST_LEG, maxSpeed) * s;
    this.wasFullSpurt = this.balance >= 0;
    if (this.forceSpurt) {
      return [-1, maxSpeed];
    }
    return this.wrapped.getLastSpurtPair(state, maxSpeed, bts2);
  }
}

/** Counts consumption from zero so `hpUsed` is the HP the race demanded. */
class CalcRequiredHpPolicy implements HpPolicy {
  wrapped: GameHpPolicy;

  constructor(course: CourseData, ground: GroundCondition, rng: PRNG) {
    this.wrapped = new GameHpPolicy(course, ground, rng);
  }

  get hpUsed() {
    return -this.wrapped.hp;
  }

  init(horse: HorseParameters) {
    this.wrapped.init(horse);
    this.wrapped.hp = 0;
  }
  tick(state: RaceState, dt: number) {
    this.wrapped.tick(state, dt);
  }
  remainingHp() {
    return this.wrapped.maxHp;
  }
  hpRatioRemaining() {
    return 1.0;
  }
  recover(modifier: number) {
    this.wrapped.recover(modifier);
  }
  getLastSpurtPair(_0: RaceState, maxSpeed: number, _1: number): [number, number] {
    const maxDist = this.wrapped.distance - CourseHelpers.phaseStart(this.wrapped.distance, 2);
    const s = (maxDist - 60) / maxSpeed;
    this.wrapped.hp -= this.wrapped.hpPerSecond(LAST_LEG, maxSpeed) * s;
    return [-1, maxSpeed];
  }
}

export interface HpCalcOptions extends SimulationOptions {
  /** Spurt at full speed from the 2/3 mark even when HP is short (umalator default: on). */
  forceFullSpurt: boolean;
}

export interface HpCalcResult {
  /** Sorted remaining HP at the finish, one per sample. */
  remainingHp: number[];
  /** Remaining HP in sample order, aligned with `activations`. */
  remainingHpUnsorted: number[];
  /** Sorted HP the race required (incl. a full spurt), one per sample. */
  requiredHp: number[];
  /** Sorted HP saved by downhill mode, one per sample. */
  downhillSave: number[];
  /** Samples that passed the game's full-spurt check. */
  fullSpurtCount: number;
  samples: number;
  /** Activation records per sample (own skills). */
  activations: ActivationRecord[];
  maxHp: number;
}

export function runHpCalc(
  nsamples: number,
  course: CourseData,
  racedef: RaceDefinition,
  uma: BuildDef,
  seed: [number, number],
  options: HpCalcOptions,
): HpCalcResult {
  const b0 = new RaceSolverBuilder(nsamples).seed(seed[0], seed[1]).course(course);
  configureBuilder(b0, racedef);
  b0.horse(uma.horse).otherHorse(uma.horse);

  const wisdomSeeds = new Map<string, [number, number]>();
  const wisdomRng = new Rule30CARng(seed[0], seed[1]);
  for (let i = 0; i < 20; ++i) wisdomRng.pair();
  for (const s of uma.skills) {
    wisdomSeeds.set(s.id, wisdomRng.pair());
    b0.addSkill(s.id, Perspective.Self, s.uniqueLv ?? 1, instantiateSamplePolicy(s.samplePolicy));
  }
  b0.withAsiwotameru();
  if (options.usePosKeep) b0.useDefaultPacer();
  if (options.useCompeteTop) b0.withItidoriarasoi();
  if (options.useIntChecks) b0.withWisdomChecks(wisdomSeeds);

  const b1 = b0.fork().hpPolicyFactory((c, params, rng) => new CalcRequiredHpPolicy(c, params.groundCondition, rng));
  const skillActivations: ActivationRecord = new Map();
  b0.onSkillActivate((s: RaceSolver, id: string, persp: Perspective) => {
    if (persp !== Perspective.Self || id === 'asitame' || id === 'staminasyoubu' || id === 'downhill') return;
    if (!skillActivations.has(id)) skillActivations.set(id, []);
    skillActivations.get(id)!.push([s.pos, -1]);
  });
  b0.onSkillDeactivate((s: RaceSolver, id: string, persp: Perspective) => {
    if (persp !== Perspective.Self || id === 'asitame' || id === 'staminasyoubu' || id === 'downhill') return;
    const r = skillActivations.get(id)?.find((x) => x[1] === -1);
    if (r != null) r[1] = Math.min(s.pos, course.distance);
  });
  b0.hpPolicyFactory((c, params, rng) => new ForceFullSpurtHpPolicy(options.forceFullSpurt, c, params.groundCondition, rng));

  const g0 = b0.build();
  const g1 = b1.build();
  const remainingHp: number[] = [];
  const requiredHp: number[] = [];
  const downhillSave: number[] = [];
  const activations: ActivationRecord[] = [];
  let fullSpurtCount = 0;
  let maxHp = 0;

  for (let i = 0; i < nsamples; ++i) {
    const s0 = g0.next().value as RaceSolver;
    while (s0.pos < course.distance) s0.step(FRAME_SECONDS);
    s0.cleanup();
    const hpp = s0.hp as ForceFullSpurtHpPolicy;
    maxHp = hpp.wrapped.maxHp;
    fullSpurtCount += +hpp.wasFullSpurt;
    downhillSave.push(hpp.downhillSave);
    remainingHp.push(hpp.finalHp);
    activations.push(new Map(skillActivations));
    skillActivations.clear();

    const s1 = g1.next().value as RaceSolver;
    while (s1.pos < course.distance) {
      s1.step(FRAME_SECONDS);
      if (s1.isLastSpurt) {
        requiredHp.push((s1.hp as CalcRequiredHpPolicy).hpUsed);
        break;
      }
    }
  }
  const remainingHpUnsorted = remainingHp.slice();
  remainingHp.sort((a, b) => a - b);
  requiredHp.sort((a, b) => a - b);
  downhillSave.sort((a, b) => a - b);
  return { remainingHp, remainingHpUnsorted, requiredHp, downhillSave, fullSpurtCount, samples: nsamples, activations, maxHp };
}

const HP_STRATEGY_COEFFICIENT: Record<string, number> = { Nige: 0.95, Senkou: 0.89, Sasi: 1.0, Oikomi: 0.995, Oonige: 0.86 };

/**
 * Inverts maxHp = 0.8 * coef * stamina + distance, undoing the 1200 overcap
 * halving. The result is the effective (mood-adjusted) stamina.
 */
export function maxHpToStamina(strategy: keyof typeof HP_STRATEGY_COEFFICIENT, hp: number, distance: number): number {
  const coef = HP_STRATEGY_COEFFICIENT[strategy];
  let stam = (1.25 * (hp - distance)) / coef;
  if (stam > 1200) stam = 1200 + (stam - 1200) * 2;
  return stam;
}

/** Stamina needed so that `rate` (0-1) of the sampled races could afford a full spurt. */
export function staminaForSpurtRate(result: HpCalcResult, strategy: keyof typeof HP_STRATEGY_COEFFICIENT, distance: number, rate: number): number {
  if (!result.requiredHp.length) return 0;
  const idx = Math.min(result.requiredHp.length - 1, Math.max(0, Math.ceil(result.requiredHp.length * rate) - 1));
  return maxHpToStamina(strategy, result.requiredHp[idx], distance);
}

export function hpSummary(values: number[]) {
  if (!values.length) return { min: 0, max: 0, mean: 0, median: 0 };
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    median: median(sorted),
  };
}
