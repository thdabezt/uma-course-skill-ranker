/**
 * Classifies each activation condition term and, where the term describes a race
 * *event*, produces a predicate the simulator can test every frame.
 *
 * The distinction that matters: a `*_random` term genuinely picks a uniformly
 * random point inside a course region, so sampling positions is correct. A term
 * like `is_overtake` or `order<=3` describes an event, and uniform sampling is
 * wrong for it - the skill fires at the moment the event happens.
 */

import { RACE_FIELD } from '@/simulation/config';
import type { ConditionContext } from '@/simulation/types';
import { compare, type ConditionTerm } from './conditionParser';

export type ActivationModel =
  | 'guaranteed'
  | 'random_region'
  | 'rank_event'
  | 'overtake_event'
  | 'order_change_event'
  | 'nearby_runner_event'
  | 'lead_distance_event'
  | 'start_event'
  | 'stamina_event'
  | 'unsupported';

export type ValueConfidence = 'deterministic' | 'simulated' | 'estimated' | 'unsupported';

export type TermPredicate = (ctx: ConditionContext) => boolean;

export interface EventTerm {
  name: string;
  model: ActivationModel;
  predicate: TermPredicate;
  description: string;
}

/** Terms that describe a race event and must never be uniformly sampled. */
const EVENT_MODELS: Record<string, ActivationModel> = {
  order: 'rank_event',
  order_rate: 'rank_event',
  order_rate_in20_continue: 'rank_event',
  order_rate_in50_continue: 'rank_event',
  order_rate_in80_continue: 'rank_event',
  order_rate_out40_continue: 'rank_event',
  order_rate_out50_continue: 'rank_event',
  order_rate_out70_continue: 'rank_event',
  is_overtake: 'overtake_event',
  overtake_target_no_order_up_time: 'overtake_event',
  overtake_target_time: 'overtake_event',
  change_order_up_end_after: 'order_change_event',
  change_order_up_finalcorner_after: 'order_change_event',
  near_count: 'nearby_runner_event',
  bashin_diff_infront: 'nearby_runner_event',
  bashin_diff_behind: 'nearby_runner_event',
  behind_near_lane_time: 'nearby_runner_event',
  behind_near_lane_time_set1: 'nearby_runner_event',
  infront_near_lane_time: 'nearby_runner_event',
  is_surrounded: 'nearby_runner_event',
  distance_diff_top: 'lead_distance_event',
  distance_diff_rate: 'lead_distance_event',
  hp_per: 'stamina_event',
  is_badstart: 'start_event',
};

export const isEventTerm = (name: string): boolean => name in EVENT_MODELS;

export const modelForTerm = (name: string): ActivationModel => EVENT_MODELS[name] ?? 'unsupported';

/**
 * Builds a frame predicate for an event term, or null when the term cannot be
 * decided from the simulated state (the caller then falls back to an assumption
 * and downgrades the confidence to `estimated`).
 */
export function buildEventPredicate(term: ConditionTerm): EventTerm | null {
  const { name, operator, value } = term;
  const model = EVENT_MODELS[name];
  if (!model) return null;

  const make = (predicate: TermPredicate, description: string): EventTerm => ({
    name,
    model,
    predicate,
    description,
  });

  switch (name) {
    case 'order':
      return make((c) => compare(c.relative.rank, operator, value), `running position ${operator} ${value}`);
    case 'order_rate':
      return make(
        (c) => compare(c.relative.orderRate, operator, value),
        `running position percentile ${operator} ${value}%`,
      );

    // "has been within the top N % for the whole race so far"
    case 'order_rate_in20_continue':
      return make((c) => c.relative.orderRate <= 20, 'held inside the top 20%');
    case 'order_rate_in50_continue':
      return make((c) => c.relative.orderRate <= 50, 'held inside the top 50%');
    case 'order_rate_in80_continue':
      return make((c) => c.relative.orderRate <= 80, 'held inside the top 80%');
    case 'order_rate_out40_continue':
      return make((c) => c.relative.orderRate > 40, 'stayed outside the top 40%');
    case 'order_rate_out50_continue':
      return make((c) => c.relative.orderRate > 50, 'stayed outside the top 50%');
    case 'order_rate_out70_continue':
      return make((c) => c.relative.orderRate > 70, 'stayed outside the top 70%');

    case 'is_overtake':
      return make(
        (c) => (value === 0 ? !c.relative.isOvertaking : c.relative.isOvertaking),
        'while overtaking another runner',
      );
    case 'overtake_target_no_order_up_time':
      return make(
        (c) => compare(c.events.overtakeTargetSeconds, operator, value),
        `chasing a runner for ${operator} ${value} s`,
      );
    case 'overtake_target_time':
      return make(
        (c) => compare(c.events.overtakeTargetSeconds, operator, value),
        `an overtake target present for ${operator} ${value} s`,
      );

    // `change_order_onetime` is deliberately NOT an event term: its stored form
    // (`< 0`) is ambiguous about which direction counts, so forcing a predicate on
    // it produced worse results than leaving it as a documented assumption.
    case 'change_order_up_end_after':
      return make(
        (c) => compare(c.events.overtakesSinceLateRace, operator, value),
        `${operator} ${value} overtakes since the final leg`,
      );
    case 'change_order_up_finalcorner_after':
      return make(
        (c) => compare(c.events.overtakesSinceFinalCorner, operator, value),
        `${operator} ${value} overtakes since the final corner`,
      );

    case 'near_count':
      return make(
        (c) => compare(c.relative.nearbyRunnerCount, operator, value),
        `${operator} ${value} runners nearby`,
      );
    case 'bashin_diff_infront':
      return make(
        (c) => c.relative.bashinDiffInFront !== undefined && compare(c.relative.bashinDiffInFront, operator, value),
        `runner ahead within ${value} lengths`,
      );
    case 'bashin_diff_behind':
      return make(
        (c) => c.relative.bashinDiffBehind !== undefined && compare(c.relative.bashinDiffBehind, operator, value),
        `runner behind within ${value} lengths`,
      );
    case 'behind_near_lane_time':
    case 'behind_near_lane_time_set1':
      return make(
        (c) => compare(c.events.behindNearSeconds, operator, value),
        `a runner directly behind for ${operator} ${value} s`,
      );
    case 'infront_near_lane_time':
      return make(
        (c) => compare(c.events.inFrontNearSeconds, operator, value),
        `a runner directly ahead for ${operator} ${value} s`,
      );
    case 'is_surrounded':
      return make(
        (c) => (value === 0 ? c.relative.nearbyRunnerCount < 2 : c.relative.runnersAheadNearby > 0 && c.relative.runnersBehindNearby > 0),
        'while surrounded',
      );

    case 'distance_diff_top':
      return make(
        (c) => compare(c.relative.leadDistance, operator, value),
        `${operator} ${value} m behind the leader`,
      );
    case 'distance_diff_rate':
      return make(
        (c) => compare((c.relative.rank / c.relative.fieldSize) * 100, operator, value),
        `position in the field ${operator} ${value}%`,
      );

    case 'hp_per':
      return make(
        (c) => compare(c.hpFraction * 100, operator, value),
        `stamina ${operator} ${value}%`,
      );

    case 'is_badstart':
      // A late start is a property of the run, not of the field; keep it as an
      // assumption so it stays honest.
      return null;

    default:
      return null;
  }
}

/** Assumed running position, used only when no field is simulated. */
export const assumedRank = (style: keyof typeof RACE_FIELD.assumedOrder): number =>
  RACE_FIELD.assumedOrder[style];
