import { HorseParameters, Strategy, Aptitude } from './HorseTypes';
import { CourseData, CourseHelpers, DistanceType } from './CourseData';
import { Region, RegionList } from './Region';
import { PRNG, Rule30CARng } from './Random';
import { Conditions, random, immediate, noopRandom } from './ActivationConditions';
import { ActivationSamplePolicy, ImmediatePolicy, RandomPolicy } from './ActivationSamplePolicy';
import { getParser } from './ConditionParser';
import {
	RaceSolver, RaceState, PendingSkill, DynamicCondition, SkillType, SkillRarity, SkillEffect, SkillTarget, Perspective, FUNC_SCALING
} from './RaceSolver';
import { Mood, GroundCondition, Weather, Season, Time, Grade, RaceParameters } from './RaceParameters';
import { HpPolicy, GameHpPolicy, NoopHpPolicy } from './HpPolicy';

import { skills, type EngineSkillAlternative } from './data';

// Vendored from alpha123/uma-skill-tools (GPL-3.0-or-later). "GLOBAL BUNDLE" marks
// behaviour ported from the deployed umalator-global worker: unique-level scaling,
// per-effect target / scaling metadata, the second ("other") runner for debuff
// conditions, spot struggle and the raw-power Fully Charged hook.

export type PartialRaceParameters = Omit<{ -readonly [K in keyof RaceParameters]: RaceParameters[K] }, 'skillId' | 'otherHorse'>;

export interface HorseDesc {
	speed: number
	stamina: number
	power: number
	guts: number
	wisdom: number
	strategy: string | Strategy
	distanceAptitude: string | Aptitude
	surfaceAptitude: string | Aptitude
	strategyAptitude: string | Aptitude
	/** GLOBAL BUNDLE: the runner's own mood (-2..2); falls back to the race mood when absent. */
	mood?: Mood
	popularity?: number
}

const GroundSpeedModifier = Object.freeze([
	null, // ground types started at 1
	[0, 0, 0, 0, -50],
	[0, 0, 0, 0, -50]
].map(o => Object.freeze(o)));

const GroundPowerModifier = Object.freeze([
	null,
	[0, 0, -50, -50, -50],
	[0, -100, -50, -100, -100]
].map(o => Object.freeze(o)));

const StrategyProficiencyModifier = Object.freeze([1.1, 1.0, 0.85, 0.75, 0.6, 0.4, 0.2, 0.1]);

export namespace Asitame {
	export const StrategyDistanceCoefficient = Object.freeze([
		[],  // distances are 1-indexed (as are strategies, hence the 0 in the first column for every row)
		[0, 1.0, 0.7, 0.75,  0.7,  1.0],  // short (nige, senkou, sasi, oikomi, oonige)
		[0, 1.0, 0.8, 0.7,   0.75, 1.0],  // mile
		[0, 1.0, 0.9, 0.875, 0.86, 1.0],  // medium
		[0, 1.0, 0.9, 1.0,   0.9,  1.0]   // long
	]);

	export const BaseModifier = 0.00875;

	export function calcApproximateModifier(power: number, strategy: Strategy, distance: DistanceType) {
		return BaseModifier * Math.sqrt(power - 1200) * StrategyDistanceCoefficient[distance][strategy];
	}
}

export namespace StaminaSyoubu {
	export function distanceFactor(distance: number) {
		if (distance < 2101) return 0.0;
		else if (distance < 2201) return 0.5;
		else if (distance < 2401) return 1.0;
		else if (distance < 2601) return 1.2;
		else return 1.5;
	}

	export function calcApproximateModifier(stamina: number, distance: number) {
		const randomFactor = 1.0;  // TODO implement random factor scaling based on power (unclear how this works currently)
		return Math.sqrt(stamina - 1200) * 0.0085 * distanceFactor(distance) * randomFactor;
	}
}

export function parseStrategy(s: string | Strategy) {
	if (typeof s != 'string') {
		return s;
	}
	switch (s.toUpperCase()) {
	case 'NIGE': return Strategy.Nige;
	case 'SENKOU': return Strategy.Senkou;
	case 'SASI':
	case 'SASHI': return Strategy.Sasi;
	case 'OIKOMI': return Strategy.Oikomi;
	case 'OONIGE': return Strategy.Oonige;
	default: throw new Error('Invalid running strategy.');
	}
}

export function parseAptitude(a: string | Aptitude, type: string) {
	if (typeof a != 'string') {
		return a;
	}
	switch (a.toUpperCase()) {
	case 'S': return Aptitude.S;
	case 'A': return Aptitude.A;
	case 'B': return Aptitude.B;
	case 'C': return Aptitude.C;
	case 'D': return Aptitude.D;
	case 'E': return Aptitude.E;
	case 'F': return Aptitude.F;
	case 'G': return Aptitude.G;
	default: throw new Error('Invalid ' + type + ' aptitude.');
	}
}

export function parseGroundCondition(g: string | GroundCondition) {
	if (typeof g != 'string') {
		return g;
	}
	switch (g.toUpperCase()) {
	case 'GOOD': return GroundCondition.Good;
	case 'YIELDING': return GroundCondition.Yielding;
	case 'SOFT': return GroundCondition.Soft;
	case 'HEAVY': return GroundCondition.Heavy;
	default: throw new Error('Invalid ground condition.');
	}
}

export function parseWeather(w: string | Weather) {
	if (typeof w != 'string') {
		return w;
	}
	switch (w.toUpperCase()) {
	case 'SUNNY': return Weather.Sunny;
	case 'CLOUDY': return Weather.Cloudy;
	case 'RAINY': return Weather.Rainy;
	case 'SNOWY': return Weather.Snowy;
	default: throw new Error('Invalid weather.');
	}
}

export function parseSeason(s: string | Season) {
	if (typeof s != 'string') {
		return s;
	}
	switch (s.toUpperCase()) {
	case 'SPRING': return Season.Spring;
	case 'SUMMER': return Season.Summer;
	case 'AUTUMN': return Season.Autumn;
	case 'WINTER': return Season.Winter;
	case 'SAKURA': return Season.Sakura;
	default: throw new Error('Invalid season.');
	}
}

export function parseTime(t: string | Time) {
	if (typeof t != 'string') {
		return t;
	}
	switch (t.toUpperCase()) {
	case 'NONE': case 'NOTIME': return Time.NoTime;
	case 'MORNING': return Time.Morning;
	case 'MIDDAY': return Time.Midday;
	case 'EVENING': return Time.Evening;
	case 'NIGHT': return Time.Night;
	default: throw new Error('Invalid race time.');
	}
}

export function parseGrade(g: string | Grade) {
	if (typeof g != 'string') {
		return g;
	}
	switch (g.toUpperCase()) {
	case 'G1': return Grade.G1;
	case 'G2': return Grade.G2;
	case 'G3': return Grade.G3;
	case 'OP': return Grade.OP;
	case 'PRE-OP': case 'PREOP': return Grade.PreOP;
	case 'MAIDEN': return Grade.Maiden;
	case 'DEBUT': return Grade.Debut;
	case 'DAILY': return Grade.Daily;
	default: throw new Error('Invalid race grade.');
	}
}

function adjustOvercap(stat: number) {
	return stat > 1200 ? 1200 + Math.floor((stat - 1200) / 2) : stat;
}

export function buildBaseStats(horseDesc: HorseDesc, mood: Mood): HorseParameters {
	// GLOBAL BUNDLE: the runner's own mood wins over the race-wide one
	const effectiveMood = horseDesc.mood != null ? horseDesc.mood : mood;
	const motivCoef = 1 + 0.02 * effectiveMood;

	return Object.freeze({
		speed: adjustOvercap(horseDesc.speed) * motivCoef,
		stamina: adjustOvercap(horseDesc.stamina) * motivCoef,
		power: adjustOvercap(horseDesc.power) * motivCoef,
		guts: adjustOvercap(horseDesc.guts) * motivCoef,
		wisdom: adjustOvercap(horseDesc.wisdom) * motivCoef,
		strategy: parseStrategy(horseDesc.strategy),
		distanceAptitude: parseAptitude(horseDesc.distanceAptitude, 'distance'),
		surfaceAptitude: parseAptitude(horseDesc.surfaceAptitude, 'surface'),
		strategyAptitude: parseAptitude(horseDesc.strategyAptitude, 'strategy'),
		rawStamina: horseDesc.stamina * motivCoef,
		rawPower: horseDesc.power * motivCoef,
		mood: effectiveMood,
		popularity: horseDesc.popularity != null ? horseDesc.popularity : 1
	});
}

export function buildAdjustedStats(baseStats: HorseParameters, course: CourseData, ground: GroundCondition): HorseParameters {
	const raceCourseModifier = CourseHelpers.courseSpeedModifier(course, baseStats);

	return Object.freeze({
		speed: Math.max(baseStats.speed * raceCourseModifier + GroundSpeedModifier[course.surface]![ground], 1),
		stamina: baseStats.stamina,
		power: Math.max(baseStats.power + GroundPowerModifier[course.surface]![ground], 1),
		guts: baseStats.guts,
		wisdom: baseStats.wisdom * StrategyProficiencyModifier[baseStats.strategyAptitude],
		strategy: baseStats.strategy,
		distanceAptitude: baseStats.distanceAptitude,
		surfaceAptitude: baseStats.surfaceAptitude,
		strategyAptitude: baseStats.strategyAptitude,
		rawStamina: baseStats.rawStamina,
		rawPower: Math.max(baseStats.rawPower + GroundPowerModifier[course.surface]![ground], 1),
		mood: baseStats.mood,
		popularity: baseStats.popularity
	});
}

export { SkillTarget, Perspective, isTarget } from './RaceSolver';

export interface SkillData {
	skillId: string
	perspective: Perspective
	rarity: SkillRarity
	wisdomCheck: boolean | number  // 0/1 for table skills (EngineSkill.wisdomCheck); only truthiness is checked
	samplePolicy: ActivationSamplePolicy
	regions: RegionList
	extraCondition: DynamicCondition
	effects: SkillEffect[]
	tags: number[]
}

/**
 * GLOBAL BUNDLE: unique skill level (1-10, from the character's talent/limit-break
 * level) scales the effect value. Stats and speed/accel have their own tables,
 * everything else grows 2 % per level.
 */
const UniqueLevelStatScaling = Object.freeze([1, 1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08, 1.1]);
const UniqueLevelScaling: Readonly<Record<number, readonly number[]>> = Object.freeze({
	1: UniqueLevelStatScaling,
	2: UniqueLevelStatScaling,
	3: UniqueLevelStatScaling,
	4: UniqueLevelStatScaling,
	5: UniqueLevelStatScaling,
	27: Object.freeze([1, 1.01, 1.04, 1.07, 1.1, 1.13, 1.16, 1.19, 1.22, 1.25]),
	31: Object.freeze([1, 1.02, 1.04, 1.06, 1.08, 1.1, 1.125, 1.15, 1.175, 1.2])
});

export function uniqueLevelModifier(effectType: number, level: number) {
	return UniqueLevelScaling.hasOwnProperty(effectType) ? UniqueLevelScaling[effectType][level - 1] : 1 + (level - 1) * 0.02;
}

function buildSkillEffects(skill: EngineSkillAlternative, _perspective: Perspective, uniqueLv: number): SkillEffect[] {
	// GLOBAL BUNDLE: every effect is kept (unsupported types become Noop); the perspective /
	// target filter is applied when the skill activates, see RaceSolver.activateSkill.
	return skill.effects.map(ef => ({
		type: SkillType.hasOwnProperty(ef.type) ? ef.type as SkillType : SkillType.Noop,
		target: ef.target,
		baseDuration: skill.baseDuration / 10000,
		durationScaling: skill.durationScaling,
		modifier: ef.modifier / 10000 * uniqueLevelModifier(ef.type, uniqueLv),
		modifierScaling: ef.scaling
	}));
}

export function buildSkillData(
	horse: HorseParameters,
	otherHorse: HorseParameters,
	raceParams: PartialRaceParameters,
	course: CourseData,
	wholeCourse: RegionList,
	parser: {parse: any, tokenize: any},
	skillId: string,
	perspective: Perspective,
	uniqueLv: number = 1,
	ignoreNullEffects: boolean = false
): SkillData[] {
	if (!(skillId in skills)) {
		throw new Error('bad skill ID ' + skillId);
	}
	// GLOBAL BUNDLE: a skill added from the Other perspective is evaluated against the other runner
	const conditionHorse = perspective == Perspective.Other ? otherHorse : horse;
	const extra: RaceParameters = Object.assign({skillId, otherHorse: perspective == Perspective.Other ? horse : otherHorse}, raceParams);
	const alternatives = skills[skillId].alternatives;
	const triggers: SkillData[] = [];
	for (let i = 0; i < alternatives.length; ++i) {
		const skill = alternatives[i];
		let full = new RegionList();
		wholeCourse.forEach(r => full.push(r));
		if (skill.precondition) {
			const pre = parser.parse(parser.tokenize(skill.precondition));
			const preRegions = pre.apply(wholeCourse, course, conditionHorse, extra)[0];
			if (preRegions.length == 0) {
				continue;
			} else {
				const bounds = new Region(preRegions[0].start, wholeCourse[wholeCourse.length-1].end);
				full = full.rmap(r => r.intersect(bounds));
			}
		}

		const op = parser.parse(parser.tokenize(skill.condition));
		const [regions, extraCondition] = op.apply(full, course, conditionHorse, extra);
		if (regions.length == 0) {
			continue;
		}
		if (triggers.length > 0 && !/is_activate_other_skill_detail|is_used_skill_id/.test(skill.condition)) {
			// i don't like this at all. the problem is some skills with two triggers (for example all the is_activate_other_skill_detail ones)
			// need to place two triggers so the second effect can activate, however, some other skills with two triggers only ever activate one
			// even if they have non-mutually-exclusive conditions (for example Jungle Pocket unique). i am not currently sure what distinguishes
			// them in the game implementation. it's pretty inconsistent about whether double-trigger skills force the conditions to be mutually
			// exclusive or not even if it only wants one of them to activate; for example Daitaku Helios unique ensures the distance conditions
			// are mutually exclusive for both triggers but Jungle Pocket doesn't. for the time being we're only going to place the first trigger
			// unless the second one is explicitly is_activate_other_skill_detail or is_used_skill_id (need this for NY Ace).
			// !!! FIXME this is actually bugged for NY Ace unique since she'll get both effects if she uses oonige.
			continue;
		}
		const effects = buildSkillEffects(skill, perspective, uniqueLv);
		if (effects.length > 0 || ignoreNullEffects) {
			const rarity = skills[skillId].rarity;
			triggers.push({
				skillId: skillId,
				perspective: perspective,
				// for some reason 1*/2* uniques, 1*/2* upgraded to 3*, and naturally 3* uniques all have different rarity (3, 4, 5 respectively)
				rarity: rarity >= 3 && rarity <= 5 ? 3 : rarity,
				wisdomCheck: skills[skillId].wisdomCheck,
				samplePolicy: op.samplePolicy,
				regions: regions,
				extraCondition: extraCondition,
				effects: effects,
				tags: skills[skillId].tags
			});
		}
	}
	if (triggers.length > 0) return triggers;
	// if we get here, it means that no alternatives have their conditions satisfied for this course/horse.
	// however, for purposes of summer goldship unique (Adventure of 564), we still have to add something, since
	// that could still cause them to activate. so just add the first alternative at a location after the course
	// is over with a constantly false dynamic condition so that it never activates normally.
	const effects = buildSkillEffects(alternatives[0], perspective, uniqueLv);
	if (effects.length == 0 && !ignoreNullEffects) {
		return [];
	} else {
		const rarity = skills[skillId].rarity;
		const afterEnd = new RegionList();
		afterEnd.push(new Region(9999,9999));
		return [{
			skillId: skillId,
			perspective: perspective,
			rarity: rarity >= 3 && rarity <= 5 ? 3 : rarity,
			wisdomCheck: skills[skillId].wisdomCheck,
			samplePolicy: ImmediatePolicy,
			regions: afterEnd,
			extraCondition: (_: RaceState) => false,
			effects: effects,
			tags: skills[skillId].tags
		}];
	}
}

export const conditionsWithActivateCountsAsRandom = Object.freeze(Object.assign({}, Conditions, {
	activate_count_all: random({
		filterGte(regions: RegionList, n: number, course: CourseData, _1: HorseParameters, extra: RaceParameters) {
			// hard-code TM Opera O (NY) unique and Neo Universe unique to pretend they're immediate while allowing randomness for other skills
			// (conveniently the only two with n == 7)
			// ideally find a better solution
			if (n == 7) {
				const rl = new RegionList();
				// note that RandomPolicy won't sample within 10m from the end so this has to be +11
				regions.forEach(r => rl.push(new Region(r.start, r.start + 11)));
				return rl;
			}
			// somewhat arbitrarily decide you activate about 23 skills per race and then use a region n / 23 ± 20%
			const bounds = new Region(Math.min(n / 23.0 - 0.2, 0.6) * course.distance, Math.min(n / 23.0 + 0.2, 1.0) * course.distance);
			return regions.rmap(r => r.intersect(bounds));
		},
		filterLte(regions: RegionList, n: number, course: CourseData, _1: HorseParameters, extra: RaceParameters) {
			return new RegionList();  // tentatively, we're not really interested in the <= branch of these conditions
		}
	}),
	activate_count_end_after: random({
		filterGte(regions: RegionList, _0: number, course: CourseData, _1: HorseParameters, extra: RaceParameters) {
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, 2), CourseHelpers.phaseEnd(course.distance, 3));
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	activate_count_heal: noopRandom,
	activate_count_later_half: random({
		filterGte(regions: RegionList, _0: number, course: CourseData, _1: HorseParameters, extra: RaceParameters) {
			const bounds = new Region(course.distance / 2, course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	activate_count_middle: random({
		filterGte(regions: RegionList, n: number, course: CourseData, _1: HorseParameters, extra: RaceParameters) {
			const start = CourseHelpers.phaseStart(course.distance, 1), end = CourseHelpers.phaseEnd(course.distance, 1);
			const bounds = new Region(start, start + n / 10 * (end - start));
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	activate_count_start: immediate({  // for 地固め
		filterGte(regions: RegionList, _0: number, course: CourseData, _1: HorseParameters, extra: RaceParameters) {
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, 0), CourseHelpers.phaseEnd(course.distance, 0));
			return regions.rmap(r => r.intersect(bounds));
		}
	})
}));

const defaultParser = getParser();
const acrParser = getParser(conditionsWithActivateCountsAsRandom);

/** Skill tags for the synthetic pacer's opening-leg accel skills, when the table knows them. */
function tagsOf(skillId: string): number[] {
	return skills[skillId] ? skills[skillId].tags : [];
}

export class RaceSolverBuilder {
	_course: CourseData | null
	_raceParams: PartialRaceParameters
	_horse: HorseDesc | null
	_otherHorse: HorseDesc | null
	_pacer: HorseDesc | null
	_pacerSkills: PendingSkill[]
	_rng: Rule30CARng
	_parser: {parse: any, tokenize: any}
	_skills: {id: string, p: Perspective, lv: number}[]
	_wisdomSeeds: Map<string,[number,number]>
	_useWisdomChecks: boolean
	_hpPolicyFactory: (course: CourseData, params: PartialRaceParameters, rng: PRNG) => HpPolicy
	_samplePolicyOverride: (Map<string, ActivationSamplePolicy> | null)[]
	_extraSkillHooks: ((skilldata: SkillData[], horse: HorseParameters, course: CourseData) => void)[]
	_onSkillActivate: ((state: RaceSolver, skillId: string, perspective: Perspective) => void) | null
	_onSkillDeactivate: ((state: RaceSolver, skillId: string, perspective: Perspective) => void) | null

	constructor(readonly nsamples: number) {
		this._course = null;
		this._raceParams = {
			mood: 2,
			groundCondition: GroundCondition.Good,
			weather: Weather.Sunny,
			season: Season.Spring,
			time: Time.Midday,
			grade: Grade.G1,
			popularity: 1
		};
		this._horse = null;
		this._otherHorse = null;
		this._pacer = null;
		this._pacerSkills = [];
		this._rng = new Rule30CARng(Math.floor(Math.random() * (-1 >>> 0)) >>> 0);
		this._parser = defaultParser;
		this._skills = [];
		this._wisdomSeeds = new Map();
		this._useWisdomChecks = false;
		this._hpPolicyFactory = (course, params, rng) => new GameHpPolicy(course, params.groundCondition, rng);
		this._samplePolicyOverride = [null, new Map(), new Map(), new Map()];  // Perspectives start at 1
		this._extraSkillHooks = [];
		this._onSkillActivate = null;
		this._onSkillDeactivate = null;
	}

	seed(lo: number, hi: number = 0) {
		this._rng = new Rule30CARng(lo, hi);
		return this;
	}

	course(course: number | CourseData) {
		if (typeof course == 'number') {
			this._course = CourseHelpers.getCourse(course);
		} else {
			this._course = course;
		}
		return this;
	}

	mood(mood: Mood) {
		this._raceParams.mood = mood;
		return this;
	}

	ground(ground: string | GroundCondition) {
		this._raceParams.groundCondition = parseGroundCondition(ground);
		return this;
	}

	weather(weather: string | Weather) {
		this._raceParams.weather = parseWeather(weather);
		return this;
	}

	season(season: string | Season) {
		this._raceParams.season = parseSeason(season);
		return this;
	}

	time(time: string | Time) {
		this._raceParams.time = parseTime(time);
		return this;
	}

	grade(grade: string | Grade) {
		this._raceParams.grade = parseGrade(grade);
		return this;
	}

	popularity(popularity: number) {
		this._raceParams.popularity = popularity;
		return this;
	}

	order(start: number, end: number) {
		this._raceParams.orderRange = [start,end];
		return this;
	}

	numUmas(n: number) {
		this._raceParams.numUmas = n;
		return this;
	}

	horse(horse: HorseDesc) {
		this._horse = horse;
		return this;
	}

	/** GLOBAL BUNDLE: the runner debuff skills are evaluated against (defaults to ourselves). */
	otherHorse(horse: HorseDesc) {
		this._otherHorse = horse;
		return this;
	}

	pacer(horse: HorseDesc) {
		this._pacer = horse;
		return this;
	}

	_isNige() {
		if (typeof this._horse!.strategy == 'string') {
			return this._horse!.strategy.toUpperCase() == 'NIGE' || this._horse!.strategy.toUpperCase() == 'OONIGE';
		} else {
			return this._horse!.strategy == Strategy.Nige || this._horse!.strategy == Strategy.Oonige;
		}
	}

	useDefaultPacer(openingLegAccel: boolean = true) {
		if (this._isNige()) {
			return this;
		}

		this._pacer = Object.assign({}, this._horse!, {strategy: 'Nige'});
		if (openingLegAccel) {
			// top is jiga and bottom is white sente
			// arguably it's more realistic to include these, but also a lot of the time they prevent the exact pace down effects
			// that we're trying to investigate
			this._pacerSkills = [{
				skillId: '201601',
				perspective: Perspective.Self,
				rarity: SkillRarity.White,
				trigger: new Region(0, 100),
				extraCondition: (_) => true,
				effects: [{type: SkillType.Accel, target: SkillTarget.Self, baseDuration: 3.0, durationScaling: 1, modifier: 0.2, modifierScaling: 1}],
				tags: tagsOf('201601')
			}, {
				skillId: '200532',
				perspective: Perspective.Self,
				rarity: SkillRarity.White,
				trigger: new Region(0, 100),
				extraCondition: (_) => true,
				effects: [{type: SkillType.Accel, target: SkillTarget.Self, baseDuration: 1.2, durationScaling: 1, modifier: 0.2, modifierScaling: 1}],
				tags: tagsOf('200532')
			}];
		}
		return this;
	}

	hpPolicyFactory(fn: (course: CourseData, params: PartialRaceParameters, rng: PRNG) => HpPolicy) {
		this._hpPolicyFactory = fn;
		return this;
	}

	withActivateCountsAsRandom() {
		this._parser = acrParser;
		return this;
	}

	/**
	 * GLOBAL BUNDLE: spot struggle (位置取り争い). Front runners fight for the lead early:
	 * a target-speed boost of (500 * guts)^0.6 * 1e-4 m/s for sqrt(700 * guts) * 0.012 s,
	 * starting somewhere between 150 m and a quarter of the course, ending at the latest
	 * when section 8 is over, at a heavy HP cost (see GameHpPolicy.competeTopModifier).
	 */
	withItidoriarasoi() {
		const strategy = parseStrategy(this._horse!.strategy);
		if (strategy == Strategy.Nige || strategy == Strategy.Oonige) {
			this._extraSkillHooks.push((skilldata, _horse, course) => {
				const window = new RegionList();
				window.push(new Region(150, course.distance / 4));
				skilldata.push({
					skillId: 'itidoriarasoi',
					perspective: Perspective.Self,
					rarity: SkillRarity.White,
					wisdomCheck: false,
					regions: window,
					samplePolicy: RandomPolicy,
					extraCondition: (_) => true,
					effects: [{
						type: SkillType.TargetSpeed,
						target: SkillTarget.Self,
						baseDuration: 0,
						durationScaling: FUNC_SCALING,
						durationScalingFunc: (s) => Math.sqrt(700 * s.horse.guts) * 0.012,
						modifier: 0,
						modifierScaling: FUNC_SCALING,
						modifierScalingFunc: (s) => Math.pow(500 * s.horse.guts, 0.6) * 0.0001
					}],
					tags: []
				});
			});
		}
		return this;
	}

	/**
	 * Fully Charged (脚溜め / asitame): with displayed Power above 1200 the runner gets an
	 * extra 3 s of acceleration when the final leg begins.
	 * GLOBAL BUNDLE: the Power check uses the live raw (non-overcapped) power, so green
	 * skills that raise Power count.
	 */
	withAsiwotameru() {
		this._extraSkillHooks.push((skilldata, _horse, course) => {
			const spurtStart = new RegionList();
			spurtStart.push(new Region(CourseHelpers.phaseStart(course.distance, 2), course.distance));
			skilldata.push({
				skillId: 'asitame',
				perspective: Perspective.Self,
				rarity: SkillRarity.White,
				wisdomCheck: false,
				regions: spurtStart,
				samplePolicy: ImmediatePolicy,
				extraCondition: (s) => s.horse.rawPower > 1200,
				effects: [{
					type: SkillType.Accel,
					target: SkillTarget.Self,
					baseDuration: 3.0 / (course.distance / 1000.0),
					durationScaling: 1,
					modifier: 0,
					modifierScaling: FUNC_SCALING,
					modifierScalingFunc: (s) => Asitame.calcApproximateModifier(s.horse.rawPower, s.horse.strategy, s.course.distanceType)
				}],
				tags: []
			});
		});
		return this;
	}

	/** Stamina contest (持久力勝負). Not live on the Global server; kept for parity with upstream. */
	withStaminaSyoubu() {
		this._extraSkillHooks.push((skilldata, _horse, course) => {
			const spurtStart = new RegionList();
			spurtStart.push(new Region(CourseHelpers.phaseStart(course.distance, 2), course.distance));
			skilldata.push({
				skillId: 'staminasyoubu',
				perspective: Perspective.Self,
				rarity: SkillRarity.White,
				wisdomCheck: false,
				regions: spurtStart,
				samplePolicy: ImmediatePolicy,
				// TODO do current speed skills count toward reaching max speed or not?
				extraCondition: (s: RaceState) => s.horse.rawStamina > 1200 && s.currentSpeed >= s.lastSpurtSpeed,
				effects: [{
					type: SkillType.TargetSpeed,
					target: SkillTarget.Self,
					baseDuration: 9999.0,
					durationScaling: 1,
					modifier: 0,
					modifierScaling: FUNC_SCALING,
					modifierScalingFunc: (s) => StaminaSyoubu.calcApproximateModifier(s.horse.rawStamina, s.course.distance)
				}],
				tags: []
			});
		});
		return this;
	}

	/**
	 * App addition: registers a skill that is not in the data table (reference
	 * skills for the acceleration analysis). The factory runs once per build().
	 */
	addSyntheticSkill(make: (horse: HorseParameters, course: CourseData) => SkillData) {
		this._extraSkillHooks.push((skilldata, horse, course) => { skilldata.push(make(horse, course)); });
		return this;
	}

	withWisdomChecks(seeds: ReadonlyMap<string,[number,number]>) {
		this._useWisdomChecks = true;
		seeds.forEach((seed,id) => this._wisdomSeeds.set(id,seed));
		return this;
	}

	/** GLOBAL BUNDLE: `uniqueLv` (1-10) scales the effect values of a unique skill. */
	addSkill(skillId: string, perspective: Perspective = Perspective.Self, uniqueLv: number = 1, samplePolicy?: ActivationSamplePolicy) {
		this._skills.push({id: skillId, p: perspective, lv: uniqueLv});
		if (samplePolicy != null) {
			this._samplePolicyOverride[perspective]!.set(skillId, samplePolicy);
		}
		return this;
	}

	onSkillActivate(cb: (state: RaceSolver, skillId: string, perspective: Perspective) => void) {
		this._onSkillActivate = cb;
		return this;
	}

	onSkillDeactivate(cb: (state: RaceSolver, skillId: string, perspective: Perspective) => void) {
		this._onSkillDeactivate = cb;
		return this;
	}

	fork() {
		const clone = new RaceSolverBuilder(this.nsamples);
		clone._course = this._course;
		clone._raceParams = Object.assign({}, this._raceParams);
		clone._horse = this._horse;
		clone._otherHorse = this._otherHorse;
		clone._pacer = this._pacer;
		clone._pacerSkills = this._pacerSkills.slice();  // sharing the skill objects is fine but see the note below
		clone._rng = new Rule30CARng(this._rng.lo, this._rng.hi);
		clone._parser = this._parser;
		clone._skills = this._skills.slice();
		clone._useWisdomChecks = this._useWisdomChecks;
		clone._wisdomSeeds = new Map(this._wisdomSeeds.entries());
		clone._hpPolicyFactory = this._hpPolicyFactory;
		clone._samplePolicyOverride = this._samplePolicyOverride.map(m => m == null ? null : new Map(m.entries()));
		clone._onSkillActivate = this._onSkillActivate;
		clone._onSkillDeactivate = this._onSkillDeactivate;

		// NB. GOTCHA: if asitame is enabled, it closes over *our* horse and mood data, and not the clone's
		// this is assumed to be fine, since fork() is intended to be used after everything is added except skills,
		// but it does mean that if you want to compare different power stats or moods, you must call withAsiwotameru()
		// after fork() on each instance separately, which is a potential gotcha
		clone._extraSkillHooks = this._extraSkillHooks.slice();
		return clone;
	}

	*build(): Generator<RaceSolver, void, boolean | undefined> {
		let horse = buildBaseStats(this._horse!, this._raceParams.mood);
		let solverRng = new Rule30CARng(this._rng.int32());
		let pacerRng = new Rule30CARng(this._rng.int32());  // need this even if _pacer is null in case we forked from/to something with a pacer
															// (to keep the rngs in sync)

		const pacerHorse = this._pacer ? buildAdjustedStats(buildBaseStats(this._pacer, this._raceParams.mood), this._course!, this._raceParams.groundCondition) : null;

		const wholeCourse = new RegionList();
		wholeCourse.push(new Region(0, this._course!.distance));
		Object.freeze(wholeCourse);

		// GLOBAL BUNDLE: base (mood-adjusted, not course-adjusted) stats of the other runner
		const otherBase = buildBaseStats(this._otherHorse || this._horse!, this._raceParams.mood);
		// Self = 1, Other = 2, Any = 3
		// not clear that "always activate" is the correct behavior for Perspective.Any, however, that's not used under normal usage
		const skillActivationChance = [0.0, Math.max(1 - 90 / horse.wisdom, 0.2), Math.max(1 - 90 / otherBase.wisdom, 0.2), 1.0];

		const makeSkill = buildSkillData.bind(null, horse, otherBase, this._raceParams, this._course!, wholeCourse, this._parser);
		const skilldata = this._skills.flatMap(({id,p,lv}) => makeSkill(id, p, lv));
		this._extraSkillHooks.forEach(h => h(skilldata, horse, this._course!));
		// GLOBAL BUNDLE: one sampling seed pair per skill id (shared across perspectives) so adding or
		// removing another skill never shifts where this one activates
		const sampleSeeds = new Map<string, [number, number]>();
		const triggers = skilldata.map(sd => {
			const sp = this._samplePolicyOverride[sd.perspective]!.get(sd.skillId) || sd.samplePolicy;
			const known = sampleSeeds.get(sd.skillId);
			const seed: [number, number] = known != null ? known : this._rng.pair();
			if (known == null) sampleSeeds.set(sd.skillId, seed);
			return sp.sample(sd.regions, this.nsamples, new Rule30CARng(seed[0], seed[1]));
		});
		const wisdomRngs = new Map(Array.from(this._wisdomSeeds.entries()).map(([id,seed]) => [id,new Rule30CARng(...seed)]));

		// must come after skill activations are decided because conditions like base_power depend on base stats
		horse = buildAdjustedStats(horse, this._course!, this._raceParams.groundCondition);

		let lastskills: PendingSkill[] | null = null;
		for (let i = 0; i < this.nsamples; ++i) {
			let skills: PendingSkill[];
			if (lastskills != null) {
				skills = lastskills;
				lastskills = null;
			} else {
				skills = skilldata.map((sd,sdi) => ({
					skillId: sd.skillId,
					perspective: sd.perspective,
					rarity: sd.rarity,
					wisdomCheck: sd.wisdomCheck,
					trigger: triggers[sdi][i % triggers[sdi].length],
					extraCondition: sd.extraCondition,
					effects: sd.effects,
					tags: sd.tags
				})).filter(sd => !this._useWisdomChecks || !sd.wisdomCheck || wisdomRngs.get(sd.skillId)!.random() < skillActivationChance[sd.perspective]);
			}

			const backupPacerRng = new Rule30CARng(pacerRng.lo, pacerRng.hi);
			const backupSolverRng = new Rule30CARng(solverRng.lo, solverRng.hi);

			const pacer = pacerHorse ? new RaceSolver({
				horse: pacerHorse,
				course: this._course!,
				hp: NoopHpPolicy,
				skills: this._pacerSkills,
				rng: pacerRng
			}) : null;

			const redo = yield new RaceSolver({
				horse,
				course: this._course!,
				skills,
				pacer,
				hp: this._hpPolicyFactory(this._course!, this._raceParams, new Rule30CARng(solverRng.int32())),
				rng: solverRng,
				onSkillActivate: this._onSkillActivate,
				onSkillDeactivate: this._onSkillDeactivate
			});

			if (redo) {
				--i;
				pacerRng = backupPacerRng;
				solverRng = backupSolverRng;
				lastskills = skills;
			}
		}
	}
}
