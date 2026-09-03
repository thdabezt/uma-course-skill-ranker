import type { HorseParameters } from './HorseTypes';

export type Mood = -2 | -1 | 0 | 1 | 2;
export enum GroundCondition { Good = 1, Yielding, Soft, Heavy }
export enum Weather { Sunny = 1, Cloudy, Rainy, Snowy }
export enum Season { Spring = 1, Summer, Autumn, Winter, Sakura }
export enum Time { NoTime, Morning, Midday, Evening, Night }
export enum Grade { G1 = 100, G2 = 200, G3 = 300, OP = 400, PreOP = 700, Maiden = 800, Debut = 900, Daily = 999 }

export interface RaceParameters {
	readonly mood: Mood
	readonly groundCondition: GroundCondition
	readonly weather: Weather
	readonly season: Season
	readonly time: Time
	readonly grade: Grade
	readonly popularity: number
	readonly orderRange?: [number, number]
	readonly numUmas?: number
	readonly skillId: string
	/**
	 * GLOBAL BUNDLE: the runner on the other side of a debuff. Conditions such as
	 * running_style_count_nige_otherself read the OTHER runner's strategy; when a
	 * skill is added from the Self perspective this is the opponent, when added from
	 * the Other perspective it is ourselves.
	 */
	readonly otherHorse: HorseParameters
}
