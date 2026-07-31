/**
 * Lightweight opponent field.
 *
 * Opponents exist only to produce ranks and passing events. They run the same
 * physics as the player (`simulateRace`), with seeded stat, start-delay and
 * per-section variation, and their trajectories are simulated ONCE per
 * (course, conditions, field seed) and then reused by every skill evaluation.
 *
 * Critically, an opponent trajectory never depends on the player's skills, so a
 * baseline run and a with-skill run always face an identical field - that is what
 * makes the paired comparison valid.
 */

import { RACE_FIELD, type Aptitude, type RunningStyle } from './config';
import { createRng, seedFor } from './random';
import { simulateRace } from './simulator';
import type { RaceSetup, RunnerStats, SimulationResult } from './types';

export interface SimulatedOpponent {
  id: string;
  runningStyle: RunningStyle;
  statsProfile: { speed: number; stamina: number; power: number; guts: number; wit: number };
  aptitudeProfile: { surface: Aptitude; distance: Aptitude; style: Aptitude };
  /** Starting gate (1-based). */
  gate: number;
  /** Frame-by-frame trajectory, shared across every evaluation. */
  result: SimulationResult;
}

export interface OpponentField {
  key: string;
  seed: number;
  opponents: SimulatedOpponent[];
  /** Position of every opponent at an elapsed time, index-aligned with `opponents`. */
  positionsAt: (t: number) => number[];
  /**
   * Position of every opponent at a fixed frame index. Every run uses the same
   * timestep, so frame lookup is an array index instead of a binary search - this
   * is what keeps a full ranking affordable.
   */
  positionsAtFrame: (frame: number) => number[];
}

/** Style mix of a typical Global field, cycled so the composition is stable. */
const DEFAULT_STYLE_MIX: RunningStyle[] = [
  'front_runner',
  'pace_chaser',
  'pace_chaser',
  'pace_chaser',
  'late_surger',
  'late_surger',
  'late_surger',
  'end_closer',
  'end_closer',
  'end_closer',
  'front_runner',
  'pace_chaser',
];

const APTITUDES: Aptitude[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];

/** Trajectory lookup, memoized per opponent so repeated frames are cheap. */
function makePositionLookup(results: SimulationResult[]): (t: number) => number[] {
  return (t: number) =>
    results.map((r) => {
      const trace = r.trace;
      if (!trace.length) return 0;
      if (t <= trace[0].t) return trace[0].pos;
      const last = trace[trace.length - 1];
      if (t >= last.t) return last.pos + (t - last.t) * r.finishSpeed;
      let lo = 0;
      let hi = trace.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (trace[mid].t <= t) lo = mid;
        else hi = mid;
      }
      const a = trace[lo];
      const b = trace[hi];
      const span = b.t - a.t;
      return span <= 0 ? a.pos : a.pos + ((t - a.t) / span) * (b.pos - a.pos);
    });
}

const fieldCache = new Map<string, OpponentField>();

function fieldKey(setup: RaceSetup, player: RunnerStats, seed: number, count: number): string {
  return [
    setup.course.id,
    setup.runningStyle,
    setup.trackCondition,
    setup.weather,
    setup.season,
    player.speed,
    player.stamina,
    player.power,
    player.guts,
    player.wit,
    player.mood,
    player.distanceAptitude,
    player.surfaceAptitude,
    player.styleAptitude,
    seed,
    count,
  ].join('|');
}

/**
 * Builds (or returns a cached) opponent field for a course + player configuration.
 * The field is deliberately keyed on the player's *stats*, not the player's skills,
 * so every skill evaluated on the same page reuses one field.
 */
export function getOpponentField(
  setup: RaceSetup,
  player: RunnerStats,
  seed: number,
  count: number = RACE_FIELD.opponentCount,
): OpponentField {
  const key = fieldKey(setup, player, seed, count);
  const cached = fieldCache.get(key);
  if (cached) return cached;

  const rng = createRng(seedFor(seed, 'field'));
  const opponents: SimulatedOpponent[] = [];
  const results: SimulationResult[] = [];

  // Gates are dealt from a shuffled 1..(count+1) so the player's own gate stays free.
  const gates = Array.from({ length: count + 1 }, (_, i) => i + 1);
  for (let i = gates.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    [gates[i], gates[j]] = [gates[j], gates[i]];
  }

  for (let i = 0; i < count; i += 1) {
    const style = DEFAULT_STYLE_MIX[i % DEFAULT_STYLE_MIX.length];
    // Seeded spread around the player's level, so the field is competitive but varied.
    const vary = (base: number) => {
      const delta = (rng.next() * 2 - 1) * RACE_FIELD.opponentStatSpread;
      return Math.max(100, Math.round(base * RACE_FIELD.opponentStatLevel * (1 + delta)));
    };
    const statsProfile = {
      speed: vary(player.speed),
      stamina: vary(player.stamina),
      power: vary(player.power),
      guts: vary(player.guts),
      wit: vary(player.wit),
    };
    // Opponents are mostly suited to the race; a minority are not.
    const aptitude = (): Aptitude => APTITUDES[rng.next() < 0.75 ? 1 : 2 + rng.int(2)];
    const aptitudeProfile = { surface: aptitude(), distance: aptitude(), style: aptitude() };

    const runner: RunnerStats = {
      ...statsProfile,
      mood: player.mood,
      distanceAptitude: aptitudeProfile.distance,
      surfaceAptitude: aptitudeProfile.surface,
      styleAptitude: aptitudeProfile.style,
      runningStyle: style,
      skillActivationRate: player.skillActivationRate,
      startDelaySeconds: 0,
      postNumber: gates[i],
      popularity: i + 1,
    };

    // Each opponent gets its own random stream, derived from the field seed, so the
    // whole field is reproducible and independent of anything the player does.
    const result = simulateRace({ ...setup, runningStyle: style }, runner, [], {
      seed: seedFor(seed, `opp:${i}`),
      recordTrace: true,
    });

    opponents.push({
      id: `opp-${i}`,
      runningStyle: style,
      statsProfile,
      aptitudeProfile,
      gate: gates[i],
      result,
    });
    results.push(result);
  }

  // Frame-indexed trajectories: traces are already frame-aligned, so the lookup is
  // a direct index. The last known position is held for runs that finish earlier.
  const frameCount = Math.max(...results.map((r) => r.trace.length));
  const tracks = results.map((r) => {
    const arr = new Float64Array(frameCount);
    for (let f = 0; f < frameCount; f += 1) {
      arr[f] = f < r.trace.length ? r.trace[f].pos : r.trace[r.trace.length - 1].pos;
    }
    return arr;
  });
  const scratch = new Array<number>(tracks.length);

  const field: OpponentField = {
    key,
    seed,
    opponents,
    positionsAt: makePositionLookup(results),
    positionsAtFrame: (frame: number) => {
      const f = frame < 0 ? 0 : frame >= frameCount ? frameCount - 1 : frame;
      for (let i = 0; i < tracks.length; i += 1) scratch[i] = tracks[i][f];
      return scratch;
    },
  };
  fieldCache.set(key, field);
  return field;
}

export function clearOpponentFieldCache(): void {
  fieldCache.clear();
}

export const opponentFieldCacheSize = (): number => fieldCache.size;
