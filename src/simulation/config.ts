/**
 * Runner vocabulary, labels and defaults.
 *
 * The race model itself lives in the vendored uma-tools engine
 * (src/engine/vendor); nothing here is a simulation constant any more.
 */

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

export const RUNNING_STYLES: RunningStyle[] = ['front_runner', 'pace_chaser', 'late_surger', 'end_closer'];

export const APTITUDES: Aptitude[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];

export const MOODS: Mood[] = ['great', 'good', 'normal', 'bad', 'awful'];

export const MOOD_LABELS: Record<Mood, string> = {
  great: 'Great',
  good: 'Good',
  normal: 'Normal',
  bad: 'Bad',
  awful: 'Awful',
};

/** Mood (motivation) level: every stat is multiplied by `1 + 0.02 * level`. */
export const MOOD_LEVEL: Record<Mood, number> = {
  great: 2,
  good: 1,
  normal: 0,
  bad: -1,
  awful: -2,
};

export const TRACK_CONDITION_LABELS: Record<TrackCondition, string> = {
  firm: 'Firm',
  good: 'Good',
  soft: 'Soft',
  heavy: 'Heavy',
};

export const WEATHER_LABELS: Record<Weather, string> = {
  sunny: 'Sunny',
  cloudy: 'Cloudy',
  rainy: 'Rainy',
  snowy: 'Snowy',
};

export const SEASON_LABELS: Record<Season, string> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
  sakura: 'Cherry blossom',
};

/** Raw game values: effects are stored x10000, recovery as a share of max HP x10000. */
export const EFFECT_VALUE_SCALE = 10000;
export const RECOVERY_VALUE_SCALE = 10000;
/** Skill durations scale with the course: `baseSeconds * distance / 1000`. */
export const DURATION_DISTANCE_REFERENCE = 1000;

/** Efficiency metric: horse lengths per this many skill points. */
export const EFFICIENCY_SP_BASIS = 100;

export interface RunnerConfig {
  /** Displayed stats, before mood / track-condition / aptitude modifiers. */
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  wit: number;
  mood: Mood;
  distanceAptitude: Aptitude;
  surfaceAptitude: Aptitude;
  styleAptitude: Aptitude;
  runningStyle: RunningStyle;
  /** Kept for compatibility with saved state; the engine rolls Wit itself when asked to. */
  skillActivationRate: number | null;
  startDelaySeconds: number;
  /** Gate number, for `post_number` conditions. */
  postNumber: number;
  /** Popularity rank, for `popularity` conditions. */
  popularity: number;
}

/**
 * The reference runner every figure is computed against: umalator-global's
 * default Global build (stat caps were raised above 1200 in July 2026).
 */
export const DEFAULT_RUNNER: RunnerConfig = {
  speed: 1600,
  stamina: 1300,
  power: 1100,
  guts: 800,
  wit: 1100,
  mood: 'great',
  distanceAptitude: 'S',
  surfaceAptitude: 'A',
  styleAptitude: 'A',
  runningStyle: 'pace_chaser',
  skillActivationRate: null,
  startDelaySeconds: 0,
  postNumber: 5,
  popularity: 1,
};

/** Wit -> skill activation rate, as the game rolls it: `max(1 - 90 / wit, 0.2)`. */
export function witSkillProcRate(wit: number): number {
  if (wit <= 0) return 0.2;
  return Math.max(1 - 90 / wit, 0.2);
}
