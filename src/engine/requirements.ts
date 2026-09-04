/**
 * Condition table for the skill analysis.
 *
 * A paired comparison races one runner with one skill, so conditions that count
 * other skills ("7 skills activated"), watch for another skill firing, or read the
 * race entry (popularity, gate, a named rival) can never hold in it, and the skill
 * would score zero for a reason that has nothing to do with the course. This table
 * treats those conditions as satisfied: the skill is valued on the assumption that
 * its requirement is met, and src/analysis/requirements.ts spells the assumption
 * out next to the number.
 *
 * Activation counters use umalator's own "activate counts as random" placement:
 * "7 skills activated" fires at the start of its zone (TM Opera O / Neo Universe
 * style), other counters at a random point of the stretch where the Nth skill
 * plausibly fires. The "at most N" branch of such a counter is left unsatisfiable
 * so a skill with a strong and a weak variant is valued on the strong one.
 */
import { noopImmediate, noopRandom, type Condition } from './vendor/ActivationConditions';
import { getParser } from './vendor/ConditionParser';
import { conditionsWithActivateCountsAsRandom } from './vendor/RaceSolverBuilder';

/** Condition names the analysis assumes to hold (beyond the activation counters). */
export const ASSUMED_CONDITION_NAMES = [
  'is_activate_any_skill',
  'is_activate_heal_skill',
  'popularity',
  'post_number',
  'is_exist_chara_id',
  'remain_distance_viewer_id',
] as const;

/** Conditions on other runners that the public table does not know; modelled like their non-opponent twins. */
const OPPONENT_RUSH_CONDITIONS = [
  'temptation_opponent_count_behind',
  'temptation_opponent_count_infront',
  'running_style_temptation_opponent_count_nige',
  'running_style_temptation_opponent_count_senko',
  'running_style_temptation_opponent_count_sashi',
  'running_style_temptation_opponent_count_oikomi',
] as const;

export const ASSUMED_CONDITIONS: { [cond: string]: Condition } = Object.freeze({
  ...conditionsWithActivateCountsAsRandom,
  ...Object.fromEntries(ASSUMED_CONDITION_NAMES.map((name) => [name, noopImmediate])),
  ...Object.fromEntries(OPPONENT_RUSH_CONDITIONS.map((name) => [name, noopRandom])),
});

export const assumedParser = getParser(ASSUMED_CONDITIONS);
