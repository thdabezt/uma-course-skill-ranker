/**
 * SINGLE SOURCE OF TRUTH FOR EVERY MODELLING ASSUMPTION.
 *
 * Nothing in `src/simulation`, `src/skills` or `src/ranking` may hard-code a magic
 * number. If you disagree with a value, change it here and re-run the rankings.
 *
 * The race model is an independent re-implementation of the mechanics that the
 * Uma Musume community has publicly documented (speed / acceleration / stamina
 * formulas). No proprietary source code was copied. `mee1080/umasim` and similar
 * AGPL simulators were NOT used as a code source.
 *
 * Every value below is an assumption. Where the real game depends on the other
 * 8-17 runners in the race (overtaking, blocking, positioning), a solo
 * deterministic simulation cannot know the answer, so we substitute an explicit
 * probability from `ACTIVATION_ASSUMPTIONS` and flag the result as an estimate.
 */

import { LOCAL_DIRT_TRACK_IDS, TIGHT_TRACK_IDS as TIGHT_TRACK_ID_LIST } from '@/courses/trackIds';

export type RunningStyle = 'front_runner' | 'pace_chaser' | 'late_surger' | 'end_closer';
export type Surface = 'turf' | 'dirt';
export type TrackCondition = 'firm' | 'good' | 'soft' | 'heavy';
export type Weather = 'sunny' | 'cloudy' | 'rainy' | 'snowy';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter' | 'sakura';
export type Aptitude = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export type Mood = 'awful' | 'bad' | 'normal' | 'good' | 'great';

/** In-game running-style order used by the `running_style` condition (1..4). */
export const RUNNING_STYLE_IDS: Record<RunningStyle, number> = {
  front_runner: 1,
  pace_chaser: 2,
  late_surger: 3,
  end_closer: 4,
};

export const RUNNING_STYLE_LABELS: Record<RunningStyle, string> = {
  front_runner: 'Front Runner',
  pace_chaser: 'Pace Chaser',
  late_surger: 'Late Surger',
  end_closer: 'End Closer',
};

export const RUNNING_STYLES: RunningStyle[] = [
  'front_runner',
  'pace_chaser',
  'late_surger',
  'end_closer',
];

/* ------------------------------------------------------------------ core */

export const SIMULATION = {
  /** Fixed timestep. 1/15 s matches the game's internal race tick. */
  frameSeconds: 1 / 15,

  /** Hard cap so a broken configuration can never hang the worker. */
  maxRaceSeconds: 300,

  /**
   * 1 horse length in metres. Confirmed against the Global reference implementation.
   * The conversion itself lives in `./horseLength.ts` - it is applied to a position
   * gap measured at equal elapsed time, not to `timeSaved * finishSpeed`.
   */
  horseLengthMeters: 2.5,

  /**
   * Base speed of the course: `20 - (distance - 2000) / 1000` m/s.
   * Longer races have a lower baseline pace.
   */
  baseSpeedReferenceDistance: 2000,
  baseSpeedAtReferenceDistance: 20,
  baseSpeedPerMeter: 1 / 1000,

  /** Speed the runner leaves the gate at, before the start dash. */
  startingSpeed: 3.0,
  /** Start delay is uniform in [0, startDelayMaxSeconds). */
  startDelayMaxSeconds: 0.1,
  /**
   * Start dash: a large extra acceleration until current speed reaches
   * `startDashSpeedThreshold * baseSpeed`. Target speed is also capped there.
   */
  startDashAccelBonus: 24,
  startDashSpeedThreshold: 0.85,

  /**
   * Deceleration (m/s^2) applied when current speed exceeds target speed, indexed
   * by race phase 0/1/2. Phase 3 shares phase 2's value.
   */
  decelerationByPhase: [-1.2, -0.8, -1.0],
  /** Deceleration once stamina is gone. */
  exhaustedDeceleration: -1.2,
  /** Deceleration while position-keep pace-down is active. */
  paceDownDeceleration: -0.5,

  /** Base acceleration coefficient: `accelBase * sqrt(500 * power)`. */
  accelerationPowerCoefficient: 0.0006,
  /** Acceleration uses a lower base coefficient while climbing. */
  uphillAccelerationPowerCoefficient: 0.0004,

  /**
   * Minimum speed the runner can never drop below:
   * `minSpeedBaseRatio * baseSpeed + sqrt(minSpeedGutsCoef * guts) * minSpeedGutsScale`.
   */
  minSpeedBaseRatio: 0.85,
  minSpeedGutsCoefficient: 200,
  minSpeedGutsScale: 0.001,

  /** Target-speed contribution of the Speed stat in the late race: `sqrt(500 * speed) * apt * coef`. */
  lateSpeedStatCoefficient: 0.002,

  /** Last-spurt multiplier applied to the phase-2 target speed. */
  lastSpurtMultiplier: 1.05,
  lastSpurtBaseSpeedBonus: 0.01,
  /**
   * GLOBAL DIFFERENCE: the Japanese build adds `(450 * guts) ^ 0.597 * 0.0001` to
   * the last-spurt speed. The Global build does not, so this engine does not
   * either. See GLOBAL_JP_DIFFERENCES in ./globalVersion.ts.
   */
  lastSpurtIncludesGutsBonus: false,

  /** The last `lastSpurtTailMeters` are excluded when planning the spurt. */
  lastSpurtTailMeters: 60,
  /** Spurt-plan candidate search step, in m/s. */
  lastSpurtSearchStep: 0.1,

  /** Max HP: `distance + hpStaminaCoefficient * stamina * strategyHpCoefficient`. */
  hpStaminaCoefficient: 0.8,

  /** HP drain per second: `hpDrainCoef * (v - baseSpeed + hpDrainOffset)^2 / hpDrainDivisor`. */
  hpDrainCoefficient: 20,
  hpDrainOffset: 12,
  hpDrainDivisor: 144,

  /** Late-race guts modifier on HP drain: `1 + gutsHpModNumerator / sqrt(gutsHpModCoef * guts)`. */
  gutsHpModNumerator: 200,
  gutsHpModCoefficient: 600,

  /**
   * Uphill target-speed penalty: `slopePermilleTimes10000 / 10000 * coef / power`.
   * Climbing does NOT multiply stamina drain - it lowers the acceleration base and
   * the target speed instead.
   */
  uphillSpeedPenaltyCoefficient: 200,

  /**
   * HP drain multiplier while position-keep pace-down is active.
   * Downhill acceleration mode is not modelled (the reference does not model it
   * either); see REFERENCE_LIMITATIONS in ./globalVersion.ts.
   */
  paceDownHpDrainMultiplier: 0.6,

  /**
   * Per-section target-speed variance driven by Wit. The course is split into
   * `witSectionCount` equal sections and each gets its own offset:
   *   max    = wisdom / witVarianceDivisor * log10(wisdom * witVarianceLogScale)
   *   factor = (max - witVarianceSpread + U(0, witVarianceSpread)) / 100
   *   offset = baseSpeed * factor
   * The mean offset is negative, so a low-Wit runner cruises slightly under its
   * nominal target speed.
   */
  witSectionCount: 24,
  witVarianceDivisor: 5500,
  witVarianceLogScale: 0.1,
  witVarianceSpread: 0.65,

  /**
   * Position keeping. Only non-front-runners pace down, and only against a pacer.
   * The reference caps this at 5 sections rather than the game's 10; we follow it.
   */
  positionKeepEnabled: true,
  positionKeepSections: 5,
  paceDownSpeedCoefficientMiddle: 0.945,
  paceDownSpeedCoefficientOther: 0.915,
  positionKeepCooldownSeconds: 3.0,
  /** Rushing (kakari) is not modelled; it needs the full field. */
  rushEnabled: false,

  /** Skill duration in seconds: `baseDuration * (courseDistance / durationDistanceReference)`. */
  durationDistanceReference: 1000,

  /** Raw skill values are stored multiplied by this factor. */
  effectValueScale: 10000,

  /** Recovery skills restore `rawValue / recoveryValueScale` of max HP. */
  recoveryValueScale: 10000,

  /** Stat values above this are halved before use. */
  statOvercapThreshold: 1200,
  /** Course stat-threshold bonus caps the stat it reads at this value. */
  courseStatThresholdCap: 901,
  courseStatThresholdStep: 300.01,
  courseStatThresholdBonus: 0.05,

  /**
   * Skill activation (proc) rate from Wit: `(100 - 9000 / wisdom) / 100`, clamped
   * to [0, 1]. A skill that passes its condition can still silently fail this roll.
   */
  witProcRateNumerator: 9000,

  /**
   * Chance the last-spurt planner accepts a given candidate plan:
   * `(15 + 0.05 * wisdom) / 100`. Lower Wit means a worse spurt plan more often.
   */
  spurtAcceptBase: 15,
  spurtAcceptWisdomCoefficient: 0.05,

  /**
   * Upper bound on a modelled stamina penalty, as a share of max HP.
   *
   * The "gamble" skills (Nothing Ventured / Risky Business) store a stamina value
   * of -10000, i.e. -100 %. Their in-game text says the fatigue only happens
   * "sometimes", so taking the raw value literally would report them as costing
   * tens of horse lengths. We clamp the drain here and flag the skill as an
   * estimate instead of inventing a hidden special case in the engine.
   */
  staminaDrainClampFraction: 0.2,
} as const;

/** Strategy target-speed coefficients per phase (0 opening, 1 middle, 2 final; 3 reuses 2). */
export const STRATEGY_PHASE_SPEED: Record<RunningStyle, [number, number, number]> = {
  front_runner: [1.0, 0.98, 0.962],
  pace_chaser: [0.978, 0.991, 0.975],
  late_surger: [0.938, 0.998, 0.994],
  end_closer: [0.931, 1.0, 1.0],
};

/** Strategy acceleration coefficients per phase (0/1/2; phase 3 reuses 2). */
export const STRATEGY_PHASE_ACCEL: Record<RunningStyle, [number, number, number]> = {
  front_runner: [1.0, 1.0, 0.996],
  pace_chaser: [0.985, 1.0, 0.996],
  late_surger: [0.975, 1.0, 1.0],
  end_closer: [0.945, 1.0, 0.997],
};

/** Strategy stamina coefficient used by the max-HP formula. */
export const STRATEGY_HP: Record<RunningStyle, number> = {
  front_runner: 0.95,
  pace_chaser: 0.89,
  late_surger: 1.0,
  end_closer: 0.995,
};

/* ------------------------------------------------------------ aptitudes */

/** Distance aptitude -> multiplier on the Speed stat's late-race contribution. */
export const DISTANCE_APTITUDE_SPEED: Record<Aptitude, number> = {
  S: 1.05,
  A: 1.0,
  B: 0.9,
  C: 0.8,
  D: 0.6,
  E: 0.4,
  F: 0.2,
  G: 0.1,
};

/** Distance aptitude -> multiplier on acceleration. */
export const DISTANCE_APTITUDE_ACCEL: Record<Aptitude, number> = {
  S: 1.0,
  A: 1.0,
  B: 1.0,
  C: 1.0,
  D: 1.0,
  E: 0.6,
  F: 0.5,
  G: 0.4,
};

/**
 * Running-style aptitude -> multiplier on the **Wit** stat.
 * It does not touch speed or acceleration directly; it degrades skill proc rate,
 * per-section speed variance and last-spurt planning quality.
 */
export const STYLE_APTITUDE_WIT: Record<Aptitude, number> = {
  S: 1.1,
  A: 1.0,
  B: 0.85,
  C: 0.75,
  D: 0.6,
  E: 0.4,
  F: 0.2,
  G: 0.1,
};

/**
 * Surface (turf / dirt) aptitude -> multiplier on **acceleration**.
 * It does not scale the Speed or Power stats.
 */
export const SURFACE_APTITUDE_ACCEL: Record<Aptitude, number> = {
  S: 1.05,
  A: 1.0,
  B: 0.9,
  C: 0.8,
  D: 0.7,
  E: 0.5,
  F: 0.3,
  G: 0.1,
};

/**
 * Mood (motivation) -> flat multiplier on every stat: `1 + 0.02 * moodLevel`,
 * where moodLevel runs -2 (awful) .. +2 (great).
 */
export const MOOD_LEVEL: Record<Mood, number> = {
  great: 2,
  good: 1,
  normal: 0,
  bad: -1,
  awful: -2,
};

export const MOOD_COEFFICIENT_PER_LEVEL = 0.02;

export const MOOD_MULTIPLIER: Record<Mood, number> = {
  great: 1 + MOOD_COEFFICIENT_PER_LEVEL * 2,
  good: 1 + MOOD_COEFFICIENT_PER_LEVEL * 1,
  normal: 1,
  bad: 1 - MOOD_COEFFICIENT_PER_LEVEL * 1,
  awful: 1 - MOOD_COEFFICIENT_PER_LEVEL * 2,
};

/** In-game `motivation` condition value (1 = awful .. 5 = great). */
export const MOOD_IDS: Record<Mood, number> = {
  awful: 1,
  bad: 2,
  normal: 3,
  good: 4,
  great: 5,
};

/* ------------------------------------------------------- track condition */

export interface TrackConditionModifier {
  /** Flat addition to the Speed stat, applied after the course stat bonus. */
  speed: number;
  /** Flat addition to the Power stat. */
  power: number;
  /** Multiplier on HP drain. */
  hpDrain: number;
}

export const TRACK_CONDITION_MODIFIERS: Record<Surface, Record<TrackCondition, TrackConditionModifier>> = {
  turf: {
    firm: { speed: 0, power: 0, hpDrain: 1.0 },
    good: { speed: 0, power: -50, hpDrain: 1.0 },
    soft: { speed: 0, power: -50, hpDrain: 1.02 },
    heavy: { speed: -50, power: -50, hpDrain: 1.02 },
  },
  dirt: {
    firm: { speed: 0, power: -100, hpDrain: 1.0 },
    good: { speed: 0, power: -50, hpDrain: 1.0 },
    soft: { speed: 0, power: -100, hpDrain: 1.01 },
    heavy: { speed: -50, power: -100, hpDrain: 1.02 },
  },
};

/** In-game `ground_condition` condition value (1 = firm .. 4 = heavy). */
export const TRACK_CONDITION_IDS: Record<TrackCondition, number> = {
  firm: 1,
  good: 2,
  soft: 3,
  heavy: 4,
};

/** In-game `weather` condition value. */
export const WEATHER_IDS: Record<Weather, number> = { sunny: 1, cloudy: 2, rainy: 3, snowy: 4 };

/** In-game `season` condition value. `sakura` is the special cherry-blossom season. */
export const SEASON_IDS: Record<Season, number> = {
  spring: 1,
  summer: 2,
  autumn: 3,
  winter: 4,
  sakura: 5,
};

/* -------------------------------------------------------- runner default */

export interface RunnerConfig {
  /** Displayed stats, before mood / track-condition / aptitude modifiers. */
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  wit: number;
  mood: Mood;
  /** Aptitudes that gate the speed/acceleration multipliers. */
  distanceAptitude: Aptitude;
  surfaceAptitude: Aptitude;
  styleAptitude: Aptitude;
  runningStyle: RunningStyle;
  /**
   * Wit-driven skill activation rate. `null` derives it from Wit with the in-game
   * formula `(100 - 9000 / wit) / 100`; a number overrides it (1 = always fires).
   */
  skillActivationRate: number | null;
  /** Seconds lost at the gate. 0 = clean start. */
  startDelaySeconds: number;
  /** Gate number, for `post_number` conditions. */
  postNumber: number;
  /** Popularity rank, for `popularity` conditions. */
  popularity: number;
}

/**
 * The reference runner every ranking is computed against.
 *
 * Chosen to represent a competitive end-game build: enough stamina to complete a
 * full last spurt on a 2400 m course, so recovery skills correctly score near zero
 * there and only become valuable on longer courses or a leaner build. Lower the
 * stamina in the UI to see how much recovery skills are worth to a tighter build.
 */
export const DEFAULT_RUNNER: RunnerConfig = {
  speed: 1100,
  stamina: 900,
  power: 900,
  guts: 500,
  wit: 700,
  mood: 'great',
  distanceAptitude: 'A',
  surfaceAptitude: 'A',
  styleAptitude: 'A',
  runningStyle: 'pace_chaser',
  /** null = derive from Wit using the in-game proc-rate formula. */
  skillActivationRate: null,
  startDelaySeconds: 0,
  postNumber: 5,
  popularity: 3,
};

/** Wit -> skill activation (proc) rate: `(100 - 9000 / wit) / 100`, clamped to [0, 1]. */
export function witSkillProcRate(wit: number): number {
  if (wit <= 0) return 0;
  return Math.min(1, Math.max(0, (100 - SIMULATION.witProcRateNumerator / wit) / 100));
}

/* ------------------------------------------------------ race field model */

/**
 * Assumptions about the rest of the field. A solo simulation has no opponents, so
 * any condition that reads the field is resolved from this table instead.
 * Every skill that depends on one of these is reported as an ESTIMATE.
 */
export const RACE_FIELD = {
  /** Runners in the race, including ours. Global career/team races run 9-18. */
  fieldSize: 12,
  /** Our assumed running position when a condition asks for `order`. */
  assumedOrder: { front_runner: 1, pace_chaser: 4, late_surger: 8, end_closer: 11 } as Record<
    RunningStyle,
    number
  >,
  /** Number of runners assumed to share our running style. */
  sameStyleCount: 3,
  /** Assumed race grade for the `grade` condition (100 = G1). */
  grade: 100,
  /** Opponents generated alongside the player. Player + this = full field. */
  opponentCount: 8,
  /** Seeded spread applied to each opponent's stats, as a fraction. */
  opponentStatSpread: 0.18,
  /** Baseline opponent stat level, as a fraction of the player's. */
  opponentStatLevel: 0.95,
  /** Metres within which another runner counts as "nearby". */
  nearbyRunnerMeters: 5,
  /** Metres within which a runner counts as directly ahead/behind for lane conditions. */
  closeLaneMeters: 2.5,
  /** Opponent simulation on/off. When off, the old probability assumptions are used. */
  opponentSimulationEnabled: true,
  /** Pace-down begins while the runner ahead is closer than this. */
  positionKeepMinGapMeters: 4.0,
  /**
   * Use the gap-driven pace-down rule instead of the phase-based one. Measured
   * against umalator the phase-based model matches better, so this is off by
   * default; the gap-driven rule is kept for experimentation.
   */
  opponentDrivenPositionKeep: false,
  /**
   * Half-width of the triangular distribution used to model how much our running
   * position varies around `assumedOrder` when an `order` condition is checked.
   */
  orderSpread: 3,
} as const;

/**
 * Time of day (`time` condition). The course selector does not expose it, so a
 * single assumed value is used. 1 = morning, 2 = midday, 3 = evening, 4 = night.
 */
export const TIME_OF_DAY = { assumedValue: 2, label: 'Midday' } as const;

/**
 * Racecourse classification used by the `is_tight_track` and `is_dirtgrade`
 * conditions. GameTora does not publish these flags, so they are maintained here.
 */
export const TIGHT_TRACK_IDS: { localDirtTrackIds: number[]; tightTrackIds: number[] } = {
  localDirtTrackIds: LOCAL_DIRT_TRACK_IDS,
  tightTrackIds: TIGHT_TRACK_ID_LIST,
};

/**
 * Probability assigned to a condition term the solo simulation cannot decide.
 * Keys are condition names from GameTora's `static/skill_conditions` dictionary.
 * `default` is used for anything unlisted, and always marks the result as an estimate.
 */
export const ACTIVATION_ASSUMPTIONS: Record<string, number> = {
  // Positional / field-relative situations.
  is_overtake: 0.75,
  overtake_target_no_order_up_time: 0.6,
  overtake_target_time: 0.5,
  change_order_onetime: 0.8,
  change_order_up_end_after: 0.6,
  change_order_up_finalcorner_after: 0.55,
  bashin_diff_infront: 0.7,
  bashin_diff_behind: 0.7,
  distance_diff_top: 0.7,
  distance_diff_rate: 0.7,
  near_count: 0.7,
  is_surrounded: 0.25,
  blocked_front: 0.3,
  blocked_front_continuetime: 0.25,
  blocked_side_continuetime: 0.25,
  behind_near_lane_time: 0.5,
  behind_near_lane_time_set1: 0.6,
  infront_near_lane_time: 0.5,
  is_behind_in: 0.4,
  is_move_lane: 0.5,
  lane_type: 0.5,
  compete_fight_count: 0.35,

  // Order-based conditions. Resolved against `RACE_FIELD.assumedOrder` when possible;
  // this value is the fallback when the comparison is ambiguous.
  order: 0.7,
  order_rate: 0.7,
  order_rate_in20_continue: 0.35,
  order_rate_in50_continue: 0.55,
  order_rate_in80_continue: 0.8,
  order_rate_out40_continue: 0.5,
  order_rate_out50_continue: 0.45,
  order_rate_out70_continue: 0.3,

  // Other-runner state.
  is_other_character_activate_advantage_skill: 0.6,
  is_exist_chara_id: 0.1,
  same_skill_horse_count: 0.3,
  running_style_equal_popularity_one: 0.3,
  temptation_opponent_count_behind: 0.3,
  temptation_opponent_count_infront: 0.3,
  running_style_temptation_opponent_count_nige: 0.3,
  running_style_temptation_opponent_count_senko: 0.3,
  running_style_temptation_opponent_count_sashi: 0.3,
  running_style_temptation_opponent_count_oikomi: 0.3,

  // Own state that the solo sim does not model.
  is_temptation: 0.15,
  temptation_count: 0.15,
  is_badstart: 0.1,
  is_activate_any_skill: 0.8,
  is_activate_other_skill_detail: 0.5,
  activate_count_all: 0.7,
  activate_count_start: 0.5,
  activate_count_middle: 0.6,
  activate_count_end_after: 0.6,
  activate_count_later_half: 0.6,
  activate_count_heal: 0.5,
  random_lot: 0.5,

  /** Fallback for any condition not listed above. */
  default: 0.5,
};

/**
 * Controls for the paired baseline-vs-skill evaluation.
 *
 * A skill is measured by running the SAME runner twice with the SAME seed: once
 * without the skill and once with it. Common random numbers mean the start delay,
 * per-section speed variance and spurt-planning rolls are identical in both runs,
 * so the difference is the skill's contribution and not noise.
 */
export const EVALUATION = {
  /** Master seed. Every result in the app is reproducible from this. */
  seed: 20260731,
  /**
   * Monte Carlo repetitions per activation position. The model is stochastic
   * (start delay, Wit variance, spurt planning), so more than one paired run is
   * needed for a stable mean; paired sampling keeps this number small.
   */
  monteCarloRuns: 6,
  /** Never fewer than this many paired runs per activation position. */
  minRuns: 2,
  /**
   * Adaptive sampling for opponent-dependent skills. Sampling continues until the
   * 95 % confidence half-width drops below max(absoluteTarget, |mean| * relativeTarget),
   * or `maxRuns` paired simulations have been run.
   */
  eventMinRuns: 16,
  /**
   * Distinct opponent scenarios. Sampling beyond this adds no information, because
   * a scenario is fully determined by its seed - so this is also the hard sample
   * cap. Scenarios are built lazily and shared by every skill on the course.
   */
  scenarioCount: 32,
  maxRuns: 32,
  precisionAbsoluteTarget: 0.05,
  precisionRelativeTarget: 0.05,
  /**
   * Stop early once the paired results have converged. Most skills are effectively
   * deterministic under paired sampling, so they finish in `minRuns`; only the ones
   * that interact with the stochastic spurt planning use the full budget.
   */
  convergenceStdDevLengths: 0.02,
  /** Report a confidence interval once at least this many paired samples exist. */
  minSamplesForInterval: 3,
} as const;

/** Sampling used when a skill activates at a random point inside a window. */
export const SAMPLING = {
  /** Number of evenly spaced activation points evaluated inside each window. */
  samplesPerWindow: 9,
  /** Windows shorter than this are evaluated at a single midpoint. */
  minWindowMeters: 5,
  /** Hard cap on simulations per skill, to keep a full ranking interactive. */
  maxSamplesPerSkill: 24,
} as const;

/**
 * Efficiency metric: horse lengths per this many skill points.
 * Skills with no published SP cost (uniques, scenario rewards) report no efficiency
 * rather than being given an invented cost.
 */
export const EFFICIENCY_SP_BASIS = 100;
