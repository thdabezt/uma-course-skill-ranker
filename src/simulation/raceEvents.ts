/**
 * Relative race state and event detection.
 *
 * Given the player's live position and the pre-simulated opponent trajectories,
 * this derives rank, overtaking, nearby-runner counts and lead distance every
 * frame, and records when each event first happened.
 *
 * Definitions (stable, and relied on by the condition evaluator):
 *  - rank            1 = furthest along the course. Ties break toward the player,
 *                    so rank is deterministic when two runners are level.
 *  - orderRate       rank / fieldSize as a percentage, matching the game's
 *                    `order_rate` condition.
 *  - overtaking      the player's position crossed from behind an opponent to at
 *                    or in front of it BETWEEN two frames. Simply being faster is
 *                    not an overtake.
 *  - being overtaken the same crossing in the opposite direction.
 *  - nearby          another runner within `nearbyRunnerMeters` of the player.
 *  - leadDistance    metres between the player and the runner in first place
 *                    (0 when the player leads).
 */

import { RACE_FIELD } from './config';

export interface RaceRelativeState {
  rank: number;
  previousRank: number;
  orderRate: number;
  fieldSize: number;

  isOvertaking: boolean;
  isBeingOvertaken: boolean;
  changedOrderThisFrame: boolean;
  changedOrderAtLeastOnce: boolean;

  runnersAheadNearby: number;
  runnersBehindNearby: number;
  nearbyRunnerCount: number;

  distanceToRunnerAhead?: number;
  distanceToRunnerBehind?: number;

  leadDistance: number;
  /** Horse lengths to the runner in front / behind, for `bashin_diff_*`. */
  bashinDiffInFront?: number;
  bashinDiffBehind?: number;
}

export interface RaceEventHistory {
  overtakeCount: number;
  overtakenCount: number;
  orderChangeCount: number;
  /** Overtakes made since the final leg (phase >= 2) began. */
  overtakesSinceLateRace: number;
  /** Overtakes made since the final corner. */
  overtakesSinceFinalCorner: number;
  firstOvertakeMeters: number | null;
  firstOvertakenMeters: number | null;
  /** Seconds the player has continuously had someone to overtake. */
  overtakeTargetSeconds: number;
  /** Seconds another runner has been directly behind. */
  behindNearSeconds: number;
  /** Seconds another runner has been directly in front. */
  inFrontNearSeconds: number;
  bestRank: number;
  worstRank: number;
}

export function createEventHistory(fieldSize: number): RaceEventHistory {
  return {
    overtakeCount: 0,
    overtakenCount: 0,
    orderChangeCount: 0,
    overtakesSinceLateRace: 0,
    overtakesSinceFinalCorner: 0,
    firstOvertakeMeters: null,
    firstOvertakenMeters: null,
    overtakeTargetSeconds: 0,
    behindNearSeconds: 0,
    inFrontNearSeconds: 0,
    bestRank: fieldSize,
    worstRank: 1,
  };
}

const HORSE_LENGTH_M = 2.5;

/**
 * Computes the relative state for one frame and folds the frame's events into
 * `history`. `previousOpponentPositions` and `previousPlayerPosition` are the
 * values from the frame before, which is what makes crossing detection exact.
 */
export function updateRelativeState(args: {
  playerPosition: number;
  previousPlayerPosition: number;
  opponentPositions: number[];
  previousOpponentPositions: number[];
  previousRank: number;
  history: RaceEventHistory;
  phase: number;
  pastFinalCorner: boolean;
  dt: number;
}): RaceRelativeState {
  const {
    playerPosition,
    previousPlayerPosition,
    opponentPositions,
    previousOpponentPositions,
    previousRank,
    history,
    phase,
    pastFinalCorner,
    dt,
  } = args;

  const fieldSize = opponentPositions.length + 1;

  let ahead = 0;
  let aheadNearby = 0;
  let behindNearby = 0;
  let nearestAhead = Number.POSITIVE_INFINITY;
  let nearestBehind = Number.POSITIVE_INFINITY;
  let leader = playerPosition;
  let overtakes = 0;
  let overtaken = 0;
  let hasOvertakeTarget = false;
  let someoneDirectlyBehind = false;
  let someoneDirectlyInFront = false;

  for (let i = 0; i < opponentPositions.length; i += 1) {
    const pos = opponentPositions[i];
    const prev = previousOpponentPositions[i] ?? pos;
    if (pos > leader) leader = pos;

    const gap = pos - playerPosition;
    if (gap > 0) {
      ahead += 1;
      hasOvertakeTarget = true;
      if (gap < nearestAhead) nearestAhead = gap;
      if (gap <= RACE_FIELD.nearbyRunnerMeters) aheadNearby += 1;
      if (gap <= RACE_FIELD.closeLaneMeters) someoneDirectlyInFront = true;
    } else {
      const back = -gap;
      if (back < nearestBehind) nearestBehind = back;
      if (back <= RACE_FIELD.nearbyRunnerMeters) behindNearby += 1;
      if (back <= RACE_FIELD.closeLaneMeters) someoneDirectlyBehind = true;
    }

    // Crossing detection: strictly behind last frame, at-or-ahead this frame.
    const wasBehind = previousPlayerPosition < prev;
    const isBehind = playerPosition < pos;
    if (wasBehind && !isBehind) overtakes += 1;
    else if (!wasBehind && isBehind) overtaken += 1;
  }

  const rank = ahead + 1;
  const changedOrderThisFrame = rank !== previousRank;

  history.overtakeCount += overtakes;
  history.overtakenCount += overtaken;
  if (changedOrderThisFrame) history.orderChangeCount += 1;
  if (overtakes > 0) {
    if (history.firstOvertakeMeters === null) history.firstOvertakeMeters = playerPosition;
    if (phase >= 2) history.overtakesSinceLateRace += overtakes;
    if (pastFinalCorner) history.overtakesSinceFinalCorner += overtakes;
  }
  if (overtaken > 0 && history.firstOvertakenMeters === null) {
    history.firstOvertakenMeters = playerPosition;
  }
  history.overtakeTargetSeconds = hasOvertakeTarget ? history.overtakeTargetSeconds + dt : 0;
  history.behindNearSeconds = someoneDirectlyBehind ? history.behindNearSeconds + dt : 0;
  history.inFrontNearSeconds = someoneDirectlyInFront ? history.inFrontNearSeconds + dt : 0;
  history.bestRank = Math.min(history.bestRank, rank);
  history.worstRank = Math.max(history.worstRank, rank);

  return {
    rank,
    previousRank,
    orderRate: (rank / fieldSize) * 100,
    fieldSize,
    isOvertaking: overtakes > 0,
    isBeingOvertaken: overtaken > 0,
    changedOrderThisFrame,
    changedOrderAtLeastOnce: history.orderChangeCount > 0,
    runnersAheadNearby: aheadNearby,
    runnersBehindNearby: behindNearby,
    nearbyRunnerCount: aheadNearby + behindNearby,
    distanceToRunnerAhead: Number.isFinite(nearestAhead) ? nearestAhead : undefined,
    distanceToRunnerBehind: Number.isFinite(nearestBehind) ? nearestBehind : undefined,
    leadDistance: Math.max(0, leader - playerPosition),
    bashinDiffInFront: Number.isFinite(nearestAhead) ? nearestAhead / HORSE_LENGTH_M : undefined,
    bashinDiffBehind: Number.isFinite(nearestBehind) ? nearestBehind / HORSE_LENGTH_M : undefined,
  };
}

/** Relative state for a solo run, used when opponent simulation is disabled. */
export function soloRelativeState(assumedRank: number, fieldSize: number): RaceRelativeState {
  return {
    rank: assumedRank,
    previousRank: assumedRank,
    orderRate: (assumedRank / fieldSize) * 100,
    fieldSize,
    isOvertaking: false,
    isBeingOvertaken: false,
    changedOrderThisFrame: false,
    changedOrderAtLeastOnce: false,
    runnersAheadNearby: 0,
    runnersBehindNearby: 0,
    nearbyRunnerCount: 0,
    leadDistance: 0,
  };
}
