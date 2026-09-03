import { assert } from './assert';

export enum Strategy { Nige = 1, Senkou, Sasi, Oikomi, Oonige }
export enum Aptitude { S, A, B, C, D, E, F, G }

export interface HorseParameters {
	readonly speed: number
	readonly stamina: number
	readonly power: number
	readonly guts: number
	readonly wisdom: number
	readonly strategy: Strategy
	readonly distanceAptitude: Aptitude
	readonly surfaceAptitude: Aptitude
	readonly strategyAptitude: Aptitude
	/** Mood-adjusted stamina WITHOUT the 1200 overcap halving; used by the >1200 stamina mechanics. */
	readonly rawStamina: number
	/** GLOBAL BUNDLE: mood-adjusted power without the overcap halving; drives Fully Charged (asitame). */
	readonly rawPower: number
	/** GLOBAL BUNDLE: carried for conditions that read the runner's own mood / popularity. */
	readonly mood: number
	readonly popularity: number
}

export namespace StrategyHelpers {
	export function assertIsStrategy(strategy: number): asserts strategy is Strategy {
		assert(Strategy.hasOwnProperty(strategy));
	}

	export function strategyMatches(s1: Strategy, s2: Strategy) {
		return s1 == s2 || (s1 == Strategy.Nige && s2 == Strategy.Oonige) || (s1 == Strategy.Oonige && s2 == Strategy.Nige);
	}
}
