/**
 * What a skill needs beyond the course, in plain words.
 *
 * Two kinds of condition cannot be settled by the course alone:
 *
 * - **assumed** requirements the single-runner simulation cannot produce (skill
 *   counters, "another skill just fired", popularity, gate, a rival in the field,
 *   anything about other runners). The engine treats them as satisfied (see
 *   src/engine/requirements.ts), so the value is conditional on them and the row
 *   says so.
 * - **modelled** requirements the simulation rolls itself (rushing, the start,
 *   HP, dice); they explain a fire rate below 100 %.
 *
 * The same file explains why a skill can never fire here, naming the condition
 * that fails (distance category, surface, track, ...).
 */
import { characters, conditionDocByName, courses } from '@/data';
import { DISTANCE_CATEGORY_LABELS } from '@/courses/distanceCategory';
import { assumedParser } from '@/engine/requirements';
import { buildBaseStats } from '@/engine/vendor/RaceSolverBuilder';
import type { HorseParameters } from '@/engine/vendor/HorseTypes';
import type { RaceParameters } from '@/engine/vendor/RaceParameters';
import { Region, RegionList } from '@/engine/vendor/Region';
import { MOOD_LABELS, RUNNING_STYLE_LABELS, SEASON_LABELS, TRACK_CONDITION_LABELS, WEATHER_LABELS } from '@/simulation/config';
import type { Skill, SkillConditionGroup } from '@/simulation/types';
import { parseCondition, type ConditionTerm } from '@/skills/conditionParser';
import type { AnalysisContext } from './skillAnalysis';

export interface Requirements {
  /** Assumed to hold; the number is conditional on them. */
  assumed: string[];
  /** Rolled by the simulation; they explain a fire rate below 100 %. */
  modelled: string[];
}

export const NO_REQUIREMENTS: Requirements = { assumed: [], modelled: [] };

const STYLE_CODE: Record<string, number> = { front_runner: 1, pace_chaser: 2, late_surger: 3, end_closer: 4 };
const STYLE_BY_CODE: Record<number, string> = { 1: 'Front Runner', 2: 'Pace Chaser', 3: 'Late Surger', 4: 'End Closer' };
const ASSUMED_POSITION: Record<string, string> = {
  front_runner: '1st',
  pace_chaser: '2nd-4th of 9',
  late_surger: '5th-9th of 9',
  end_closer: '5th-9th of 9',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
const secs = (n: number) => `${n} s`;
const lengths = (n: number) => `${n} length${n === 1 ? '' : 's'}`;
const isUpper = (t: ConditionTerm) => t.operator === '<=' || t.operator === '<';

type Describer = (t: ConditionTerm) => string;

const rushingStyle = (style: string) => () => `a rushing ${style}`;

/** Conditions the engine assumes to hold, and how to say so. */
const ASSUMED: Record<string, Describer> = {
  activate_count_all: (t) => (isUpper(t) ? `at most ${plural(t.value, 'skill')} activated earlier` : `${plural(t.value, 'skill')} activated earlier in the race`),
  activate_count_heal: (t) => (t.value === 1 ? 'a recovery skill activated earlier' : `${plural(t.value, 'recovery skill')} activated earlier`),
  activate_count_start: (t) => `${plural(t.value, 'skill')} activated in the opening leg`,
  activate_count_middle: (t) => `${plural(t.value, 'skill')} activated mid-race`,
  activate_count_later_half: (t) => `${plural(t.value, 'skill')} activated in the second half`,
  activate_count_end_after: (t) => `${plural(t.value, 'skill')} activated in the final leg`,
  is_activate_any_skill: () => 'another skill activating inside its zone (valued as if at the zone start)',
  is_activate_heal_skill: () => 'a recovery skill activating inside its zone',
  popularity: (t) => {
    if (t.operator === '==') return t.value === 1 ? 'being the favourite' : `being the ${ordinal(t.value)} favourite`;
    if (t.operator === '<=') return t.value === 1 ? 'being the favourite' : `being among the top ${t.value} favourites`;
    if (t.operator === '<') return t.value === 2 ? 'being the favourite' : `being among the top ${t.value - 1} favourites`;
    if (t.operator === '>=') return `being ${ordinal(t.value)} favourite or lower`;
    if (t.operator === '>') return `being ${ordinal(t.value + 1)} favourite or lower`;
    return `not being the ${ordinal(t.value)} favourite`;
  },
  post_number: (t) => {
    if (t.operator === '==') return `gate ${t.value}`;
    if (t.operator === '<=') return t.value === 1 ? 'gate 1' : `gate 1-${t.value}`;
    if (t.operator === '<') return t.value === 2 ? 'gate 1' : `gate 1-${t.value - 1}`;
    if (t.operator === '>=') return `gate ${t.value} or higher`;
    if (t.operator === '>') return `gate ${t.value + 1} or higher`;
    return `any gate but ${t.value}`;
  },
  is_exist_chara_id: (t) => `${characters.find((c) => c.charId === t.value)?.name ?? `character ${t.value}`} in the race`,
  remain_distance_viewer_id: (t) => (isUpper(t) ? `a player's runner inside the last ${t.value} m` : `no player's runner inside the last ${t.value} m yet`),
  distance_diff_top: (t) => (isUpper(t) ? `being within ${t.value} m of the leader` : `being at least ${t.value} m behind the leader`),
  distance_diff_top_float: (t) => (isUpper(t) ? `being within ${t.value} m of the leader` : `being at least ${t.value} m behind the leader`),
  distance_diff_rate: (t) => (isUpper(t) ? `being in the front ${t.value}% of the field's spread` : `being in the back ${100 - t.value}% of the field's spread`),
  is_behind_in: () => 'the runner behind being closer to the inner fence',
  lane_type: (t) => (t.value === 0 ? 'running along the inner fence' : 'running away from the inner fence'),
  same_skill_horse_count: (t) => (t.value <= 1 && t.operator !== '>=' && t.operator !== '>' ? 'no other runner with this skill' : `${plural(t.value, 'runner')} with this skill`),
  running_style_count_same: (t) => (t.value <= 1 && isUpper(t) ? 'no other runner with the same running style' : `${plural(t.value, 'runner')} with the same running style`),
  running_style_count_same_rate: (t) => `at least ${t.value}% of the field sharing the running style`,
  running_style_count_nige_otherself: () => 'another front runner in the race',
  running_style_count_senko_otherself: () => 'another pace chaser in the race',
  running_style_count_sashi_otherself: () => 'another late surger in the race',
  running_style_count_oikomi_otherself: () => 'another end closer in the race',
  running_style_equal_popularity_one: () => 'the favourite sharing the running style',
  visiblehorse: () => 'another runner in sight',
  is_exist_skill_id: () => 'a runner with a specific skill in the race',
  is_other_character_activate_advantage_skill: (t) => (t.value === 9 ? 'another runner activating a recovery skill' : 'another runner activating a skill'),
  is_popularity_top_character_activate_advantage_skill: () => 'the favourite activating a skill',
  // Modelled by activation-point distributions (umalator's approach); still something the field has to provide.
  is_overtake: () => 'overtaking another runner',
  change_order_onetime: (t) => (isUpper(t) ? 'moving up a place' : 'losing a place'),
  change_order_up_end_after: (t) => `passing ${plural(t.value, 'runner')} in the final leg`,
  change_order_up_finalcorner_after: (t) => `passing ${plural(t.value, 'runner')} after the final corner`,
  change_order_up_middle: (t) => `passing ${plural(t.value, 'runner')} mid-race`,
  bashin_diff_behind: (t) => (isUpper(t) ? `a runner within ${lengths(t.value)} behind` : `a lead of at least ${lengths(t.value)} over the runner behind`),
  bashin_diff_infront: (t) => (isUpper(t) ? `being within ${lengths(t.value)} of the runner ahead` : `being at least ${lengths(t.value)} behind the runner ahead`),
  blocked_front: () => 'being blocked in front',
  blocked_front_continuetime: (t) => `being blocked in front for ${secs(t.value)}`,
  blocked_side_continuetime: (t) => `being blocked on the side for ${secs(t.value)}`,
  blocked_all_continuetime: (t) => `being boxed in for ${secs(t.value)}`,
  is_surrounded: () => 'being surrounded',
  near_count: (t) => `${plural(t.value, 'runner')} nearby`,
  near_infront_count: (t) => `${plural(t.value, 'runner')} close ahead`,
  overtake_target_time: (t) => `being an overtake target for ${secs(t.value)}`,
  overtake_target_no_order_up_time: (t) => `chasing a runner for ${secs(t.value)} without passing`,
  is_move_lane: () => 'changing lanes',
  infront_near_lane_time: (t) => `a runner right ahead for ${secs(t.value)}`,
  behind_near_lane_time: (t) => `a runner right behind for ${secs(t.value)}`,
  behind_near_lane_time_set1: (t) => `a runner right behind for ${secs(t.value)}`,
  compete_fight_count: () => 'a showdown on the final straight',
  temptation_count_behind: () => 'a rushing runner behind',
  temptation_count_infront: () => 'a rushing runner ahead',
  temptation_opponent_count_behind: () => 'a rushing runner behind',
  temptation_opponent_count_infront: () => 'a rushing runner ahead',
  running_style_temptation_count_nige: rushingStyle('front runner'),
  running_style_temptation_count_senko: rushingStyle('pace chaser'),
  running_style_temptation_count_sashi: rushingStyle('late surger'),
  running_style_temptation_count_oikomi: rushingStyle('end closer'),
  running_style_temptation_opponent_count_nige: rushingStyle('front runner'),
  running_style_temptation_opponent_count_senko: rushingStyle('pace chaser'),
  running_style_temptation_opponent_count_sashi: rushingStyle('late surger'),
  running_style_temptation_opponent_count_oikomi: rushingStyle('end closer'),
};

/** Conditions the simulation rolls itself. */
const MODELLED: Record<string, Describer> = {
  temptation_count: (t) => (t.value === 0 ? 'not rushing' : 'having rushed'),
  is_temptation: (t) => (t.value === 0 ? 'not rushing' : 'rushing'),
  is_badstart: (t) => (t.value === 0 ? 'a clean start (reaction within 0.08 s)' : 'a late start'),
  hp_per: (t) => (isUpper(t) ? `HP at or below ${t.value}%` : `HP at or above ${t.value}%`),
  is_hp_empty_onetime: () => 'running out of HP',
  random_lot: (t) => `a ${t.value}% roll`,
  lastspurt: (t) => (t.value === 2 ? 'enough HP for a full spurt' : 'a shortened spurt'),
};

const COUNTER_NAMES = /^activate_count_/;

function termsOf(group: SkillConditionGroup): ConditionTerm[] {
  return [...parseCondition(group.condition), ...parseCondition(group.precondition)].flatMap((c) => c.terms);
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

/** Requirements of the condition group the engine actually placed (`SkillData.alternative`). */
export function requirementsOf(skill: Skill, alternative: number): Requirements {
  const group = skill.conditionGroups[alternative] ?? skill.conditionGroups[0];
  if (!group) return NO_REQUIREMENTS;
  const terms = termsOf(group);
  const assumed = uniq(
    terms.map((t) => {
      const text = ASSUMED[t.name]?.(t);
      if (!text) return '';
      // A counter with a weaker sibling variant: say what happens below the count.
      if (COUNTER_NAMES.test(t.name) && !isUpper(t)) {
        const weaker = skill.conditionGroups.findIndex((g, j) => j !== alternative && termsOf(g).some((u) => u.name === t.name && isUpper(u)));
        if (weaker >= 0) return `${text} (with fewer, variant ${weaker + 1} fires instead)`;
      }
      return text;
    }),
  ).filter(Boolean);
  const modelled = uniq(terms.map((t) => MODELLED[t.name]?.(t) ?? '')).filter(Boolean);
  return { assumed, modelled };
}

const DISTANCE_TYPE: Record<number, string> = { 1: 'Sprint', 2: 'Mile', 3: 'Medium', 4: 'Long' };
const GROUND_TYPE: Record<number, string> = { 1: 'Turf', 2: 'Dirt' };
const GROUND_CONDITION: Record<number, string> = { 1: 'Firm', 2: 'Good', 3: 'Soft', 4: 'Heavy' };
const WEATHER: Record<number, string> = { 1: 'Sunny', 2: 'Cloudy', 3: 'Rainy', 4: 'Snowy' };
const SEASON: Record<number, string> = { 1: 'Spring', 2: 'Summer', 3: 'Autumn', 4: 'Winter', 5: 'Cherry blossom' };
const ROTATION: Record<number, string> = { 1: 'right-handed (clockwise)', 2: 'left-handed', 4: 'straight' };
const TIME: Record<number, string> = { 1: 'morning', 2: 'midday', 3: 'evening', 4: 'night' };
const GRADE: Record<number, string> = { 100: 'G1', 200: 'G2', 300: 'G3', 400: 'OP', 700: 'Pre-OP', 800: 'Maiden', 900: 'Debut', 999: 'Daily' };
const DIRECTION: Record<string, string> = { right: 'right-handed', left: 'left-handed', straight: 'a straight course' };

const list = (xs: string[], word = 'or') => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${word} ${xs[xs.length - 1]}`);
const label = (map: Record<number, string>, v: number) => map[v] ?? String(v);

/** Why a group of failing static terms (same condition name) rules the skill out. */
function describeStaticFailure(ctx: AnalysisContext, name: string, terms: ConditionTerm[]): string {
  const values = uniq(terms.map((t) => String(t.value))).map(Number);
  const first = terms[0];
  const course = ctx.setup.course;
  switch (name) {
    case 'distance_type':
      return `${list(values.map((v) => label(DISTANCE_TYPE, v)))} races only; this is a ${DISTANCE_CATEGORY_LABELS[course.distanceCategory]} race`;
    case 'ground_type':
      return `${list(values.map((v) => label(GROUND_TYPE, v)))} only; this course is ${course.surface}`;
    case 'track_id':
      return `only at ${list(values.map((v) => courses.find((c) => c.trackId === v)?.trackName ?? `track ${v}`))}; this is ${course.trackName}`;
    case 'ground_condition':
      return `${list(values.map((v) => label(GROUND_CONDITION, v)))} ground only; the setup is ${TRACK_CONDITION_LABELS[ctx.setup.trackCondition]}`;
    case 'weather':
      return `${list(values.map((v) => label(WEATHER, v)))} weather only; the setup is ${WEATHER_LABELS[ctx.setup.weather]}`;
    case 'season':
      return `${list(values.map((v) => label(SEASON, v)))} only; the setup is ${SEASON_LABELS[ctx.setup.season]}`;
    case 'rotation':
      return `${list(values.map((v) => label(ROTATION, v)))} tracks only; this course is ${DIRECTION[course.direction] ?? course.direction}`;
    case 'time':
      return `${list(values.map((v) => label(TIME, v)))} races only; the analysis races at midday`;
    case 'grade':
      return `grade ${list(values.map((v) => label(GRADE, v)))} only; the analysis races a G1`;
    case 'is_basis_distance':
      return first.value === 1
        ? `standard distances only (multiples of 400 m); ${course.distance} m is not one`
        : `non-standard distances only; ${course.distance} m is a standard distance`;
    case 'is_dirtgrade':
      return first.operator === '!='
        ? 'not in exchange races (Ooi, Kawasaki, Funabashi, Morioka)'
        : 'exchange races only (Ooi, Kawasaki, Funabashi, Morioka)';
    case 'base_power':
      return `Power ${first.operator} ${first.value} needed; the build has ${ctx.runner.power}`;
    case 'base_speed':
      return `Speed ${first.operator} ${first.value} needed; the build has ${ctx.runner.speed}`;
    case 'motivation':
      return `mood ${first.value >= 5 ? 'Great' : first.value >= 4 ? 'Good or better' : `level ${first.value}`} needed; the build's mood is ${MOOD_LABELS[ctx.runner.mood]}`;
    case 'slope':
      return first.value === 1 ? 'no uphill on this course' : first.value === 2 ? 'no downhill on this course' : 'no flat stretch on this course';
    case 'up_slope_random':
      return 'no uphill on this course';
    case 'down_slope_random':
      return 'no downhill on this course';
    case 'corner':
      return first.operator === '==' && first.value === 0 ? 'no straight on this course' : 'no such corner on this course';
    case 'is_finalcorner':
    case 'is_finalcorner_random':
    case 'is_finalcorner_laterhalf':
    case 'all_corner_random':
    case 'corner_random':
    case 'phase_corner_random':
      return 'no corner on this course';
    case 'straight_random':
    case 'is_last_straight':
    case 'is_last_straight_onetime':
    case 'last_straight_random':
      return 'no straight on this course';
    case 'straight_front_type':
      return first.value === 1 ? 'no home straight on this course' : 'no such straight on this course';
    default: {
      const doc = conditionDocByName.get(name);
      return `${first.raw} cannot hold here${doc ? ` (${doc.description.replace(/\.$/, '')})` : ''}`;
    }
  }
}

/** Whether one term, on its own, leaves any part of the course open. */
function termHolds(ctx: AnalysisContext, term: ConditionTerm, horse: HorseParameters, extra: RaceParameters): boolean {
  try {
    const op = assumedParser.parse(assumedParser.tokenize(term.raw));
    const whole = new RegionList();
    whole.push(new Region(0, ctx.course.distance));
    const [regions] = op.apply(whole, ctx.course, horse, extra) as [RegionList, unknown];
    return regions.length > 0;
  } catch {
    return false;
  }
}

function groupNeverReason(ctx: AnalysisContext, skill: Skill, group: SkillConditionGroup, horse: HorseParameters, extra: RaceParameters): string {
  const clauses = parseCondition(group.condition);
  const style = RUNNING_STYLE_LABELS[ctx.runner.runningStyle];
  const styleCode = STYLE_CODE[ctx.runner.runningStyle];

  // Every clause pins another running style.
  const styleTerms = clauses.map((c) => c.terms.find((t) => t.name === 'running_style'));
  if (clauses.length && styleTerms.every((t) => t && ((t.operator === '==' && t.value !== styleCode) || (t.operator === '!=' && t.value === styleCode)))) {
    const wanted = uniq(styleTerms.map((t) => (t!.operator === '==' ? (STYLE_BY_CODE[t!.value] ?? String(t!.value)) : `not ${style}`)));
    return `Restricted to ${wanted.join(' / ')}; the runner is a ${style}.`;
  }

  const terms = termsOf(group);
  if (ctx.options.assumePosition !== false && terms.some((t) => t.name === 'order' || t.name === 'order_rate')) {
    return `Its running-position condition cannot hold for a ${style} (assumed ${ASSUMED_POSITION[ctx.runner.runningStyle] ?? ''}). Turn off "Assume position from style" in the Stamina tab to evaluate it anyway.`;
  }

  // Static terms that fail on their own, grouped by condition name.
  const failing = new Map<string, ConditionTerm[]>();
  for (const t of terms) {
    if (termHolds(ctx, t, horse, extra)) continue;
    if (!failing.has(t.name)) failing.set(t.name, []);
    failing.get(t.name)!.push(t);
  }
  if (failing.size) {
    return `${uniq([...failing.entries()].map(([name, ts]) => describeStaticFailure(ctx, name, ts))).join('; ')}.`;
  }
  const names = uniq(terms.map((t) => t.name)).filter((n) => !['running_style', 'order', 'order_rate'].includes(n));
  return `Its zone (${names.join(' & ')}) does not exist on this course: those conditions never overlap here.`;
}

/** Why a skill can never fire on this course for this runner, one reason per variant. */
export function explainNever(ctx: AnalysisContext, skill: Skill): string {
  const horse = buildBaseStats(ctx.horse, ctx.racedef.mood);
  const extra = { skillId: String(skill.id), otherHorse: horse, ...ctx.racedef } as RaceParameters;
  const groups = skill.conditionGroups;
  if (!groups.length) return 'It has no usable condition.';
  const reasons = groups.map((g, i) => {
    const reason = groupNeverReason(ctx, skill, g, horse, extra);
    return groups.length > 1 ? `Variant ${i + 1}: ${reason}` : reason;
  });
  return uniq(reasons).join(' ');
}
