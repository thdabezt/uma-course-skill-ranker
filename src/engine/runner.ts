/**
 * Maps the app's race setup and runner build onto the engine's vocabulary.
 */
import type { RaceSetup, RunnerStats } from '@/simulation/types';
import type { Aptitude, Mood, RunningStyle, Season, TrackCondition, Weather } from '@/simulation/config';
import { MOOD_LEVEL } from '@/simulation/config';
import type { HorseDesc, PartialRaceParameters } from './vendor/RaceSolverBuilder';
import { Grade, GroundCondition, Season as EngineSeason, Time, Weather as EngineWeather, type Mood as EngineMood } from './vendor/RaceParameters';

/** Engine strategy names (uma-skill-tools uses the Japanese terms). */
export const STRATEGY_NAME: Record<RunningStyle, 'Nige' | 'Senkou' | 'Sasi' | 'Oikomi'> = {
  front_runner: 'Nige',
  pace_chaser: 'Senkou',
  late_surger: 'Sasi',
  end_closer: 'Oikomi',
};

/**
 * Global ground names: Firm / Good / Soft / Heavy correspond to the engine's
 * Good / Yielding / Soft / Heavy (JP 良 / 稍重 / 重 / 不良).
 */
export const GROUND_CONDITION: Record<TrackCondition, GroundCondition> = {
  firm: GroundCondition.Good,
  good: GroundCondition.Yielding,
  soft: GroundCondition.Soft,
  heavy: GroundCondition.Heavy,
};

export const ENGINE_WEATHER: Record<Weather, EngineWeather> = {
  sunny: EngineWeather.Sunny,
  cloudy: EngineWeather.Cloudy,
  rainy: EngineWeather.Rainy,
  snowy: EngineWeather.Snowy,
};

export const ENGINE_SEASON: Record<Season, EngineSeason> = {
  spring: EngineSeason.Spring,
  summer: EngineSeason.Summer,
  autumn: EngineSeason.Autumn,
  winter: EngineSeason.Winter,
  sakura: EngineSeason.Sakura,
};

/**
 * Assumed running position per style for `order` / `order_rate` conditions, as
 * umalator uses for its skill table (9-runner field).
 */
export const ORDER_RANGE_FOR_STYLE: Record<RunningStyle, [number, number]> = {
  front_runner: [1, 1],
  pace_chaser: [2, 4],
  late_surger: [5, 9],
  end_closer: [5, 9],
};

export const ASSUMED_FIELD_SIZE = 9;

export function toEngineMood(mood: Mood): EngineMood {
  return MOOD_LEVEL[mood] as EngineMood;
}

export function toHorseDesc(runner: RunnerStats): HorseDesc {
  return {
    speed: runner.speed,
    stamina: runner.stamina,
    power: runner.power,
    guts: runner.guts,
    wisdom: runner.wit,
    strategy: STRATEGY_NAME[runner.runningStyle],
    distanceAptitude: runner.distanceAptitude as Aptitude,
    surfaceAptitude: runner.surfaceAptitude as Aptitude,
    strategyAptitude: runner.styleAptitude as Aptitude,
    mood: toEngineMood(runner.mood),
    popularity: runner.popularity,
  };
}

export interface RaceDefinition extends PartialRaceParameters {
  orderRange?: [number, number];
  numUmas?: number;
}

export function toRaceDefinition(setup: RaceSetup, runner: RunnerStats, includeOrder = true): RaceDefinition {
  const def: RaceDefinition = {
    mood: toEngineMood(runner.mood),
    groundCondition: GROUND_CONDITION[setup.trackCondition],
    weather: ENGINE_WEATHER[setup.weather],
    season: ENGINE_SEASON[setup.season],
    time: Time.Midday,
    grade: Grade.G1,
    popularity: runner.popularity,
  };
  if (includeOrder) {
    def.orderRange = ORDER_RANGE_FOR_STYLE[runner.runningStyle];
    def.numUmas = ASSUMED_FIELD_SIZE;
  }
  return def;
}
