/**
 * Turns a skill's activation condition into (a) whether it can fire at all on the
 * selected course + running style, (b) where on the course it can fire, and
 * (c) how likely that is.
 *
 * Three kinds of condition term:
 *   STATIC        decidable from the course / setup / runner  -> hard gate
 *   POSITIONAL    restricts where on the track the skill fires -> window
 *   PROBABILISTIC depends on the other runners                 -> estimate
 *
 * Any use of a PROBABILISTIC term marks the whole result as an estimate.
 */

import {
  ACTIVATION_ASSUMPTIONS,
  MOOD_IDS,
  RACE_FIELD,
  RUNNING_STYLE_IDS,
  SEASON_IDS,
  TIME_OF_DAY,
  TIGHT_TRACK_IDS,
  TRACK_CONDITION_IDS,
  WEATHER_IDS,
} from '@/simulation/config';
import {
  intersectWindows,
  mergeWindows,
  phaseSection,
  sectionLength,
} from '@/courses/sections';
import type { Course, RaceSetup, RunnerStats, Section } from '@/simulation/types';
import { compare, parseCondition, type ConditionClause, type ConditionTerm } from './conditionParser';
import {
  buildEventPredicate,
  isEventTerm,
  modelForTerm,
  type ActivationModel,
  type EventTerm,
} from './activationModel';

export interface ClauseAnalysis {
  raw: string;
  /** How this clause decides when to fire. */
  model: ActivationModel;
  /** Event predicates that must all hold for the clause to fire. */
  eventTerms: EventTerm[];
  /** False when a static condition rules the clause out entirely. */
  possible: boolean;
  /** Positions (metres) where activation may occur. */
  windows: Section[];
  /** Activation happens at a uniformly random point inside the window(s). */
  randomWithinWindow: boolean;
  /** Product of every probabilistic term. */
  probability: number;
  isEstimate: boolean;
  /** Static terms that fail, in plain English. */
  blockers: string[];
  /** Human-readable notes for the details panel. */
  notes: string[];
}

export interface ActivationAnalysis {
  possible: boolean;
  model: ActivationModel;
  eventTerms: EventTerm[];
  /**
   * Event terms that came from the group's PRECONDITION. A precondition only has to
   * have been true at some earlier point, so these latch once satisfied.
   */
  preconditionEventTerms: EventTerm[];
  windows: Section[];
  randomWithinWindow: boolean;
  probability: number;
  isEstimate: boolean;
  blockers: string[];
  notes: string[];
  clauses: ClauseAnalysis[];
}

const FULL = (course: Course): Section[] => [{ start: 0, end: course.distance }];

const DISTANCE_CATEGORY_IDS: Record<string, number> = { short: 1, mile: 2, medium: 3, long: 4 };
const SURFACE_IDS: Record<string, number> = { turf: 1, dirt: 2 };
const DIRECTION_IDS: Record<string, number> = { right: 1, left: 2, straight: 4 };

/** Windows for `corner == n`. `corner == 0` means "not on a corner". */
function cornerWindows(course: Course, term: ConditionTerm): Section[] {
  if (term.operator === '==' && term.value === 0) {
    // everything that is not a corner
    const nonCorner: Section[] = [];
    let cursor = 0;
    for (const c of course.corners.slice().sort((a, b) => a.start - b.start)) {
      if (c.start > cursor) nonCorner.push({ start: cursor, end: c.start });
      cursor = Math.max(cursor, c.end);
    }
    if (cursor < course.distance) nonCorner.push({ start: cursor, end: course.distance });
    return nonCorner;
  }
  const matched = course.corners.filter((_, i) => compare(i + 1, term.operator, term.value));
  return matched.map((c) => ({ start: c.start, end: c.end }));
}

/** Sections of the course that are neither uphill nor downhill. */
function flatWindows(course: Course): Section[] {
  const slopes = [...course.uphills, ...course.downhills]
    .map((s) => ({ start: s.start, end: s.end }))
    .sort((a, b) => a.start - b.start);
  const out: Section[] = [];
  let cursor = 0;
  for (const s of slopes) {
    if (s.start > cursor) out.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < course.distance) out.push({ start: cursor, end: course.distance });
  return out;
}

function halfOf(section: Section, which: 'first' | 'later'): Section {
  const mid = section.start + sectionLength(section) / 2;
  return which === 'first' ? { start: section.start, end: mid } : { start: mid, end: section.end };
}

function quarterOf(section: Section, quarter: number): Section {
  const len = sectionLength(section) / 4;
  const start = section.start + len * (quarter - 1);
  return { start, end: start + len };
}

/**
 * Probability that our running position satisfies an `order`-style term.
 * Modelled as a discrete triangular distribution around the assumed order.
 */
function orderProbability(
  runner: RunnerStats,
  predicate: (order: number) => boolean,
): number {
  const centre = RACE_FIELD.assumedOrder[runner.runningStyle];
  const spread = RACE_FIELD.orderSpread;
  let total = 0;
  let hit = 0;
  for (let o = 1; o <= RACE_FIELD.fieldSize; o += 1) {
    const w = Math.max(0, spread + 1 - Math.abs(o - centre));
    if (w === 0) continue;
    total += w;
    if (predicate(o)) hit += w;
  }
  return total === 0 ? 0 : hit / total;
}

const assumedProbability = (name: string): number =>
  ACTIVATION_ASSUMPTIONS[name] ?? ACTIVATION_ASSUMPTIONS.default;

interface TermOutcome {
  /** Hard block: the term can never be true here. */
  blocked?: string;
  windows?: Section[];
  random?: boolean;
  probability?: number;
  estimate?: boolean;
  note?: string;
}

function evaluateTerm(
  term: ConditionTerm,
  setup: RaceSetup,
  runner: RunnerStats,
): TermOutcome {
  const { course } = setup;
  const D = course.distance;
  const staticCheck = (actual: number, label: string): TermOutcome =>
    compare(actual, term.operator, term.value) ? {} : { blocked: label };

  switch (term.name) {
    /* ------------------------------------------------ always / random roll */
    case 'always':
      return {};
    case 'random_lot': {
      // Exact: the game rolls 0-100.
      const p =
        term.operator === '<=' ? term.value / 100 : term.operator === '<' ? (term.value - 1) / 100 : term.operator === '>=' ? (100 - term.value) / 100 : 0.5;
      return { probability: Math.min(1, Math.max(0, p)), note: `Random roll: ${Math.round(p * 100)}% chance` };
    }

    /* ------------------------------------------------------------- static */
    case 'distance_type':
      return staticCheck(
        DISTANCE_CATEGORY_IDS[course.distanceCategory] ?? 0,
        `Requires a ${['', 'Short', 'Mile', 'Medium', 'Long'][term.value] ?? '?'} race`,
      );
    case 'ground_type':
      return staticCheck(SURFACE_IDS[course.surface] ?? 0, `Requires ${term.value === 1 ? 'turf' : 'dirt'}`);
    case 'rotation':
      return staticCheck(
        DIRECTION_IDS[course.direction] ?? 0,
        `Requires a ${term.value === 1 ? 'right-handed' : term.value === 2 ? 'left-handed' : 'straight'} course`,
      );
    case 'running_style':
      return staticCheck(
        RUNNING_STYLE_IDS[runner.runningStyle],
        `Requires a different running style (style ${term.value})`,
      );
    case 'course_distance':
      return staticCheck(D, `Requires a course distance ${term.operator} ${term.value} m`);
    case 'track_id':
      return staticCheck(course.trackId, `Requires racecourse id ${term.value}`);
    case 'is_basis_distance':
      return staticCheck(D % 400 === 0 ? 1 : 0, 'Requires a standard (multiple of 400 m) distance');
    case 'is_dirtgrade':
      return staticCheck(
        course.surface === 'dirt' && TIGHT_TRACK_IDS.localDirtTrackIds.includes(course.trackId) ? 1 : 0,
        'Requires an exchange race (Ooi / Kawasaki / Funabashi / Morioka)',
      );
    case 'is_tight_track':
      return staticCheck(
        TIGHT_TRACK_IDS.tightTrackIds.includes(course.trackId) ? 1 : 0,
        'Requires a tight-cornered racecourse',
      );
    case 'ground_condition':
      return staticCheck(TRACK_CONDITION_IDS[setup.trackCondition], 'Requires a different track condition');
    case 'weather':
      return staticCheck(WEATHER_IDS[setup.weather], 'Requires different weather');
    case 'season':
      return staticCheck(SEASON_IDS[setup.season], 'Requires a different season');
    case 'time':
      return staticCheck(TIME_OF_DAY.assumedValue, 'Requires a different time of day');
    case 'grade':
      return staticCheck(RACE_FIELD.grade, `Requires race grade ${term.operator} ${term.value}`);
    case 'motivation':
      return staticCheck(MOOD_IDS[runner.mood], 'Requires a different mood');
    case 'post_number':
      return staticCheck(runner.postNumber, `Requires gate number ${term.operator} ${term.value}`);
    case 'popularity':
      return staticCheck(runner.popularity, `Requires popularity ${term.operator} ${term.value}`);
    case 'base_power':
      return staticCheck(runner.power, `Requires Power ${term.operator} ${term.value}`);
    case 'running_style_count_same':
      return staticCheck(RACE_FIELD.sameStyleCount, 'Requires a different number of same-style runners');
    case 'running_style_count_same_rate':
      return staticCheck(
        Math.round((RACE_FIELD.sameStyleCount / RACE_FIELD.fieldSize) * 100),
        'Requires a different share of same-style runners',
      );
    case 'running_style_count_nige_otherself':
    case 'running_style_count_senko_otherself':
    case 'running_style_count_sashi_otherself':
    case 'running_style_count_oikomi_otherself':
      return {
        probability: assumedProbability(term.name),
        estimate: true,
        note: 'Depends on the composition of the field',
      };

    /* --------------------------------------------------------- positional */
    case 'phase': {
      const matching = course.phases.filter((p) => compare(p.phase, term.operator, term.value));
      return { windows: matching.map((p) => ({ start: p.start, end: p.end })) };
    }
    case 'phase_random': {
      const s = phaseSection(course, term.value);
      return { windows: [s], random: true, note: 'Fires at a random point inside the phase' };
    }
    case 'phase_firsthalf_random': {
      const s = halfOf(phaseSection(course, term.value), 'first');
      return { windows: [s], random: true, note: 'Fires at a random point in the first half of the phase' };
    }
    case 'phase_laterhalf_random': {
      const s = halfOf(phaseSection(course, term.value), 'later');
      return { windows: [s], random: true, note: 'Fires at a random point in the second half of the phase' };
    }
    case 'phase_firstquarter_random': {
      const s = quarterOf(phaseSection(course, term.value), 1);
      return { windows: [s], random: true, note: 'Fires at a random point in the first quarter of the phase' };
    }
    case 'corner':
      return { windows: cornerWindows(course, term) };
    case 'all_corner_random':
      return {
        windows: course.corners.map((c) => ({ start: c.start, end: c.end })),
        random: true,
        note: 'Fires at a random point on a random corner',
      };
    case 'is_finalcorner_random':
      return course.finalCorner
        ? { windows: [course.finalCorner], random: true, note: 'Fires at a random point on the final corner' }
        : { blocked: 'This course has no corners' };
    case 'straight_random':
      return {
        windows: course.straights.map((s) => ({ start: s.start, end: s.end })),
        random: true,
        note: 'Fires at a random point on a random straight',
      };
    case 'last_straight_random':
      return {
        windows: [{ start: course.finalStraightStart, end: D }],
        random: true,
        note: 'Fires at a random point on the final straight',
      };
    case 'up_slope_random':
      return course.uphills.length
        ? {
            windows: course.uphills.map((s) => ({ start: s.start, end: s.end })),
            random: true,
            note: 'Fires at a random point on an uphill',
          }
        : { blocked: 'This course has no uphill' };
    case 'down_slope_random':
      return course.downhills.length
        ? {
            windows: course.downhills.map((s) => ({ start: s.start, end: s.end })),
            random: true,
            note: 'Fires at a random point on a downhill',
          }
        : { blocked: 'This course has no downhill' };
    case 'slope': {
      // 0 = flat, 1 = uphill, 2 = downhill.
      if (term.value === 1) {
        return course.uphills.length
          ? { windows: course.uphills.map((s) => ({ start: s.start, end: s.end })) }
          : { blocked: 'This course has no uphill' };
      }
      if (term.value === 2) {
        return course.downhills.length
          ? { windows: course.downhills.map((s) => ({ start: s.start, end: s.end })) }
          : { blocked: 'This course has no downhill' };
      }
      // Flat = everything that is neither an uphill nor a downhill. Treating this as
      // "no constraint" made slope-gated alternatives eligible on courses whose
      // geometry does not actually satisfy them.
      const flat = flatWindows(course);
      return flat.length ? { windows: flat } : { blocked: 'This course has no flat section here' };
    }
    case 'is_last_straight':
    case 'is_last_straight_onetime':
      return { windows: [{ start: course.finalStraightStart, end: D }] };
    case 'is_finalcorner':
      return course.finalCorner
        ? { windows: [{ start: course.finalCorner.start, end: D }] }
        : { windows: [{ start: course.finalStraightStart, end: D }] };
    case 'is_finalcorner_laterhalf':
      return course.finalCorner
        ? { windows: [halfOf(course.finalCorner, 'later')] }
        : { blocked: 'This course has no corners' };
    case 'is_lastspurt':
    case 'lastspurt':
      return { windows: [{ start: phaseSection(course, 3).start, end: D }] };
    case 'straight_front_type': {
      const kind = term.value === 1 ? 'home' : 'backstretch';
      const matching = course.straights.filter((s) => s.kind === kind);
      return matching.length
        ? { windows: matching.map((s) => ({ start: s.start, end: s.end })) }
        : { blocked: `This course has no ${kind} straight` };
    }
    case 'remain_distance': {
      if (term.operator === '<=' || term.operator === '<') {
        return { windows: [{ start: Math.max(0, D - term.value), end: D }] };
      }
      if (term.operator === '>=' || term.operator === '>') {
        return { windows: [{ start: 0, end: Math.max(0, D - term.value) }] };
      }
      return { windows: [{ start: Math.max(0, D - term.value), end: Math.max(0, D - term.value) + 1 }] };
    }
    case 'remain_distance_viewer_id':
      return { windows: [{ start: Math.max(0, D - term.value), end: D }], estimate: true };
    case 'distance_rate': {
      const at = (D * term.value) / 100;
      if (term.operator === '>=' || term.operator === '>') return { windows: [{ start: at, end: D }] };
      if (term.operator === '<=' || term.operator === '<') return { windows: [{ start: 0, end: at }] };
      return { windows: [{ start: at, end: Math.min(D, at + 1) }] };
    }
    case 'distance_rate_after_random': {
      const at = (D * term.value) / 100;
      return {
        windows: [{ start: at, end: D }],
        random: true,
        note: `Fires at a random point after ${term.value}% of the race`,
      };
    }
    case 'accumulatetime': {
      // Approximate the position reached after N seconds using the course base pace.
      const approxSpeed = 20 - (D - 2000) / 1000;
      const at = Math.min(D, Math.max(0, term.value * approxSpeed));
      return term.operator === '>=' || term.operator === '>'
        ? { windows: [{ start: at, end: D }], estimate: true, note: 'Time-based trigger, position approximated' }
        : { windows: [{ start: 0, end: at }], estimate: true, note: 'Time-based trigger, position approximated' };
    }
    case 'hp_per':
      return {
        probability: assumedProbability(term.name),
        estimate: true,
        note: 'Depends on remaining stamina at the moment of the check',
      };

    /* ------------------------------------------------------- order-based */
    case 'order':
      return {
        probability: orderProbability(runner, (o) => compare(o, term.operator, term.value)),
        estimate: true,
        note: `Assumes an average running position around ${RACE_FIELD.assumedOrder[runner.runningStyle]} of ${RACE_FIELD.fieldSize}`,
      };
    case 'order_rate':
      return {
        probability: orderProbability(runner, (o) =>
          compare((o / RACE_FIELD.fieldSize) * 100, term.operator, term.value),
        ),
        estimate: true,
        note: `Assumes an average running position around ${RACE_FIELD.assumedOrder[runner.runningStyle]} of ${RACE_FIELD.fieldSize}`,
      };

    /* ------------------------------------------------------------- start */
    case 'is_badstart':
      return {
        probability:
          term.value === 0
            ? 1 - assumedProbability('is_badstart')
            : assumedProbability('is_badstart'),
        estimate: true,
        note: 'Late-start chance is an assumption',
      };

    default:
      break;
  }

  /* --------------------------------- everything else: field-dependent estimate */
  return {
    probability: assumedProbability(term.name),
    estimate: true,
    note: `"${term.name}" depends on the rest of the field and is estimated`,
  };
}

function analyseClause(
  clause: ConditionClause,
  setup: RaceSetup,
  runner: RunnerStats,
  useEventSimulation: boolean,
): ClauseAnalysis {
  let windows: Section[] = FULL(setup.course);
  let probability = 1;
  let random = false;
  let estimate = false;
  const blockers: string[] = [];
  const notes: string[] = [];

  const eventTerms: EventTerm[] = [];
  let model: ActivationModel = 'guaranteed';

  for (const term of clause.terms) {
    // Event-driven terms become frame predicates so the skill fires at the moment
    // the event actually happens, instead of being folded into a probability.
    if (useEventSimulation && isEventTerm(term.name)) {
      const built = buildEventPredicate(term);
      if (built) {
        eventTerms.push(built);
        if (model === 'guaranteed' || model === 'random_region') model = built.model;
        notes.push(`Fires when ${built.description}.`);
        continue;
      }
    }
    const outcome = evaluateTerm(term, setup, runner);
    if (outcome.blocked) blockers.push(outcome.blocked);
    if (outcome.windows) {
      windows = intersectWindows(windows, outcome.windows);
    }
    if (outcome.random) {
      random = true;
      if (model === 'guaranteed') model = 'random_region';
    }
    if (outcome.probability !== undefined) probability *= outcome.probability;
    if (outcome.estimate) {
      estimate = true;
      if (isEventTerm(term.name) && model === 'guaranteed') model = modelForTerm(term.name);
    }
    if (outcome.note) notes.push(outcome.note);
  }

  if (!blockers.length && windows.length === 0) {
    blockers.push('No position on this course satisfies all parts of the condition');
  }

  // A field-dependent term we could NOT turn into a predicate still makes the
  // moment of activation unknown, so its position is sampled across the window.
  // Terms that DID become predicates keep their exact event position - unless the
  // clause also has a genuine random-region term, in which case the game picks a
  // random point first and then tests the event there, so both apply.
  if (estimate && !random && eventTerms.length === 0) random = true;

  return {
    raw: clause.raw,
    model,
    eventTerms,
    possible: blockers.length === 0 && probability > 0 && windows.length > 0,
    windows: mergeWindows(windows),
    randomWithinWindow: random,
    probability,
    isEstimate: estimate,
    blockers,
    notes,
  };
}

/**
 * Analyses a full condition expression (OR of AND clauses).
 *
 * The overall probability is the maximum over the alternatives rather than a
 * union, because the alternatives usually describe the same race situation from
 * different angles and adding them would double-count.
 */
export function analyseCondition(
  expression: string | null | undefined,
  setup: RaceSetup,
  runner: RunnerStats,
  useEventSimulation = RACE_FIELD.opponentSimulationEnabled,
): ActivationAnalysis {
  const clauses = parseCondition(expression).map((c) =>
    analyseClause(c, setup, runner, useEventSimulation),
  );
  if (!clauses.length) {
    return {
      possible: true,
      model: 'guaranteed',
      eventTerms: [],
      preconditionEventTerms: [],
      windows: FULL(setup.course),
      randomWithinWindow: false,
      probability: 1,
      isEstimate: false,
      blockers: [],
      notes: [],
      clauses: [],
    };
  }

  const viable = clauses.filter((c) => c.possible);
  if (!viable.length) {
    return {
      possible: false,
      model: clauses[0]?.model ?? 'unsupported',
      eventTerms: [],
      preconditionEventTerms: [],
      windows: [],
      randomWithinWindow: false,
      probability: 0,
      isEstimate: clauses.some((c) => c.isEstimate),
      blockers: [...new Set(clauses.flatMap((c) => c.blockers))],
      notes: [...new Set(clauses.flatMap((c) => c.notes))],
      clauses,
    };
  }

  const best = viable.reduce((a, b) => (b.probability > a.probability ? b : a));
  return {
    possible: true,
    model: best.model,
    eventTerms: best.eventTerms,
    preconditionEventTerms: [],
    windows: mergeWindows(viable.flatMap((c) => c.windows)),
    randomWithinWindow: viable.some((c) => c.randomWithinWindow),
    probability: best.probability,
    isEstimate: viable.some((c) => c.isEstimate),
    blockers: [],
    notes: [...new Set(viable.flatMap((c) => c.notes))],
    clauses,
  };
}

/**
 * Combines a condition group's `precondition` and `condition`.
 * A precondition must have been satisfied earlier in the race, so it only pushes
 * the earliest possible activation point forward and multiplies the probability.
 */
export function analyseConditionGroup(
  condition: string,
  precondition: string | null,
  setup: RaceSetup,
  runner: RunnerStats,
  useEventSimulation = RACE_FIELD.opponentSimulationEnabled,
): ActivationAnalysis {
  const main = analyseCondition(condition, setup, runner, useEventSimulation);
  if (!precondition) return main;

  const pre = analyseCondition(precondition, setup, runner, useEventSimulation);
  if (!pre.possible) {
    return { ...main, possible: false, probability: 0, blockers: [...main.blockers, ...pre.blockers] };
  }

  const earliest = pre.windows.length ? Math.min(...pre.windows.map((w) => w.start)) : 0;
  const windows = mergeWindows(
    main.windows
      .map((w) => ({ start: Math.max(w.start, earliest), end: w.end }))
      .filter((w) => w.end > w.start),
  );

  return {
    ...main,
    possible: windows.length > 0,
    windows,
    eventTerms: main.eventTerms,
    // Kept apart so they can latch: a precondition must have been satisfied at some
    // earlier moment, not at the same instant the trigger fires.
    preconditionEventTerms: pre.eventTerms,
    probability: main.probability * pre.probability,
    isEstimate: main.isEstimate || pre.isEstimate,
    notes: [...new Set([...main.notes, ...pre.notes])],
    blockers: windows.length ? [] : ['The precondition can never be satisfied before the trigger'],
  };
}
